import { Data, Effect, Schema } from 'effect'
import { decryptToken } from '@/lib/core/crypto/encrypt'

/**
 * PRD Task - represents a single task in the PRD
 * @example
 * {
 *   id: "setup-1",
 *   category: "setup",
 *   description: "Install SDK and configure environment",
 *   steps: ["SDK installed", "env configured"],
 *   passes: false
 * }
 */
export interface PrdTask {
  readonly id: string
  readonly passes: boolean
  readonly category?: string
  readonly description?: string
  readonly title?: string
  readonly steps?: readonly string[]
}

/**
 * PRD JSON structure - the format used in .opencode/state/{prdName}/prd.json
 * @example
 * {
 *   prdName: "my-feature",
 *   tasks: [{ id: "task-1", passes: false, ... }],
 *   context: { patterns: [...], keyFiles: [...], nonGoals: [...] }
 * }
 */
export interface PrdJson {
  readonly prdName: string
  readonly tasks: readonly PrdTask[]
  readonly context?: unknown
}

// Schema for runtime validation
const PrdTaskSchema = Schema.Struct({
  id: Schema.String,
  passes: Schema.Boolean,
  category: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  steps: Schema.optional(Schema.Array(Schema.String))
})

const PrdJsonSchema = Schema.Struct({
  prdName: Schema.String,
  tasks: Schema.Array(PrdTaskSchema),
  context: Schema.optional(Schema.Unknown)
})

export class GitHubFetchError extends Data.TaggedError('GitHubFetchError')<{
  message: string
  statusCode?: number
}> {}

/**
 * Parse owner/repo from repository URL
 * Handles: https://github.com/owner/repo or https://github.com/owner/repo.git
 */
const parseRepoFromUrl = (
  repositoryUrl: string
): Effect.Effect<{ owner: string; repo: string }, GitHubFetchError> =>
  Effect.gen(function* () {
    const match = repositoryUrl.match(/github\.com\/([^/]+)\/([^/.]+)/)
    if (!match) {
      return yield* Effect.fail(
        new GitHubFetchError({ message: `Invalid GitHub URL: ${repositoryUrl}` })
      )
    }
    return { owner: match[1], repo: match[2] }
  })

/**
 * Fetch raw file content from GitHub
 */
const fetchGitHubFile = (
  owner: string,
  repo: string,
  branch: string,
  path: string,
  token: string
): Effect.Effect<string | null, GitHubFetchError> =>
  Effect.gen(function* () {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.raw+json',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        }),
      catch: error =>
        new GitHubFetchError({ message: `Failed to fetch from GitHub: ${String(error)}` })
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      return yield* Effect.fail(
        new GitHubFetchError({
          message: `GitHub API error: ${response.status} ${response.statusText}`,
          statusCode: response.status
        })
      )
    }

    return yield* Effect.tryPromise({
      try: () => response.text(),
      catch: error => new GitHubFetchError({ message: `Failed to read response: ${String(error)}` })
    })
  })

export interface ManifestPrdData {
  prdJson: PrdJson | null
  progress: string | null
}

/**
 * Fetch PRD data from GitHub for a manifest
 *
 * @param repositoryUrl - GitHub repository URL (e.g., https://github.com/owner/repo)
 * @param encryptedGithubToken - Encrypted GitHub PAT from project
 * @param branchName - Branch to fetch from
 * @param prdName - PRD name (kebab-case, determines path in .opencode/state/{prdName}/)
 */
export const fetchPrdFromGitHub = (
  repositoryUrl: string,
  encryptedGithubToken: string,
  branchName: string,
  prdName: string
): Effect.Effect<ManifestPrdData, GitHubFetchError> =>
  Effect.gen(function* () {
    const { owner, repo } = yield* parseRepoFromUrl(repositoryUrl)

    const token = yield* decryptToken(encryptedGithubToken).pipe(
      Effect.mapError(
        e => new GitHubFetchError({ message: `Failed to decrypt GitHub token: ${e.message}` })
      )
    )

    const basePath = `.opencode/state/${prdName}`

    // Fetch both files in parallel
    const [prdJsonRaw, progress] = yield* Effect.all(
      [
        fetchGitHubFile(owner, repo, branchName, `${basePath}/prd.json`, token),
        fetchGitHubFile(owner, repo, branchName, `${basePath}/progress.txt`, token)
      ],
      { concurrency: 2 }
    )

    // Parse prd.json if present
    let prdJson: PrdJson | null = null
    if (prdJsonRaw) {
      const parseResult = yield* Effect.try({
        try: (): unknown => JSON.parse(prdJsonRaw),
        catch: () => new GitHubFetchError({ message: 'Failed to parse prd.json' })
      })

      const decoded = Schema.decodeUnknownEither(PrdJsonSchema)(parseResult)
      if (decoded._tag === 'Right') {
        prdJson = decoded.right
      }
      // If decode fails, leave as null (malformed prd.json)
    }

    return { prdJson, progress }
  }).pipe(Effect.withSpan('manifest.fetchPrdFromGitHub'))
