import { Effect } from 'effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'

type CreateSessionInput = {
  taskId: string
  sessionId: string
  executionMode: 'local' | 'sprite'
  spriteName?: string | null
  webhookSecret?: string | null
  branchName?: string | null
}

export const createSession = (input: CreateSessionInput) =>
  Effect.gen(function* () {
    const db = yield* Db

    yield* Effect.annotateCurrentSpan({
      'session.taskId': input.taskId,
      'session.executionMode': input.executionMode,
      'session.spriteName': input.spriteName || 'none'
    })

    const [session] = yield* db
      .insert(schema.opencodeSessions)
      .values({
        taskId: input.taskId,
        sessionId: input.sessionId,
        status: 'pending',
        executionMode: input.executionMode,
        spriteName: input.spriteName || null,
        webhookSecret: input.webhookSecret || null,
        branchName: input.branchName || null
      })
      .returning()

    return session
  }).pipe(
    Effect.withSpan('Session.create', {
      attributes: {
        operation: 'session.create'
      }
    })
  )
