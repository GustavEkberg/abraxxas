'use server'

import { Effect, Match } from 'effect'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { NotFoundError, ValidationError } from '@/lib/core/errors'
import { getProject } from '@/lib/core/project/get-project'

type UpdatePrdNameResult = { _tag: 'Success' } | { _tag: 'Error'; message: string }

const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export const updatePrdNameAction = async (
  manifestId: string,
  prdName: string
): Promise<UpdatePrdNameResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const db = yield* Db

      yield* Effect.annotateCurrentSpan({ 'manifest.id': manifestId, 'manifest.prdName': prdName })

      // Validate prd name format
      if (!KEBAB_CASE_REGEX.test(prdName)) {
        return yield* Effect.fail(
          new ValidationError({
            message: 'PRD name must be kebab-case (e.g., my-feature)',
            field: 'prdName'
          })
        )
      }

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

      // Can only update prd name when manifest is active (not running/completed)
      if (manifest.status !== 'active' && manifest.status !== 'pending') {
        return yield* Effect.fail(
          new ValidationError({
            message: `Cannot update PRD name when manifest is ${manifest.status}`,
            field: 'status'
          })
        )
      }

      // Verify user owns parent project
      yield* getProject(manifest.projectId)

      // Update prd name
      yield* db
        .update(schema.manifests)
        .set({ prdName, updatedAt: new Date() })
        .where(eq(schema.manifests.id, manifestId))

      yield* Effect.log(`Updated prd name to ${prdName} for manifest ${manifestId}`)

      return { projectId: manifest.projectId }
    }).pipe(
      Effect.withSpan('action.manifest.updatePrdName'),
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
