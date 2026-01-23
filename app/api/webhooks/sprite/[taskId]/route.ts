import { Effect, Schema } from 'effect'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { AppLayer } from '@/lib/layers'
import { Db } from '@/lib/services/db/live-layer'
import { Sprites } from '@/lib/services/sprites/live-layer'
import * as schema from '@/lib/services/db/schema'
import { getLatestSession } from '@/lib/core/session/get-latest-session'
import { updateSession } from '@/lib/core/session/update-session'
import { createAgentComment } from '@/lib/core/comment/create-agent-comment'
import { createHmac, timingSafeEqual } from 'crypto'

type RouteContext = {
  params: Promise<{ taskId: string }>
}

// Webhook payload schemas
const StartedPayloadSchema = Schema.Struct({
  type: Schema.Literal('started'),
  message: Schema.optional(Schema.String)
})

const ProgressDataSchema = Schema.Struct({
  messageCount: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  message: Schema.optional(Schema.String)
})

const ProgressPayloadSchema = Schema.Struct({
  type: Schema.Literal('progress'),
  progress: ProgressDataSchema
})

const StatsSchema = Schema.Struct({
  messageCount: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number
})

const CompletedPayloadSchema = Schema.Struct({
  type: Schema.Literal('completed'),
  summary: Schema.optional(Schema.String),
  pullRequestUrl: Schema.optional(Schema.String),
  branchName: Schema.optional(Schema.String),
  stats: Schema.optional(StatsSchema)
})

const ErrorPayloadSchema = Schema.Struct({
  type: Schema.Literal('error'),
  error: Schema.String
})

const QuestionPayloadSchema = Schema.Struct({
  type: Schema.Literal('question'),
  question: Schema.String
})

const WebhookPayloadSchema = Schema.Union(
  StartedPayloadSchema,
  ProgressPayloadSchema,
  CompletedPayloadSchema,
  ErrorPayloadSchema,
  QuestionPayloadSchema
)

export async function POST(request: NextRequest, context: RouteContext) {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const { taskId } = yield* Effect.promise(() => context.params)

      yield* Effect.annotateCurrentSpan({
        'webhook.taskId': taskId,
        'webhook.type': 'sprite'
      })

      // Get the raw body as text for signature verification
      const rawBody = yield* Effect.promise(() => request.text())

      // Get the signature from headers
      const signature = request.headers.get('X-Webhook-Signature')
      if (!signature) {
        return NextResponse.json({ error: 'Missing X-Webhook-Signature header' }, { status: 401 })
      }

      // Fetch the latest session to get the webhook secret
      const session = yield* getLatestSession(taskId)
      if (!session.webhookSecret) {
        return NextResponse.json({ error: 'No webhook secret found for session' }, { status: 500 })
      }

      // Verify the signature using timing-safe comparison
      // Client sends "sha256=<hex>", extract just the hex part
      const signatureHex = signature.startsWith('sha256=') ? signature.slice(7) : signature

      const expectedSignature = createHmac('sha256', session.webhookSecret)
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
        yield* handleStarted(taskId, session.id, payload)
      } else if (payload.type === 'progress') {
        yield* handleProgress(session.id, payload)
      } else if (payload.type === 'completed') {
        yield* handleCompleted(taskId, session.id, session.spriteName, payload)
      } else if (payload.type === 'error') {
        yield* handleError(taskId, session.id, session.spriteName, payload)
      } else if (payload.type === 'question') {
        yield* handleQuestion(taskId, payload)
      }

      return NextResponse.json({ success: true })
    }).pipe(
      Effect.withSpan('webhook.sprite', {
        attributes: {
          operation: 'webhook.sprite.receive'
        }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.catchAll(error =>
        Effect.sync(() => {
          console.error('Webhook error:', error)
          return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
        })
      )
    )
  )
}

// Handler for 'started' event - posts agent comment
const handleStarted = (
  taskId: string,
  sessionId: string,
  payload: Schema.Schema.Type<typeof StartedPayloadSchema>
) =>
  Effect.gen(function* () {
    yield* updateSession({
      sessionId,
      status: 'in_progress'
    })

    const message = payload.message || 'Sprite execution started'
    yield* createAgentComment({
      taskId,
      content: `🔥 **Execution started**\n\n${message}`,
      agentName: 'Abraxas'
    })

    yield* Effect.logInfo('Started event handled', { taskId, sessionId })
  })

// Handler for 'progress' event - updates session stats
const handleProgress = (
  sessionId: string,
  payload: Schema.Schema.Type<typeof ProgressPayloadSchema>
) =>
  Effect.gen(function* () {
    const { progress } = payload
    yield* updateSession({
      sessionId,
      messageCount: String(progress.messageCount),
      inputTokens: String(progress.inputTokens),
      outputTokens: String(progress.outputTokens)
    })

    yield* Effect.logInfo('Progress event handled', {
      sessionId,
      messageCount: progress.messageCount,
      inputTokens: progress.inputTokens,
      outputTokens: progress.outputTokens
    })
  })

// Handler for 'completed' event - moves task to trial, posts summary, destroys sprite
const handleCompleted = (
  taskId: string,
  sessionId: string,
  spriteName: string | null,
  payload: Schema.Schema.Type<typeof CompletedPayloadSchema>
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const sprites = yield* Sprites

    // Update session to completed with stats and branchName if available
    yield* updateSession({
      sessionId,
      status: 'completed',
      completedAt: new Date(),
      pullRequestUrl: payload.pullRequestUrl || null,
      branchName: payload.branchName || null,
      ...(payload.stats && {
        messageCount: String(payload.stats.messageCount),
        inputTokens: String(payload.stats.inputTokens),
        outputTokens: String(payload.stats.outputTokens)
      })
    })

    // Move task to 'trial' status, set executionState to 'awaiting_review', and update branchName
    yield* db
      .update(schema.tasks)
      .set({
        status: 'trial',
        executionState: 'awaiting_review',
        completedAt: new Date(),
        ...(payload.branchName && { branchName: payload.branchName })
      })
      .where(eq(schema.tasks.id, taskId))

    // Post completion comment with stats
    const summary = payload.summary || 'Task execution completed successfully'
    const prLink = payload.pullRequestUrl ? `\n\n**PR:** ${payload.pullRequestUrl}` : ''
    const statsText = payload.stats
      ? `\n\n**Stats:** ${payload.stats.messageCount} messages, ${payload.stats.inputTokens} input tokens, ${payload.stats.outputTokens} output tokens`
      : ''
    yield* createAgentComment({
      taskId,
      content: `✓ **Execution completed**\n\n${summary}${prLink}${statsText}`,
      agentName: 'Abraxas'
    })

    // Destroy sprite and clear credentials (suppress errors - sprite may already be destroyed)
    if (spriteName) {
      yield* sprites.destroySprite(spriteName).pipe(
        Effect.catchAll(error => {
          return Effect.logWarning('Failed to destroy sprite on completion', {
            spriteName,
            error
          })
        })
      )
      // Clear sprite credentials from session
      yield* updateSession({
        sessionId,
        spriteName: null,
        spriteUrl: null
      })
      yield* Effect.logInfo('Sprite destroyed on completion', { spriteName })
    }

    yield* Effect.logInfo('Completed event handled', { taskId, sessionId })
  })

// Handler for 'error' event - moves task to cursed, logs error, destroys sprite
const handleError = (
  taskId: string,
  sessionId: string,
  spriteName: string | null,
  payload: Schema.Schema.Type<typeof ErrorPayloadSchema>
) =>
  Effect.gen(function* () {
    const db = yield* Db
    const sprites = yield* Sprites

    // Update session to error and save error to logs for debugging
    yield* updateSession({
      sessionId,
      status: 'error',
      errorMessage: payload.error,
      logs: payload.error,
      completedAt: new Date()
    })

    // Move task to 'cursed' status and set executionState to 'error'
    yield* db
      .update(schema.tasks)
      .set({
        status: 'cursed',
        executionState: 'error'
      })
      .where(eq(schema.tasks.id, taskId))

    // Post error comment
    yield* createAgentComment({
      taskId,
      content: `✗ **Execution failed**\n\n**Error:** ${payload.error}\n\nPlease review the error and try again.`,
      agentName: 'Abraxas'
    })

    // Destroy sprite even on error and clear credentials (suppress errors - sprite may already be destroyed)
    if (spriteName) {
      yield* sprites.destroySprite(spriteName).pipe(
        Effect.catchAll(error => {
          return Effect.logWarning('Failed to destroy sprite on error', {
            spriteName,
            error
          })
        })
      )
      // Clear sprite credentials from session
      yield* updateSession({
        sessionId,
        spriteName: null,
        spriteUrl: null
      })
      yield* Effect.logInfo('Sprite destroyed on error', { spriteName })
    }

    yield* Effect.logInfo('Error event handled', { taskId, sessionId })
  })

// Handler for 'question' event - posts question as agent comment
const handleQuestion = (
  taskId: string,
  payload: Schema.Schema.Type<typeof QuestionPayloadSchema>
) =>
  Effect.gen(function* () {
    yield* createAgentComment({
      taskId,
      content: `❓ **Question from Abraxas:**\n\n${payload.question}\n\nPlease respond in the comments to continue execution.`,
      agentName: 'Abraxas'
    })

    yield* Effect.logInfo('Question event handled', { taskId, question: payload.question })
  })
