import { Effect } from 'effect'
import { Sprites } from '@/lib/services/sprites/live-layer'
import { generateInvocationScript, generateWebhookSecret } from './callback-script'
import { SpriteExecutionError } from '@/lib/services/sprites/errors'
import { ValidationError } from '@/lib/core/errors'
import { getOpencodeAuth } from '@/lib/core/opencode-auth/get-opencode-auth'
import type { Task, Project } from '@/lib/services/db/schema'

/**
 * Configuration for spawning a sprite for a task.
 */
export interface SpawnSpriteConfig {
  task: Pick<Task, 'id' | 'title' | 'description' | 'branchName' | 'model'>
  project: Pick<Project, 'id' | 'name' | 'repositoryUrl' | 'encryptedGithubToken'>
  prompt: string
  decryptedGithubToken: string
  /** User ID to fetch opencode auth for model access */
  userId: string
  /** Opencode model string (provider/model format) */
  opencodeModel: string
}

/**
 * Result of spawning a sprite.
 * Note: Auth is handled via Sprites network policy (DNS whitelist), not password.
 */
export interface SpawnSpriteResult {
  spriteName: string
  spriteUrl: string
  webhookSecret: string
  branchName: string
}

/**
 * Generate a unique sprite name for a task.
 */
export function generateSpriteName(taskId: string): string {
  const timestamp = Date.now()
  // Sprite names must be alphanumeric with dashes, max 63 chars
  const shortTaskId = taskId.replace(/-/g, '').slice(0, 12)
  return `abraxas-${shortTaskId}-${timestamp}`
}

/**
 * Generate branch name for a task.
 */
export function generateBranchName(taskId: string, taskTitle: string): string {
  const slugifiedTitle = taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)

  const shortTaskId = taskId.replace(/-/g, '').slice(0, 8)
  return `abraxas/${shortTaskId}-${slugifiedTitle}`
}

/**
 * Spawn a sprite for task execution.
 *
 * Creates a new sprite, restores from checkpoint, and executes the task.
 * Returns immediately after starting execution - webhook handles completion.
 */
export const spawnSpriteForTask = (config: SpawnSpriteConfig) =>
  Effect.gen(function* () {
    const sprites = yield* Sprites

    const { task, project, prompt, decryptedGithubToken, userId, opencodeModel } = config

    // Validate project has repository URL
    if (!project.repositoryUrl) {
      return yield* Effect.fail(
        new ValidationError({
          message: 'Project does not have a repository URL configured',
          field: 'repositoryUrl'
        })
      )
    }

    const spriteName = generateSpriteName(task.id)
    const webhookSecret = generateWebhookSecret()
    // Reuse existing branch if task already has one, otherwise generate new
    const branchName = task.branchName || generateBranchName(task.id, task.title)
    // Use VERCEL_BRANCH_URL if available, fallback to localhost (webhooks won't work locally)
    const baseUrl = (sprites.webhookBaseUrl ?? 'http://localhost:3000').replace(/\/$/, '')
    const webhookUrl = `${baseUrl}/api/webhooks/sprite/${task.id}`

    yield* Effect.annotateCurrentSpan({
      'sprite.name': spriteName,
      'sprite.branchName': branchName,
      'sprite.webhookUrl': webhookUrl,
      'task.id': task.id,
      'project.id': project.id
    })

    yield* Effect.log(`Creating sprite: ${spriteName}`)
    yield* Effect.log(`Using branch: ${branchName}${task.branchName ? ' (existing)' : ' (new)'}`)

    // Create the sprite with public auth (to allow remote access)
    const sprite = yield* sprites.createSprite(spriteName, 'public').pipe(
      Effect.mapError(
        error =>
          new SpriteExecutionError({
            message: `Failed to create sprite: ${error.message}`,
            spriteName,
            cause: error
          })
      )
    )

    const spriteUrl = sprite.url

    // Get opencode auth for the setup script to embed
    const opencodeAuth = yield* getOpencodeAuth(userId)

    // Set network policy to whitelist only the configured domain (for iframe security)
    if (sprites.whitelistDomain) {
      yield* sprites
        .setNetworkPolicy(spriteName, [
          { domain: `*.${sprites.whitelistDomain}`, action: 'allow' },
          { domain: sprites.whitelistDomain, action: 'allow' },
          { domain: '*', action: 'deny' }
        ])
        .pipe(
          Effect.mapError(
            error =>
              new SpriteExecutionError({
                message: `Failed to set network policy: ${error.message}`,
                spriteName,
                cause: error
              })
          )
        )
      yield* Effect.log(`Network policy set for ${spriteName}: allow ${sprites.whitelistDomain}`)
    }

    // Generate the execution script with base setup + invocation execution
    const script = generateInvocationScript({
      sessionId: task.id,
      taskId: task.id,
      webhookUrl,
      webhookSecret,
      prompt,
      model: opencodeModel,
      branchName,
      baseSetup: {
        githubToken: decryptedGithubToken,
        repoUrl: project.repositoryUrl,
        opencodeAuth,
        opencodeSetupRepoUrl: sprites.opencodeSetupRepoUrl,
        branchName
      }
    })

    yield* Effect.log('Created sprite, writing script')

    // Write script to sprite
    yield* sprites
      .execCommand(
        spriteName,
        ['bash', '-c', 'cat > /tmp/abraxas-run.sh && chmod +x /tmp/abraxas-run.sh'],
        {
          stdin: script
        }
      )
      .pipe(
        Effect.mapError(
          error =>
            new SpriteExecutionError({
              message: `Failed to write script: ${error.message}`,
              spriteName,
              cause: error
            })
        ),
        Effect.catchAll(error => {
          // If setup fails, destroy the sprite
          return sprites.destroySprite(spriteName).pipe(
            Effect.catchAll(() => Effect.void),
            Effect.flatMap(() => Effect.fail(error))
          )
        })
      )

    // Execute script via WebSocket TTY mode (survives disconnect - max_run_after_disconnect=0)
    yield* sprites
      .execDetached(spriteName, '/tmp/abraxas-run.sh', [], { startTimeout: 10000 })
      .pipe(
        Effect.mapError(
          error =>
            new SpriteExecutionError({
              message: `Failed to start execution: ${error.message}`,
              spriteName,
              cause: error
            })
        ),
        Effect.catchAll(error => {
          return sprites.destroySprite(spriteName).pipe(
            Effect.catchAll(() => Effect.void),
            Effect.flatMap(() => Effect.fail(error))
          )
        })
      )

    yield* Effect.log(`Execution started for ${spriteName}`)

    return {
      spriteName,
      spriteUrl,
      webhookSecret,
      branchName
    } satisfies SpawnSpriteResult
  }).pipe(Effect.withSpan('Sprites.spawnSpriteForTask'))
