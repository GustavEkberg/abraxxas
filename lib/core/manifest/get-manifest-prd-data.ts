import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { Db } from '@/lib/services/db/live-layer'
import { Sprites } from '@/lib/services/sprites/live-layer'
import * as schema from '@/lib/services/db/schema'
import { fetchPrdFromGitHub, type ManifestPrdData } from './fetch-prd-from-github'
import { getManifestBranchName } from './branch-name'

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

    // Get all manifests with prdName (include status and spriteName for completion detection)
    const manifests = yield* db
      .select({
        id: schema.manifests.id,
        prdName: schema.manifests.prdName,
        status: schema.manifests.status,
        spriteName: schema.manifests.spriteName
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
          getManifestBranchName(manifest.prdName),
          manifest.prdName
        ).pipe(
          Effect.map(data => ({
            id: manifest.id,
            status: manifest.status,
            spriteName: manifest.spriteName,
            data
          })),
          Effect.catchAll(() =>
            Effect.succeed({
              id: manifest.id,
              status: manifest.status,
              spriteName: manifest.spriteName,
              data: { prdJson: null, progress: null }
            })
          )
        )
      ),
      { concurrency: 5 }
    )

    // Build map and detect completion
    const prdDataMap: ManifestPrdDataMap = {}
    const completedManifests: Array<{ id: string; spriteName: string | null }> = []

    for (const { id, status, spriteName, data } of results) {
      prdDataMap[id] = data

      // Check for completion: running + all tasks pass
      if (status === 'running' && data.prdJson) {
        const allTasksPass = data.prdJson.tasks.every(t => t.passes)
        if (allTasksPass) {
          completedManifests.push({ id, spriteName })
        }
      }
    }

    // Update completed manifests and destroy their sprites
    if (completedManifests.length > 0) {
      const sprites = yield* Sprites

      yield* Effect.forEach(
        completedManifests,
        ({ id, spriteName }) =>
          Effect.gen(function* () {
            // Update manifest status
            yield* db
              .update(schema.manifests)
              .set({
                status: 'completed',
                updatedAt: new Date(),
                completedAt: new Date(),
                spriteName: null,
                spriteUrl: null
              })
              .where(eq(schema.manifests.id, id))

            // Destroy sprite if it exists
            if (spriteName) {
              yield* sprites.destroySprite(spriteName).pipe(
                Effect.tapError(error =>
                  Effect.logWarning('Failed to destroy sprite on completion', {
                    spriteName,
                    manifestId: id,
                    error
                  })
                ),
                Effect.catchAll(() => Effect.void)
              )
              yield* Effect.logInfo('Sprite destroyed on manifest completion', {
                spriteName,
                manifestId: id
              })
            }
          }),
        { concurrency: 'unbounded' }
      )
      yield* Effect.logInfo('Manifests completed via PRD check', {
        manifestIds: completedManifests.map(m => m.id)
      })
    }

    return prdDataMap
  }).pipe(Effect.withSpan('manifest.getManifestPrdData'))
