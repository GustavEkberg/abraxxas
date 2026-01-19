'use server'

import { Effect, Match } from 'effect'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { getSession } from '@/lib/services/auth/get-session'
import { NotFoundError, UnauthorizedError } from '@/lib/core/errors'

export const deleteTaskAction = async (taskId: string) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const { user } = yield* getSession()
      const db = yield* Db

      // Fetch the task to verify it exists and get its projectId
      const existingTasks = yield* db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId))

      if (existingTasks.length === 0) {
        return yield* Effect.fail(
          new NotFoundError({
            message: 'Task not found',
            entity: 'task',
            id: taskId
          })
        )
      }

      const task = existingTasks[0]

      // Verify user owns the parent project
      const projects = yield* db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, task.projectId))

      if (projects.length === 0) {
        return yield* Effect.fail(
          new NotFoundError({
            message: 'Parent project not found',
            entity: 'project',
            id: task.projectId
          })
        )
      }

      const project = projects[0]

      if (project.userId !== user.id) {
        return yield* Effect.fail(
          new UnauthorizedError({
            message: 'You do not have access to this task'
          })
        )
      }

      yield* Effect.annotateCurrentSpan({
        'task.id': taskId,
        'task.title': task.title,
        'project.id': project.id
      })

      // Delete the task (cascade will delete comments and sessions)
      yield* db.delete(schema.tasks).where(eq(schema.tasks.id, taskId))

      return { taskId, projectId: project.id }
    }).pipe(
      Effect.withSpan('action.task.delete', {
        attributes: {
          operation: 'task.delete'
        }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('NotFoundError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.when('UnauthorizedError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'You do not have permission to delete this task'
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: `Failed to delete task: ${error.message}`
              })
            )
          ),
        onSuccess: result =>
          Effect.sync(() => {
            revalidatePath(`/rituals/${result.projectId}`)
            return { _tag: 'Success' as const, data: result }
          })
      })
    )
  )
}
