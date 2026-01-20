'use server'

import { Effect, Match } from 'effect'
import { eq, and, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { ValidationError } from '@/lib/core/errors'
import { getProject } from '@/lib/core/project/get-project'
import { generateWebhookSecret } from '@/lib/core/sprites/callback-script'
import { spawnManifestSprite } from './spawn-manifest-sprite'

type CreateManifestInput = {
  projectId: string
  prdName: string
}

type CreateManifestSuccess = {
  _tag: 'Success'
  data: {
    manifest: schema.Manifest
    spriteUrl: string
    spritePassword: string
  }
}

type CreateManifestError = {
  _tag: 'Error'
  message: string
}

type CreateManifestResult = CreateManifestSuccess | CreateManifestError

export const createManifestAction = async (
  input: CreateManifestInput
): Promise<CreateManifestResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // Verify user owns the project
      const project = yield* getProject(input.projectId)
      const db = yield* Db

      yield* Effect.annotateCurrentSpan({
        'project.id': project.id,
        'manifest.prdName': input.prdName
      })

      // Check no active manifest exists for project
      const activeManifests = yield* db
        .select()
        .from(schema.manifests)
        .where(
          and(
            eq(schema.manifests.projectId, input.projectId),
            inArray(schema.manifests.status, ['pending', 'active', 'running'])
          )
        )
        .limit(1)

      if (activeManifests.length > 0) {
        const activeManifest = activeManifests[0]
        return yield* Effect.fail(
          new ValidationError({
            message: `An active manifest already exists for this project (status: ${activeManifest.status})`,
            field: 'projectId'
          })
        )
      }

      // Generate webhook secret upfront so it's in DB before sprite sends webhook
      const webhookSecret = generateWebhookSecret()

      // Create manifest record with status='pending' and webhook secret
      const [manifest] = yield* db
        .insert(schema.manifests)
        .values({
          projectId: input.projectId,
          prdName: input.prdName,
          status: 'pending',
          webhookSecret
        })
        .returning()

      yield* Effect.log(`Created manifest ${manifest.id} with status=pending`)

      // Spawn the sprite
      const spriteResult = yield* spawnManifestSprite({
        manifestId: manifest.id,
        project,
        prdName: input.prdName,
        userId: project.userId
      }).pipe(
        Effect.catchAll(error => {
          // Cleanup: mark manifest as error on failure
          return db
            .update(schema.manifests)
            .set({
              status: 'error',
              errorMessage: error.message
            })
            .where(eq(schema.manifests.id, manifest.id))
            .pipe(
              Effect.catchAll(() => Effect.void),
              Effect.flatMap(() => Effect.fail(error))
            )
        })
      )

      yield* Effect.log(`Sprite spawned: ${spriteResult.spriteName}`)

      // Sprite details already saved in spawnManifestSprite
      // Fetch updated manifest for return value
      const [updatedManifest] = yield* db
        .select()
        .from(schema.manifests)
        .where(eq(schema.manifests.id, manifest.id))
        .limit(1)

      return {
        manifest: updatedManifest,
        spriteUrl: spriteResult.spriteUrl,
        spritePassword: spriteResult.spritePassword
      }
    }).pipe(
      Effect.withSpan('action.manifest.create'),
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
                message: 'You do not have access to this project'
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
            revalidatePath(`/rituals/${result.manifest.projectId}`)
            return {
              _tag: 'Success' as const,
              data: result
            }
          })
      })
    )
  )
}
