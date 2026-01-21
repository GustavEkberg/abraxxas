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

    // Get opencode auth for the setup script
    const opencodeAuth = yield* getOpencodeAuth(userId)

    // Build the setup script that runs in background
    const authRepoUrl = project.repositoryUrl.replace(
      'https://github.com/',
      `https://${githubToken}@github.com/`
    )

    // Extract repo name from URL for tarball folder (e.g. "abraxas-opencode-setup" from URL)
    const opencodeSetupRepoName = sprites.opencodeSetupRepoUrl.split('/').pop() || 'opencode-setup'

    const setupScript = `#!/bin/bash
set -e

echo "=== Manifest Sprite Setup ===" > /tmp/setup.log
exec >> /tmp/setup.log 2>&1

# Clone repository
echo "Cloning repository..."
git clone "${authRepoUrl}" /home/sprite/repo

# Setup opencode auth
${
  Option.isSome(opencodeAuth)
    ? `
echo "Setting up opencode auth..."
mkdir -p /home/sprite/.local/share/opencode
cat > /home/sprite/.local/share/opencode/auth.json << 'AUTHEOF'
${opencodeAuth.value}
AUTHEOF
chmod 600 /home/sprite/.local/share/opencode/auth.json
`
    : 'echo "No opencode auth configured"'
}

# Download and install opencode-setup
echo "Installing opencode-setup..."
curl -sL ${sprites.opencodeSetupRepoUrl}/archive/refs/heads/main.tar.gz | tar -xzf - -C /tmp

# Install commands
mkdir -p /home/sprite/.config/opencode/command
cp /tmp/${opencodeSetupRepoName}-main/command/*.md /home/sprite/.config/opencode/command/

# Install skills
mkdir -p /home/sprite/.config/opencode/skill
cp -r /tmp/${opencodeSetupRepoName}-main/skill/* /home/sprite/.config/opencode/skill/

# Install task-loop
cp /tmp/${opencodeSetupRepoName}-main/bin/task-loop.sh /usr/local/bin/task-loop
chmod +x /usr/local/bin/task-loop

# Install opencode
echo "Installing opencode..."
[ -x "/home/sprite/.opencode/bin/opencode" ] || curl -fsSL https://opencode.ai/install | bash

# Start opencode serve
echo "Starting opencode serve..."
cd /home/sprite/repo
HOME=/home/sprite XDG_CONFIG_HOME=/home/sprite/.config XDG_DATA_HOME=/home/sprite/.local/share OPENCODE_SERVER_PASSWORD="${spritePassword}" nohup /home/sprite/.opencode/bin/opencode serve --hostname 0.0.0.0 --port 8080 > /tmp/opencode.log 2>&1 &

echo "=== Setup Complete ==="
`

    // Write and execute setup script in background
    yield* sprites
      .execCommand(spriteName, ['bash', '-c', 'cat > /tmp/setup.sh && chmod +x /tmp/setup.sh'], {
        stdin: setupScript
      })
      .pipe(
        Effect.mapError(
          error =>
            new SpriteExecutionError({
              message: `Failed to write setup script: ${error.message}`,
              spriteName,
              cause: error
            })
        )
      )

    // Run setup in background (fire and forget)
    yield* sprites
      .execCommand(spriteName, ['bash', '-c', 'nohup /tmp/setup.sh > /tmp/setup-runner.log 2>&1 &'])
      .pipe(
        Effect.mapError(
          error =>
            new SpriteExecutionError({
              message: `Failed to start setup script: ${error.message}`,
              spriteName,
              cause: error
            })
        )
      )

    yield* Effect.log(`Setup script started in background for ${spriteName}`)

    return {
      spriteName,
      spriteUrl,
      spritePassword
    } satisfies SpawnManifestSpriteResult
  }).pipe(Effect.withSpan('Manifest.spawnManifestSprite'))
