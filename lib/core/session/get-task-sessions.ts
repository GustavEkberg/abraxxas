import { Effect } from 'effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { inArray, desc } from 'drizzle-orm'

export const getTaskSessions = (taskIds: string[]) =>
  Effect.gen(function* () {
    if (taskIds.length === 0) {
      return []
    }

    const db = yield* Db

    yield* Effect.annotateCurrentSpan({
      'session.taskIds': taskIds.join(','),
      'session.taskCount': taskIds.length
    })

    const sessions = yield* db
      .select()
      .from(schema.opencodeSessions)
      .where(inArray(schema.opencodeSessions.taskId, taskIds))
      .orderBy(desc(schema.opencodeSessions.createdAt))

    return sessions
  }).pipe(
    Effect.withSpan('Session.getTaskSessions', {
      attributes: {
        operation: 'session.getTaskSessions'
      }
    })
  )
