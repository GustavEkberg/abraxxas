import { Effect, Schema } from 'effect'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { AppLayer } from '@/lib/layers'
import { getLatestSession } from '@/lib/core/session/get-latest-session'
import { createHmac, timingSafeEqual } from 'crypto'

type RouteContext = {
  params: Promise<{ taskId: string }>
}

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
      const expectedSignature = createHmac('sha256', session.webhookSecret)
        .update(rawBody)
        .digest('hex')

      const signatureBuffer = Buffer.from(signature, 'utf8')
      const expectedBuffer = Buffer.from(expectedSignature, 'utf8')

      // Ensure buffers are same length before comparison
      if (signatureBuffer.length !== expectedBuffer.length) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }

      if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }

      // Signature verified - now we can parse the body
      const PayloadSchema = Schema.Struct({
        type: Schema.String
      })

      const parseResult = Schema.decodeUnknownEither(PayloadSchema)(JSON.parse(rawBody))

      if (parseResult._tag === 'Left') {
        return NextResponse.json({ error: 'Invalid payload format' }, { status: 400 })
      }

      const payload = parseResult.right

      // TODO: Handle different payload types in api-2
      yield* Effect.logInfo('Webhook received', {
        taskId,
        type: payload.type
      })

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
