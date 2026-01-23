'use server'

import { Effect, Match } from 'effect'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import { Sprites } from '@/lib/services/sprites/live-layer'
import * as schema from '@/lib/services/db/schema'
import { getSession } from '@/lib/services/auth/get-session'
import { NotFoundError, UnauthorizedError } from '@/lib/core/errors'

type DestroySpriteResult = { _tag: 'Success' } | { _tag: 'Error'; message: string }

export const destroySpriteAction = async (sessionId: string): Promise<DestroySpriteResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const { user } = yield* getSession()
      const db = yield* Db
      const sprites = yield* Sprites

      yield* Effect.annotateCurrentSpan({ 'session.id': sessionId })

      // Fetch the session
      const [opencodeSession] = yield* db
        .select()
        .from(schema.opencodeSessions)
        .where(eq(schema.opencodeSessions.id, sessionId))
        .limit(1)

      if (!opencodeSession) {
        return yield* Effect.fail(
          new NotFoundError({
            message: 'Session not found',
            entity: 'session',
            id: sessionId
          })
        )
      }

      // Fetch the task to get the project
      const [task] = yield* db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, opencodeSession.taskId))
        .limit(1)

      if (!task) {
        return yield* Effect.fail(
          new NotFoundError({
            message: 'Task not found',
            entity: 'task',
            id: opencodeSession.taskId
          })
        )
      }

      // Fetch the project to verify ownership
      const [project] = yield* db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, task.projectId))
        .limit(1)

      if (!project) {
        return yield* Effect.fail(
          new NotFoundError({
            message: 'Project not found',
            entity: 'project',
            id: task.projectId
          })
        )
      }

      if (project.userId !== user.id) {
        return yield* Effect.fail(
          new UnauthorizedError({
            message: 'You do not have access to this sprite'
          })
        )
      }

      yield* Effect.annotateCurrentSpan({
        'sprite.name': opencodeSession.spriteName,
        'task.id': task.id,
        'project.id': project.id
      })

      // Destroy the sprite if it exists
      if (opencodeSession.spriteName) {
        yield* sprites.destroySprite(opencodeSession.spriteName).pipe(
          Effect.catchAll(error => {
            // Log but don't fail - sprite may already be gone
            return Effect.logWarning('Failed to destroy sprite', {
              spriteName: opencodeSession.spriteName,
              error
            })
          })
        )
        yield* Effect.log(`Destroyed sprite ${opencodeSession.spriteName}`)
      }

      // Clear sprite credentials from session record
      yield* db
        .update(schema.opencodeSessions)
        .set({
          spriteName: null,
          spriteUrl: null
        })
        .where(eq(schema.opencodeSessions.id, sessionId))

      yield* Effect.log(`Cleared sprite credentials from session ${sessionId}`)

      return { projectId: project.id }
    }).pipe(
      Effect.withSpan('action.sprite.destroy'),
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
                message: 'You do not have permission to destroy this sprite'
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'message' in error ? error.message : 'Failed to destroy sprite'
              })
            )
          ),
        onSuccess: result =>
          Effect.sync(() => {
            revalidatePath(`/rituals/${result.projectId}`)
            return { _tag: 'Success' as const }
          })
      })
    )
  )
}
