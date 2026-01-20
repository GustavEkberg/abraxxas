import { Effect, Option } from 'effect'
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { Sprites } from '@/lib/services/sprites/live-layer'
import { Db } from '@/lib/services/db/live-layer'
import { SpriteExecutionError } from '@/lib/services/sprites/errors'
import { getOpencodeAuth } from '@/lib/core/opencode-auth/get-opencode-auth'
import { decryptToken } from '@/lib/core/crypto/encrypt'
import type { Project } from '@/lib/services/db/schema'
import * as schema from '@/lib/services/db/schema'

/**
 * Configuration for spawning a manifest sprite.
 */
export interface SpawnManifestSpriteConfig {
  /** Manifest ID for logging/tracing */
  manifestId: string
  project: Pick<Project, 'id' | 'repositoryUrl' | 'encryptedGithubToken'>
  prdName: string
  /** User ID to fetch opencode auth for model access */
  userId: string
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
    const db = yield* Db

    const { manifestId, project, prdName, userId } = config

    const spriteName = generateManifestSpriteName(project.id)
    const spritePassword = generateSpritePassword()

    // Decrypt GitHub token for repo cloning
    const githubToken = yield* decryptToken(project.encryptedGithubToken)

    yield* Effect.annotateCurrentSpan({
      'sprite.name': spriteName,
      'sprite.prdName': prdName,
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

    // Save sprite details to DB immediately so we don't lose them on timeout
    yield* db
      .update(schema.manifests)
      .set({
        status: 'active',
        spriteName,
        spriteUrl,
        spritePassword
      })
      .where(eq(schema.manifests.id, manifestId))

    yield* Effect.log(`Saved sprite details to manifest ${manifestId}`)

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

    // Install opencode if not present (installs to ~/.opencode/bin)
    yield* cleanupOnError(
      sprites
        .execCommand(spriteName, [
          'bash',
          '-c',
          '[ -x "$HOME/.opencode/bin/opencode" ] || curl -fsSL https://opencode.ai/install | bash'
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

    yield* Effect.log('opencode installed')

    // Start opencode serve in background (for browser access via sprite URL)
    // Bind to 0.0.0.0 for external access, set password for security
    yield* cleanupOnError(
      sprites
        .execCommand(spriteName, [
          'bash',
          '-c',
          `cd /home/sprite/repo && OPENCODE_SERVER_PASSWORD="${spritePassword}" nohup "$HOME/.opencode/bin/opencode" serve --hostname 0.0.0.0 --port 80 > /tmp/opencode.log 2>&1 &`
        ])
        .pipe(
          Effect.mapError(
            error =>
              new SpriteExecutionError({
                message: `Failed to start opencode serve: ${error.message}`,
                spriteName,
                cause: error
              })
          )
        )
    )

    yield* Effect.log('opencode serve started')
    yield* Effect.log(`Manifest sprite setup complete: ${spriteName}`)

    return {
      spriteName,
      spriteUrl,
      spritePassword
    } satisfies SpawnManifestSpriteResult
  }).pipe(Effect.withSpan('Manifest.spawnManifestSprite'))
