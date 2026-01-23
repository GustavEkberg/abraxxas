import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { fetchPrdFromGitHub, type ManifestPrdData } from './fetch-prd-from-github'

export type ManifestPrdDataMap = Record<string, ManifestPrdData>

/**
 * Fetch PRD data from GitHub for all manifests that have branchName and prdName set.
 * Returns a map of manifestId -> ManifestPrdData
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

    // Get all manifests with branchName and prdName
    const manifests = yield* db
      .select({
        id: schema.manifests.id,
        branchName: schema.manifests.branchName,
        prdName: schema.manifests.prdName
      })
      .from(schema.manifests)
      .where(eq(schema.manifests.projectId, projectId))

    // Filter to only manifests that can fetch PRD data
    const fetchableManifests = manifests.filter(
      (m): m is typeof m & { branchName: string; prdName: string } =>
        m.branchName !== null && m.prdName !== null
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
          manifest.branchName,
          manifest.prdName
        ).pipe(
          Effect.map(data => ({ id: manifest.id, data })),
          Effect.catchAll(() =>
            Effect.succeed({ id: manifest.id, data: { prdJson: null, progress: null } })
          )
        )
      ),
      { concurrency: 5 }
    )

    // Build map
    const prdDataMap: ManifestPrdDataMap = {}
    for (const { id, data } of results) {
      prdDataMap[id] = data
    }

    return prdDataMap
  }).pipe(Effect.withSpan('manifest.getManifestPrdData'))
