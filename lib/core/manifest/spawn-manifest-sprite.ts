import { Effect, Config, Option } from 'effect'
import { createHmac, randomBytes } from 'crypto'
import { Sprites } from '@/lib/services/sprites/live-layer'
import { SpriteExecutionError } from '@/lib/services/sprites/errors'
import { getOpencodeAuth } from '@/lib/core/opencode-auth/get-opencode-auth'
import { decryptToken } from '@/lib/core/crypto/encrypt'
import type { Project } from '@/lib/services/db/schema'

/**
 * Configuration for spawning a manifest sprite.
 */
export interface SpawnManifestSpriteConfig {
  /** Manifest ID for webhook URL construction */
  manifestId: string
  project: Pick<Project, 'id' | 'repositoryUrl' | 'encryptedGithubToken'>
  prdName: string
  /** User ID to fetch opencode auth for model access */
  userId: string
  /** Pre-generated webhook secret (must be saved to DB before calling this) */
  webhookSecret: string
}

/**
 * Result of spawning a manifest sprite.
 */
export interface SpawnManifestSpriteResult {
  spriteName: string
  spriteUrl: string
  spritePassword: string
}

/**
 * Generate a unique sprite name for a manifest.
 * Format: manifest-{projectId-short}-{timestamp}
 */
export function generateManifestSpriteName(projectId: string): string {
  const timestamp = Date.now()
  const shortProjectId = projectId.replace(/-/g, '').slice(0, 8)
  return `manifest-${shortProjectId}-${timestamp}`
}

/**
 * Generate a random 32-character alphanumeric password.
 */
export function generateSpritePassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = randomBytes(32)
  return Array.from(bytes)
    .map(b => chars[b % chars.length])
    .join('')
}

/**
 * Spawn a sprite for manifest execution (long-running opencode session).
 *
 * Creates a new sprite with public URL, clones the repo,
 * sets up opencode auth and abraxas-opencode-setup files,
 * then sends a 'started' webhook.
 */
export const spawnManifestSprite = (config: SpawnManifestSpriteConfig) =>
  Effect.gen(function* () {
    const sprites = yield* Sprites
    const webhookBaseUrl = yield* Config.string('WEBHOOK_BASE_URL')

    const { manifestId, project, prdName, userId, webhookSecret } = config

    const spriteName = generateManifestSpriteName(project.id)
    const spritePassword = generateSpritePassword()

    // Decrypt GitHub token for repo cloning
    const githubToken = yield* decryptToken(project.encryptedGithubToken)

    // Normalize webhook base URL and construct manifest webhook URL
    const baseUrl = webhookBaseUrl.replace(/\/$/, '')
    const webhookUrl = `${baseUrl}/api/webhooks/manifest/${manifestId}`

    yield* Effect.annotateCurrentSpan({
      'sprite.name': spriteName,
      'sprite.prdName': prdName,
      'sprite.webhookUrl': webhookUrl,
      'project.id': project.id,
      'manifest.id': manifestId
    })

    yield* Effect.log(`Creating manifest sprite: ${spriteName}`)

    // Create the sprite with public auth
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

    yield* Effect.log(`Sprite created: ${spriteUrl}`)

    // Helper to clean up sprite on failure
    const cleanupOnError = <E, A>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.catchAll(error => {
          return sprites.destroySprite(spriteName).pipe(
            Effect.catchAll(() => Effect.void),
            Effect.flatMap(() => Effect.fail(error))
          )
        })
      )

    // Clone repository
    yield* Effect.log('Cloning repository...')
    const authRepoUrl = project.repositoryUrl.replace(
      'https://github.com/',
      `https://${githubToken}@github.com/`
    )

    yield* cleanupOnError(
      sprites
        .execCommand(spriteName, ['bash', '-c', `git clone "${authRepoUrl}" /home/sprite/repo`])
        .pipe(
          Effect.mapError(
            error =>
              new SpriteExecutionError({
                message: `Failed to clone repository: ${error.message}`,
                spriteName,
                cause: error
              })
          )
        )
    )

    yield* Effect.log('Repository cloned')

    // Upload opencode auth.json if user has one configured
    const opencodeAuth = yield* getOpencodeAuth(userId)
    if (Option.isSome(opencodeAuth)) {
      yield* Effect.log('Uploading opencode auth.json...')

      yield* cleanupOnError(
        sprites
          .execCommand(spriteName, [
            'bash',
            '-c',
            'mkdir -p "$HOME/.local/share/opencode" /root/.local/share/opencode 2>/dev/null || true'
          ])
          .pipe(
            Effect.mapError(
              error =>
                new SpriteExecutionError({
                  message: `Failed to create opencode directory: ${error.message}`,
                  spriteName,
                  cause: error
                })
            )
          )
      )

      yield* cleanupOnError(
        sprites
          .execCommand(
            spriteName,
            [
              'bash',
              '-c',
              'cat > "$HOME/.local/share/opencode/auth.json" && chmod 600 "$HOME/.local/share/opencode/auth.json" && cp "$HOME/.local/share/opencode/auth.json" /root/.local/share/opencode/auth.json 2>/dev/null && chmod 600 /root/.local/share/opencode/auth.json 2>/dev/null || true'
            ],
            { stdin: opencodeAuth.value }
          )
          .pipe(
            Effect.mapError(
              error =>
                new SpriteExecutionError({
                  message: `Failed to write opencode auth.json: ${error.message}`,
                  spriteName,
                  cause: error
                })
            )
          )
      )

      yield* Effect.log('Uploaded opencode auth.json')
    } else {
      yield* Effect.log('No opencode auth configured, skipping')
    }

    // Download and install abraxas-opencode-setup
    yield* Effect.log('Installing abraxas-opencode-setup...')

    // Download the setup repo tarball
    yield* cleanupOnError(
      sprites
        .execCommand(spriteName, [
          'bash',
          '-c',
          'curl -sL https://github.com/anomalyco/abraxas-opencode-setup/archive/refs/heads/main.tar.gz | tar -xzf - -C /tmp'
        ])
        .pipe(
          Effect.mapError(
            error =>
              new SpriteExecutionError({
                message: `Failed to download abraxas-opencode-setup: ${error.message}`,
                spriteName,
                cause: error
              })
          )
        )
    )

    yield* Effect.log('Downloaded abraxas-opencode-setup')

    // Copy command/*.md to ~/.config/opencode/command/
    yield* cleanupOnError(
      sprites
        .execCommand(spriteName, [
          'bash',
          '-c',
          'mkdir -p "$HOME/.config/opencode/command" && cp /tmp/abraxas-opencode-setup-main/command/*.md "$HOME/.config/opencode/command/"'
        ])
        .pipe(
          Effect.mapError(
            error =>
              new SpriteExecutionError({
                message: `Failed to install commands: ${error.message}`,
                spriteName,
                cause: error
              })
          )
        )
    )

    yield* Effect.log('Installed commands')

    // Copy skill/*/ to ~/.config/opencode/skill/
    yield* cleanupOnError(
      sprites
        .execCommand(spriteName, [
          'bash',
          '-c',
          'mkdir -p "$HOME/.config/opencode/skill" && cp -r /tmp/abraxas-opencode-setup-main/skill/* "$HOME/.config/opencode/skill/"'
        ])
        .pipe(
          Effect.mapError(
            error =>
              new SpriteExecutionError({
                message: `Failed to install skills: ${error.message}`,
                spriteName,
                cause: error
              })
          )
        )
    )

    yield* Effect.log('Installed skills')

    // Copy bin/task-loop.sh to /usr/local/bin/task-loop with chmod +x
    yield* cleanupOnError(
      sprites
        .execCommand(spriteName, [
          'bash',
          '-c',
          'cp /tmp/abraxas-opencode-setup-main/bin/task-loop.sh /usr/local/bin/task-loop && chmod +x /usr/local/bin/task-loop'
        ])
        .pipe(
          Effect.mapError(
            error =>
              new SpriteExecutionError({
                message: `Failed to install task-loop: ${error.message}`,
                spriteName,
                cause: error
              })
          )
        )
    )

    yield* Effect.log('Installed task-loop')

    // Install opencode if not present
    yield* cleanupOnError(
      sprites
        .execCommand(spriteName, [
          'bash',
          '-c',
          'command -v opencode &> /dev/null || curl -fsSL https://opencode.ai/install | bash'
        ])
        .pipe(
          Effect.mapError(
            error =>
              new SpriteExecutionError({
                message: `Failed to install opencode: ${error.message}`,
                spriteName,
                cause: error
              })
          )
        )
    )

    yield* Effect.log('opencode ready')

    // Send 'started' webhook to notify setup is complete
    yield* Effect.log('Sending started webhook...')

    const payload = JSON.stringify({ type: 'started', manifestId })
    const signature = `sha256=${createHmac('sha256', webhookSecret).update(payload).digest('hex')}`

    yield* Effect.tryPromise({
      try: async () => {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature
          },
          body: payload
        })
        if (!response.ok) {
          const text = await response.text()
          throw new Error(`Webhook failed: ${response.status} ${text}`)
        }
      },
      catch: error =>
        new SpriteExecutionError({
          message: `Failed to send started webhook: ${error instanceof Error ? error.message : String(error)}`,
          spriteName,
          cause: error
        })
    })

    yield* Effect.log('Started webhook sent')
    yield* Effect.log(`Manifest sprite setup complete: ${spriteName}`)

    return {
      spriteName,
      spriteUrl,
      spritePassword
    } satisfies SpawnManifestSpriteResult
  }).pipe(Effect.withSpan('Manifest.spawnManifestSprite'))
