import { Effect } from 'effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { eq, desc } from 'drizzle-orm'
import { NotFoundError } from '@/lib/core/errors'

export const getLatestSession = (taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Db

    yield* Effect.annotateCurrentSpan({
      'session.taskId': taskId
    })

    const sessions = yield* db
      .select()
      .from(schema.opencodeSessions)
      .where(eq(schema.opencodeSessions.taskId, taskId))
      .orderBy(desc(schema.opencodeSessions.createdAt))
      .limit(1)

    if (sessions.length === 0) {
      return yield* Effect.fail(
        new NotFoundError({
          message: 'No session found for task',
          entity: 'session',
          id: taskId
        })
      )
    }

    return sessions[0]
  }).pipe(
    Effect.withSpan('Session.getLatest', {
      attributes: {
        operation: 'session.getLatest'
      }
    })
  )
