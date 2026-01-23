import { Effect, Schema } from 'effect'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { createHmac, timingSafeEqual } from 'crypto'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'

type RouteContext = {
  params: Promise<{ manifestId: string }>
}

// Webhook payload schemas
const StartedPayloadSchema = Schema.Struct({
  type: Schema.Literal('started'),
  message: Schema.optional(Schema.String)
})

const BranchReadyPayloadSchema = Schema.Struct({
  type: Schema.Literal('branch_ready'),
  branchName: Schema.String
})

const ErrorPayloadSchema = Schema.Struct({
  type: Schema.Literal('error'),
  error: Schema.String
})

const WebhookPayloadSchema = Schema.Union(
  StartedPayloadSchema,
  BranchReadyPayloadSchema,
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
        yield* handleStarted(manifestId, manifest.projectId)
      } else if (payload.type === 'branch_ready') {
        yield* handleBranchReady(manifestId, manifest.projectId, payload)
      } else if (payload.type === 'error') {
        yield* handleError(manifestId, manifest.projectId, payload)
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
const handleStarted = (manifestId: string, projectId: string) =>
  Effect.gen(function* () {
    const db = yield* Db

    yield* db
      .update(schema.manifests)
      .set({
        status: 'active',
        updatedAt: new Date()
      })
      .where(eq(schema.manifests.id, manifestId))

    revalidatePath(`/rituals/${projectId}`)
    yield* Effect.logInfo('Started event handled', { manifestId })
  })

// Handler for 'branch_ready' event - updates status to running and stores branchName
// Sent by /prd-task-hook after creating and pushing the PRD branch
const handleBranchReady = (
  manifestId: string,
  projectId: string,
  payload: Schema.Schema.Type<typeof BranchReadyPayloadSchema>
) =>
  Effect.gen(function* () {
    const db = yield* Db

    yield* db
      .update(schema.manifests)
      .set({
        status: 'running',
        branchName: payload.branchName,
        updatedAt: new Date()
      })
      .where(eq(schema.manifests.id, manifestId))

    revalidatePath(`/rituals/${projectId}`)
    yield* Effect.logInfo('Branch ready event handled', {
      manifestId,
      branchName: payload.branchName
    })
  })

// Handler for 'error' event - updates status to error with errorMessage
// Note: Sprite is NOT destroyed here - user must explicitly delete the manifest
const handleError = (
  manifestId: string,
  projectId: string,
  payload: Schema.Schema.Type<typeof ErrorPayloadSchema>
) =>
  Effect.gen(function* () {
    const db = yield* Db

    yield* db
      .update(schema.manifests)
      .set({
        status: 'error',
        errorMessage: payload.error,
        updatedAt: new Date(),
        completedAt: new Date()
      })
      .where(eq(schema.manifests.id, manifestId))

    revalidatePath(`/rituals/${projectId}`)
    yield* Effect.logInfo('Error event handled', { manifestId })
  })
