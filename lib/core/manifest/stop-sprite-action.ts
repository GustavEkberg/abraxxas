'use server'

import { Effect, Match } from 'effect'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import { Sprites } from '@/lib/services/sprites/live-layer'
import * as schema from '@/lib/services/db/schema'
import { getProject } from '@/lib/core/project/get-project'

type StopSpriteSuccess = {
  _tag: 'Success'
}

type StopSpriteError = {
  _tag: 'Error'
  message: string
}

type StopSpriteResult = StopSpriteSuccess | StopSpriteError

/**
 * Stop and destroy a sprite for a manifest branch.
 * Removes the sprite record from DB.
 */
export const stopSpriteAction = async (
  projectId: string,
  branchName: string
): Promise<StopSpriteResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // Verify user owns the project
      yield* getProject(projectId)
      const db = yield* Db
      const spritesService = yield* Sprites

      yield* Effect.annotateCurrentSpan({
        'project.id': projectId,
        'branch.name': branchName
      })

      // Get sprite record
      const [sprite] = yield* db
        .select()
        .from(schema.sprites)
        .where(and(eq(schema.sprites.branchName, branchName), eq(schema.sprites.type, 'manifest')))
        .limit(1)

      if (!sprite) {
        return yield* Effect.fail({
          _tag: 'NotFound' as const,
          message: 'No sprite found for this manifest'
        })
      }

      // Destroy sprite if it exists
      if (sprite.spriteName) {
        yield* spritesService.destroySprite(sprite.spriteName).pipe(
          Effect.tapError(error =>
            Effect.logWarning('Failed to destroy sprite', {
              spriteName: sprite.spriteName,
              branchName,
              error
            })
          ),
          Effect.catchAll(() => Effect.void)
        )
        yield* Effect.log(`Sprite destroyed: ${sprite.spriteName}`)
      }

      // Delete sprite record
      yield* db.delete(schema.sprites).where(eq(schema.sprites.id, sprite.id))

      yield* Effect.log(`Sprite record deleted for branch ${branchName}`)

      return {}
    }).pipe(
      Effect.withSpan('action.manifest.stopSprite'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error).pipe(
            Match.when({ _tag: 'UnauthenticatedError' }, () => NextEffect.redirect('/login')),
            Match.when({ _tag: 'NotFoundError' }, () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Project not found'
              })
            ),
            Match.when({ _tag: 'UnauthorizedError' }, () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'You do not have access to this project'
              })
            ),
            Match.when({ _tag: 'NotFound' }, e =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: e.message
              })
            ),
            Match.orElse(e =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'message' in e ? e.message : 'Failed to stop sprite'
              })
            )
          ),
        onSuccess: () =>
          Effect.sync(() => {
            revalidatePath(`/rituals/${projectId}`)
            return { _tag: 'Success' as const }
          })
      })
    )
  )
}
