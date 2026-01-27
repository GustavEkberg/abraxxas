import { Effect } from 'effect'
import { eq, and } from 'drizzle-orm'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { getProject } from '@/lib/core/project/get-project'
import {
  listManifestBranches,
  fetchPrdFromGitHub,
  type ManifestBranch,
  type ManifestPrdData
} from './fetch-prd-from-github'
import { completeManifestSprite } from './complete-manifest-sprite'

/**
 * Combined manifest data for UI display
 */
export interface ManifestWithData {
  /** Full branch name (e.g., manifest-my-feature) */
  branchName: string
  /** PRD name derived from branch (e.g., my-feature) */
  prdName: string
  /** PRD data fetched from GitHub (tasks, progress) */
  prdData: ManifestPrdData | null
  /** Active sprite for this branch (if any) */
  sprite: schema.Sprite | null
}

/**
 * Fetch all manifest branches from GitHub with their PRD data and sprite status.
 * Verifies user owns the project before returning results.
 */
export const getManifestBranches = (projectId: string) =>
  Effect.gen(function* () {
    // Verify user owns the project (throws UnauthorizedError if not)
    const project = yield* getProject(projectId)
    const db = yield* Db

    // Fetch branches from GitHub
    const branches = yield* listManifestBranches(
      project.repositoryUrl,
      project.encryptedGithubToken
    ).pipe(
      Effect.catchAll(error =>
        // Log error but return empty array so UI still works
        Effect.logWarning('Failed to fetch manifest branches from GitHub', { error }).pipe(
          Effect.as<ManifestBranch[]>([])
        )
      )
    )

    // Fetch all manifest sprites for this project
    const spritesResult = yield* db
      .select()
      .from(schema.sprites)
      .where(and(eq(schema.sprites.projectId, projectId), eq(schema.sprites.type, 'manifest')))

    // Build map of branchName -> sprite for quick lookup
    const spriteByBranch = new Map(spritesResult.map(s => [s.branchName, s]))

    // Fetch PRD data for each branch in parallel
    const results = yield* Effect.all(
      branches.map(branch =>
        fetchPrdFromGitHub(
          project.repositoryUrl,
          project.encryptedGithubToken,
          branch.branchName,
          branch.prdName
        ).pipe(
          Effect.map(
            (prdData): ManifestWithData => ({
              branchName: branch.branchName,
              prdName: branch.prdName,
              prdData,
              sprite: spriteByBranch.get(branch.branchName) ?? null
            })
          ),
          Effect.catchAll(() =>
            Effect.succeed<ManifestWithData>({
              branchName: branch.branchName,
              prdName: branch.prdName,
              prdData: null,
              sprite: spriteByBranch.get(branch.branchName) ?? null
            })
          )
        )
      ),
      { concurrency: 5 }
    )

    // Check for completed manifests with active sprites and auto-destroy them
    const completedWithSprites = results.filter(m => {
      if (!m.sprite || !m.prdData?.prdJson) return false
      const tasks = m.prdData.prdJson.tasks
      return tasks.length > 0 && tasks.every(t => t.passes)
    })

    // Destroy completed sprites in parallel (fire-and-forget, errors logged but not thrown)
    if (completedWithSprites.length > 0) {
      yield* Effect.all(
        completedWithSprites.map(m =>
          completeManifestSprite(m.sprite!).pipe(
            Effect.catchAll(error =>
              Effect.logWarning('Failed to auto-complete manifest sprite', {
                branchName: m.branchName,
                error
              })
            )
          )
        ),
        { concurrency: 5 }
      )

      // Clear sprite references from results since they're now destroyed
      for (const m of completedWithSprites) {
        m.sprite = null
      }
    }

    return results
  }).pipe(Effect.withSpan('Manifest.getManifestBranches'))

/**
 * Get sprites for a project that don't have corresponding branches (orphaned/creator sprites)
 */
export const getOrphanedSprites = (projectId: string, branchNames: string[]) =>
  Effect.gen(function* () {
    const db = yield* Db
    const branchSet = new Set(branchNames)

    const allSprites = yield* db
      .select()
      .from(schema.sprites)
      .where(and(eq(schema.sprites.projectId, projectId), eq(schema.sprites.type, 'manifest')))

    // Return sprites that don't match any known branch
    return allSprites.filter(s => !branchSet.has(s.branchName))
  }).pipe(Effect.withSpan('Manifest.getOrphanedSprites'))
