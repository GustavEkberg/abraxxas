import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { Db } from '@/lib/services/db/live-layer'
import { Sprites } from '@/lib/services/sprites/live-layer'
import * as schema from '@/lib/services/db/schema'

/**
 * Complete a manifest sprite - destroy it and remove the record.
 * Called when all PRD tasks pass.
 *
 * @internal This is an internal function, not a server action.
 */
export const completeManifestSprite = (sprite: schema.Sprite) =>
  Effect.gen(function* () {
    const db = yield* Db
    const spritesService = yield* Sprites

    yield* Effect.annotateCurrentSpan({
      'sprite.id': sprite.id,
      'sprite.name': sprite.spriteName ?? 'unknown',
      'branch.name': sprite.branchName
    })

    // Destroy sprite if it exists
    if (sprite.spriteName) {
      yield* spritesService.destroySprite(sprite.spriteName).pipe(
        Effect.tap(() =>
          Effect.log(`Manifest sprite destroyed on completion: ${sprite.spriteName}`)
        ),
        Effect.tapError(error =>
          Effect.logWarning('Failed to destroy manifest sprite on completion', {
            spriteName: sprite.spriteName,
            branchName: sprite.branchName,
            error
          })
        ),
        Effect.catchAll(() => Effect.void)
      )
    }

    // Delete sprite record from DB
    yield* db.delete(schema.sprites).where(eq(schema.sprites.id, sprite.id))

    yield* Effect.log(`Manifest sprite record deleted for completed branch: ${sprite.branchName}`)
  }).pipe(Effect.withSpan('Manifest.completeManifestSprite'))
