'use server'

import { Effect, Match } from 'effect'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import { Sprites } from '@/lib/services/sprites/live-layer'
import * as schema from '@/lib/services/db/schema'
import { NotFoundError } from '@/lib/core/errors'
import { getProject } from '@/lib/core/project/get-project'

type DeleteManifestResult = { _tag: 'Success' } | { _tag: 'Error'; message: string }

export const deleteManifestAction = async (manifestId: string): Promise<DeleteManifestResult> => {
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

      // Verify user owns parent project
      yield* getProject(manifest.projectId)

      yield* Effect.annotateCurrentSpan({
        'sprite.name': manifest.spriteName,
        'project.id': manifest.projectId
      })

      // Destroy sprite if exists
      if (manifest.spriteName) {
        yield* sprites.destroySprite(manifest.spriteName).pipe(
          Effect.catchAll(error => {
            // Log but don't fail - sprite may already be gone
            return Effect.logWarning('Failed to destroy sprite', {
              spriteName: manifest.spriteName,
              error
            })
          })
        )
        yield* Effect.log(`Destroyed sprite ${manifest.spriteName}`)
      }

      // Delete manifest from database
      yield* db.delete(schema.manifests).where(eq(schema.manifests.id, manifestId))

      yield* Effect.log(`Deleted manifest ${manifestId}`)

      return { projectId: manifest.projectId }
    }).pipe(
      Effect.withSpan('action.manifest.delete'),
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
