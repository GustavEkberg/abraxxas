import { Effect } from 'effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { eq } from 'drizzle-orm'

type UpdateSessionInput = {
  sessionId: string
  status?: 'pending' | 'in_progress' | 'completed' | 'error'
  pullRequestUrl?: string | null
  branchName?: string | null
  errorMessage?: string | null
  logs?: string | null
  messageCount?: string | null
  inputTokens?: string | null
  outputTokens?: string | null
  completedAt?: Date | null
  spriteName?: string | null
  spriteUrl?: string | null
  spritePassword?: string | null
}

export const updateSession = (input: UpdateSessionInput) =>
  Effect.gen(function* () {
    const db = yield* Db

    yield* Effect.annotateCurrentSpan({
      'session.id': input.sessionId,
      'session.status': input.status || 'unchanged'
    })

    // Build partial update object
    const updateData: Partial<schema.InsertOpencodeSession> = {}

    if (input.status !== undefined) {
      updateData.status = input.status
    }

    if (input.pullRequestUrl !== undefined) {
      updateData.pullRequestUrl = input.pullRequestUrl
    }

    if (input.branchName !== undefined) {
      updateData.branchName = input.branchName
    }

    if (input.errorMessage !== undefined) {
      updateData.errorMessage = input.errorMessage
    }

    if (input.logs !== undefined) {
      updateData.logs = input.logs
    }

    if (input.messageCount !== undefined) {
      updateData.messageCount = input.messageCount
    }

    if (input.inputTokens !== undefined) {
      updateData.inputTokens = input.inputTokens
    }

    if (input.outputTokens !== undefined) {
      updateData.outputTokens = input.outputTokens
    }

    if (input.completedAt !== undefined) {
      updateData.completedAt = input.completedAt
    }

    if (input.spriteName !== undefined) {
      updateData.spriteName = input.spriteName
    }

    if (input.spriteUrl !== undefined) {
      updateData.spriteUrl = input.spriteUrl
    }

    if (input.spritePassword !== undefined) {
      updateData.spritePassword = input.spritePassword
    }

    const [session] = yield* db
      .update(schema.opencodeSessions)
      .set(updateData)
      .where(eq(schema.opencodeSessions.id, input.sessionId))
      .returning()

    return session
  }).pipe(
    Effect.withSpan('Session.update', {
      attributes: {
        operation: 'session.update'
      }
    })
  )
