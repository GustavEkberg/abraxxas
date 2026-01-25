'use server'

import { Effect, Match } from 'effect'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { getProject } from '@/lib/core/project/get-project'
import { spawnManifestSprite } from './spawn-manifest-sprite'

type SpawnSpriteInput = {
  projectId: string
  branchName: string
  prdName: string
}

type SpawnSpriteSuccess = {
  _tag: 'Success'
  data: {
    spriteName: string
    spriteUrl: string
  }
}

type SpawnSpriteError = {
  _tag: 'Error'
  message: string
}

type SpawnSpriteResult = SpawnSpriteSuccess | SpawnSpriteError

/**
 * Spawn a sprite for an existing manifest branch.
 * The sprite will auto-start task-loop for the PRD.
 */
export const spawnSpriteAction = async (input: SpawnSpriteInput): Promise<SpawnSpriteResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // Verify user owns the project
      const project = yield* getProject(input.projectId)
      const db = yield* Db

      yield* Effect.annotateCurrentSpan({
        'project.id': project.id,
        'branch.name': input.branchName,
        'prd.name': input.prdName
      })

      // Check if sprite already exists for this branch
      const [existing] = yield* db
        .select()
        .from(schema.sprites)
        .where(
          and(eq(schema.sprites.branchName, input.branchName), eq(schema.sprites.type, 'manifest'))
        )
        .limit(1)

      if (existing && existing.spriteName) {
        return yield* Effect.fail({
          _tag: 'AlreadyRunning' as const,
          message: 'Sprite already running for this manifest'
        })
      }

      // Spawn the sprite
      const spriteResult = yield* spawnManifestSprite({
        project,
        userId: project.userId,
        branchName: input.branchName,
        prdName: input.prdName
      }).pipe(
        Effect.catchAll(error => {
          // Mark sprite as error on failure
          return db
            .insert(schema.sprites)
            .values({
              branchName: input.branchName,
              projectId: input.projectId,
              type: 'manifest',
              status: 'error',
              errorMessage: error.message
            })
            .pipe(
              Effect.catchAll(() => Effect.void),
              Effect.flatMap(() => Effect.fail(error))
            )
        })
      )

      yield* Effect.log(`Sprite spawned: ${spriteResult.spriteName}`)

      return spriteResult
    }).pipe(
      Effect.withSpan('action.manifest.spawnSprite'),
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
            Match.when({ _tag: 'AlreadyRunning' }, e =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: e.message
              })
            ),
            Match.orElse(e =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'message' in e ? e.message : 'Failed to spawn sprite'
              })
            )
          ),
        onSuccess: result =>
          Effect.sync(() => {
            revalidatePath(`/rituals/${input.projectId}`)
            return {
              _tag: 'Success' as const,
              data: result
            }
          })
      })
    )
  )
}
