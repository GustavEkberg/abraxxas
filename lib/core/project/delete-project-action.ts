'use server'

import { Effect, Match } from 'effect'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { getProject } from '@/lib/core/project/get-project'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { eq } from 'drizzle-orm'

export const deleteProjectAction = async (projectId: string) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // Verify user owns project before delete
      const project = yield* getProject(projectId)
      const db = yield* Db

      yield* Effect.annotateCurrentSpan({
        'project.id': projectId,
        'project.name': project.name
      })

      // Delete the project (cascade will delete tasks, comments, sessions)
      yield* db.delete(schema.projects).where(eq(schema.projects.id, projectId))

      return { projectId }
    }).pipe(
      Effect.withSpan('action.project.delete', {
        attributes: {
          operation: 'project.delete'
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
                message: 'Project not found'
              })
            ),
            Match.when('UnauthorizedError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'You do not have permission to delete this project'
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: `Failed to delete project: ${error.message}`
              })
            )
          ),
        onSuccess: result =>
          Effect.sync(() => {
            revalidatePath('/')
            return { _tag: 'Success' as const, data: result }
          })
      })
    )
  )
}
