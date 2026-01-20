'use server'

import { Effect, Match } from 'effect'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import { Sprites } from '@/lib/services/sprites/live-layer'
import * as schema from '@/lib/services/db/schema'
import { NotFoundError, ValidationError } from '@/lib/core/errors'
import { getProject } from '@/lib/core/project/get-project'

type StartTaskLoopResult = { _tag: 'Success' } | { _tag: 'Error'; message: string }

export const startTaskLoopAction = async (manifestId: string): Promise<StartTaskLoopResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const db = yield* Db
      const sprites = yield* Sprites

      yield* Effect.annotateCurrentSpan({ 'manifest.id': manifestId })

      // Fetch manifest
      const [manifest] = yield* db
        .select()
        .from(schema.manifests)
        .where(eq(schema.manifests.id, manifestId))
        .limit(1)

      if (!manifest) {
        return yield* Effect.fail(
          new NotFoundError({
            message: 'Manifest not found',
            entity: 'manifest',
            id: manifestId
          })
        )
      }

      // Verify manifest is active
      if (manifest.status !== 'active') {
        return yield* Effect.fail(
          new ValidationError({
            message: `Manifest must be active to start task loop (current: ${manifest.status})`,
            field: 'status'
          })
        )
      }

      // Verify sprite name exists
      if (!manifest.spriteName) {
        return yield* Effect.fail(
          new ValidationError({
            message: 'Manifest has no sprite associated',
            field: 'spriteName'
          })
        )
      }

      // Verify user owns parent project
      yield* getProject(manifest.projectId)

      yield* Effect.annotateCurrentSpan({
        'sprite.name': manifest.spriteName,
        'manifest.prdName': manifest.prdName
      })

      // Execute task-loop command on sprite
      yield* sprites.execCommand(manifest.spriteName, ['task-loop', manifest.prdName])

      yield* Effect.log(`Started task loop on sprite ${manifest.spriteName}`)

      return { projectId: manifest.projectId }
    }).pipe(
      Effect.withSpan('action.manifest.startTaskLoop'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('NotFoundError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Manifest not found'
              })
            ),
            Match.when('UnauthorizedError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'You do not have access to this manifest'
              })
            ),
            Match.when('ValidationError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
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
