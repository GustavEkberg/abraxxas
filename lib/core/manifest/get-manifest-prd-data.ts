import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { fetchPrdFromGitHub, type ManifestPrdData } from './fetch-prd-from-github'

export type ManifestPrdDataMap = Record<string, ManifestPrdData>

/**
 * Fetch PRD data from GitHub for all manifests that have prdName set.
 * Returns a map of manifestId -> ManifestPrdData
 *
 * Also detects completion: if a manifest is 'running' and all tasks pass,
 * updates status to 'completed'.
 */
export const getManifestPrdData = (projectId: string) =>
  Effect.gen(function* () {
    const db = yield* Db

    // Get project for repository URL and encrypted token
    const [project] = yield* db
      .select({
        repositoryUrl: schema.projects.repositoryUrl,
        encryptedGithubToken: schema.projects.encryptedGithubToken
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1)

    if (!project) {
      return {}
    }

    // Get all manifests with prdName (include status for completion detection)
    const manifests = yield* db
      .select({
        id: schema.manifests.id,
        prdName: schema.manifests.prdName,
        status: schema.manifests.status
      })
      .from(schema.manifests)
      .where(eq(schema.manifests.projectId, projectId))

    // Filter to only manifests that have prdName set
    const fetchableManifests = manifests.filter(
      (m): m is typeof m & { prdName: string } => m.prdName !== null
    )

    if (fetchableManifests.length === 0) {
      return {}
    }

    // Fetch PRD data for each manifest in parallel, ignoring failures
    const results = yield* Effect.all(
      fetchableManifests.map(manifest =>
        fetchPrdFromGitHub(
          project.repositoryUrl,
          project.encryptedGithubToken,
          schema.getManifestBranchName(manifest.prdName),
          manifest.prdName
        ).pipe(
          Effect.map(data => ({ id: manifest.id, status: manifest.status, data })),
          Effect.catchAll(() =>
            Effect.succeed({
              id: manifest.id,
              status: manifest.status,
              data: { prdJson: null, progress: null }
            })
          )
        )
      ),
      { concurrency: 5 }
    )

    // Build map and detect completion
    const prdDataMap: ManifestPrdDataMap = {}
    const completedManifestIds: string[] = []

    for (const { id, status, data } of results) {
      prdDataMap[id] = data

      // Check for completion: running + all tasks pass
      if (status === 'running' && data.prdJson) {
        const allTasksPass = data.prdJson.tasks.every(t => t.passes)
        if (allTasksPass) {
          completedManifestIds.push(id)
        }
      }
    }

    // Update completed manifests
    if (completedManifestIds.length > 0) {
      yield* Effect.forEach(
        completedManifestIds,
        manifestId =>
          db
            .update(schema.manifests)
            .set({
              status: 'completed',
              updatedAt: new Date(),
              completedAt: new Date()
            })
            .where(eq(schema.manifests.id, manifestId)),
        { concurrency: 'unbounded' }
      )
      yield* Effect.logInfo('Manifests completed via PRD check', {
        manifestIds: completedManifestIds
      })
    }

    return prdDataMap
  }).pipe(Effect.withSpan('manifest.getManifestPrdData'))
