import { Effect, Schema } from 'effect'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { createHmac, timingSafeEqual } from 'crypto'
import { AppLayer } from '@/lib/layers'
import { Db } from '@/lib/services/db/live-layer'
import { Sprites } from '@/lib/services/sprites/live-layer'
import * as schema from '@/lib/services/db/schema'

type RouteContext = {
  params: Promise<{ manifestId: string }>
}

// Webhook payload schemas
const StartedPayloadSchema = Schema.Struct({
  type: Schema.Literal('started'),
  message: Schema.optional(Schema.String)
})

const TaskLoopStartedPayloadSchema = Schema.Struct({
  type: Schema.Literal('task_loop_started'),
  prdJson: Schema.String
})

const ProgressPayloadSchema = Schema.Struct({
  type: Schema.Literal('progress'),
  prdJson: Schema.String,
  iteration: Schema.Number,
  maxIterations: Schema.Number
})

const CompletedPayloadSchema = Schema.Struct({
  type: Schema.Literal('completed'),
  prdJson: Schema.String
})

const ErrorPayloadSchema = Schema.Struct({
  type: Schema.Literal('error'),
  error: Schema.String
})

const WebhookPayloadSchema = Schema.Union(
  StartedPayloadSchema,
  TaskLoopStartedPayloadSchema,
  ProgressPayloadSchema,
  CompletedPayloadSchema,
  ErrorPayloadSchema
)

export async function POST(request: NextRequest, context: RouteContext) {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Db
      const { manifestId } = yield* Effect.promise(() => context.params)

      yield* Effect.annotateCurrentSpan({
        'webhook.manifestId': manifestId,
        'webhook.type': 'manifest'
      })

      // Get the raw body as text for signature verification
      const rawBody = yield* Effect.promise(() => request.text())

      // Get the signature from headers
      const signature = request.headers.get('X-Webhook-Signature')
      if (!signature) {
        return NextResponse.json({ error: 'Missing X-Webhook-Signature header' }, { status: 401 })
      }

      // Fetch the manifest to get the webhook secret
      const [manifest] = yield* db
        .select()
        .from(schema.manifests)
        .where(eq(schema.manifests.id, manifestId))
        .limit(1)

      if (!manifest) {
        return NextResponse.json({ error: 'Manifest not found' }, { status: 404 })
      }

      if (!manifest.webhookSecret) {
        return NextResponse.json({ error: 'No webhook secret found for manifest' }, { status: 500 })
      }

      // Verify the signature using timing-safe comparison
      // Client sends "sha256=<hex>", extract just the hex part
      const signatureHex = signature.startsWith('sha256=') ? signature.slice(7) : signature

      const expectedSignature = createHmac('sha256', manifest.webhookSecret)
        .update(rawBody)
        .digest('hex')

      const signatureBuffer = Buffer.from(signatureHex, 'utf8')
      const expectedBuffer = Buffer.from(expectedSignature, 'utf8')

      // Ensure buffers are same length before comparison
      if (signatureBuffer.length !== expectedBuffer.length) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }

      if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }

      // Signature verified - now we can parse the body
      const parseResult = Schema.decodeUnknownEither(WebhookPayloadSchema)(JSON.parse(rawBody))

      if (parseResult._tag === 'Left') {
        return NextResponse.json({ error: 'Invalid payload format' }, { status: 400 })
      }

      const payload = parseResult.right

      yield* Effect.annotateCurrentSpan({
        'webhook.payloadType': payload.type
      })

      // Handle different payload types based on discriminator
      if (payload.type === 'started') {
        yield* handleStarted(manifestId)
      } else if (payload.type === 'task_loop_started') {
        yield* handleTaskLoopStarted(manifestId, payload)
      } else if (payload.type === 'progress') {
        yield* handleProgress(manifestId, payload)
      } else if (payload.type === 'completed') {
        yield* handleCompleted(manifestId, manifest.spriteName, payload)
      } else if (payload.type === 'error') {
        yield* handleError(manifestId, manifest.spriteName, payload)
      }

      return NextResponse.json({ success: true })
    }).pipe(
      Effect.withSpan('webhook.manifest', {
        attributes: {
          operation: 'webhook.manifest.receive'
        }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.catchAll(error =>
        Effect.sync(() => {
          console.error('Manifest webhook error:', error)
          return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
        })
      )
    )
  )
}

// Handler for 'started' event - updates manifest status to active
const handleStarted = (manifestId: string) =>
  Effect.gen(function* () {
    const db = yield* Db

    yield* db
      .update(schema.manifests)
      .set({
        status: 'active',
        updatedAt: new Date()
      })
      .where(eq(schema.manifests.id, manifestId))

    yield* Effect.logInfo('Started event handled', { manifestId })
  })

// Handler for 'task_loop_started' event - updates status to running, stores prdJson
const handleTaskLoopStarted = (
  manifestId: string,
  payload: Schema.Schema.Type<typeof TaskLoopStartedPayloadSchema>
) =>
  Effect.gen(function* () {
    const db = yield* Db

    yield* db
      .update(schema.manifests)
      .set({
        status: 'running',
        prdJson: payload.prdJson,
        updatedAt: new Date()
      })
      .where(eq(schema.manifests.id, manifestId))

    yield* Effect.logInfo('Task loop started event handled', { manifestId })
  })

// Handler for 'progress' event - updates prdJson during task loop execution
const handleProgress = (
  manifestId: string,
  payload: Schema.Schema.Type<typeof ProgressPayloadSchema>
) =>
  Effect.gen(function* () {
    const db = yield* Db

    yield* db
      .update(schema.manifests)
      .set({
        prdJson: payload.prdJson,
        updatedAt: new Date()
      })
      .where(eq(schema.manifests.id, manifestId))

    yield* Effect.logInfo('Progress event handled', {
      manifestId,
      iteration: payload.iteration,
      maxIterations: payload.maxIterations
    })
  })

// Handler for 'completed' event - updates status to completed, stores prdJson, destroys sprite
const handleCompleted = (
  manifestId: string,
  spriteName: string | null,
  payload: Schema.Schema.Type<typeof CompletedPayloadSchema>
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const sprites = yield* Sprites

    yield* db
      .update(schema.manifests)
      .set({
        status: 'completed',
        prdJson: payload.prdJson,
        updatedAt: new Date(),
        completedAt: new Date()
      })
      .where(eq(schema.manifests.id, manifestId))

    // Destroy the sprite if we have a sprite name
    if (spriteName) {
      yield* sprites.destroySprite(spriteName).pipe(
        Effect.catchAll(error => {
          // Log but don't fail if sprite destruction fails
          return Effect.logWarning('Failed to destroy sprite', {
            spriteName,
            error
          })
        })
      )
    }

    yield* Effect.logInfo('Completed event handled', { manifestId })
  })

// Handler for 'error' event - updates status to error with errorMessage, destroys sprite
const handleError = (
  manifestId: string,
  spriteName: string | null,
  payload: Schema.Schema.Type<typeof ErrorPayloadSchema>
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const sprites = yield* Sprites

    yield* db
      .update(schema.manifests)
      .set({
        status: 'error',
        errorMessage: payload.error,
        updatedAt: new Date(),
        completedAt: new Date()
      })
      .where(eq(schema.manifests.id, manifestId))

    // Destroy the sprite if we have a sprite name
    if (spriteName) {
      yield* sprites.destroySprite(spriteName).pipe(
        Effect.catchAll(error => {
          // Log but don't fail if sprite destruction fails
          return Effect.logWarning('Failed to destroy sprite', {
            spriteName,
            error
          })
        })
      )
    }

    yield* Effect.logInfo('Error event handled', { manifestId })
  })
