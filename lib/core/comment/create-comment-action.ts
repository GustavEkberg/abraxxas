'use server'

import { Effect, Match } from 'effect'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { getSession } from '@/lib/services/auth/get-session'
import { eq } from 'drizzle-orm'
import { NotFoundError, UnauthorizedError } from '@/lib/core/errors'

type CreateCommentInput = {
  taskId: string
  content: string
}

export const createCommentAction = async (input: CreateCommentInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const { user } = yield* getSession()
      const db = yield* Db

      // Fetch task to get projectId
      const tasks = yield* db.select().from(schema.tasks).where(eq(schema.tasks.id, input.taskId))

      if (tasks.length === 0) {
        return yield* Effect.fail(
          new NotFoundError({
            message: 'Task not found',
            entity: 'task',
            id: input.taskId
          })
        )
      }

      const task = tasks[0]

      // Verify user owns the parent project
      const projects = yield* db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, task.projectId))

      if (projects.length === 0) {
        return yield* Effect.fail(
          new NotFoundError({
            message: 'Project not found',
            entity: 'project',
            id: task.projectId
          })
        )
      }

      const project = projects[0]

      if (project.userId !== user.id) {
        return yield* Effect.fail(
          new UnauthorizedError({
            message: 'You do not have access to this project'
          })
        )
      }

      yield* Effect.annotateCurrentSpan({
        'comment.taskId': input.taskId,
        'comment.userId': user.id,
        'comment.contentLength': input.content.length
      })

      // Create the comment
      const [comment] = yield* db
        .insert(schema.comments)
        .values({
          taskId: input.taskId,
          userId: user.id,
          isAgentComment: false,
          content: input.content
        })
        .returning()

      return { comment, projectId: task.projectId }
    }).pipe(
      Effect.withSpan('action.comment.create', {
        attributes: {
          operation: 'comment.create'
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
                message: 'You do not have access to this task'
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: `Failed to create comment: ${error.message}`
              })
            )
          ),
        onSuccess: ({ comment, projectId }) =>
          Effect.sync(() => {
            revalidatePath(`/rituals/${projectId}`)
            return { _tag: 'Success' as const, data: comment }
          })
      })
    )
  )
}
