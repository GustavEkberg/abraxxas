import { Effect, Option } from 'effect'
import { eq, and, inArray } from 'drizzle-orm'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'

/**
 * Get the active manifest for a project (pending, active, or running).
 * Returns Option.none() if no active manifest exists.
 * Does NOT verify ownership - caller must verify separately if needed.
 */
export const getActiveManifest = (projectId: string) =>
  Effect.gen(function* () {
    const db = yield* Db

    const [manifest] = yield* db
      .select()
      .from(schema.manifests)
      .where(
        and(
          eq(schema.manifests.projectId, projectId),
          inArray(schema.manifests.status, ['pending', 'active', 'running'])
        )
      )
      .limit(1)

    return Option.fromNullable(manifest)
  }).pipe(Effect.withSpan('Manifest.getActiveManifest'))
