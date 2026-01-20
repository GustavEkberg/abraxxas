import { Effect } from 'effect'
import { eq, desc } from 'drizzle-orm'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { getProject } from '@/lib/core/project/get-project'

/**
 * Get all manifests for a project, ordered by createdAt descending.
 * Verifies user owns the project before returning results.
 */
export const getManifests = (projectId: string) =>
  Effect.gen(function* () {
    // Verify user owns the project (throws UnauthorizedError if not)
    yield* getProject(projectId)
    const db = yield* Db

    const manifests = yield* db
      .select()
      .from(schema.manifests)
      .where(eq(schema.manifests.projectId, projectId))
      .orderBy(desc(schema.manifests.createdAt))

    return manifests
  }).pipe(Effect.withSpan('Manifest.getManifests'))
