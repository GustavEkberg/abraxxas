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

    const { manifestId, project, userId } = config

    const spriteName = generateManifestSpriteName(project.id)
    const spritePassword = generateSpritePassword()

    // Decrypt GitHub token for repo cloning
    const githubToken = yield* decryptToken(project.encryptedGithubToken)

    yield* Effect.annotateCurrentSpan({
      'sprite.name': spriteName,
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

# Create directories upfront
mkdir -p /home/sprite/.local/share/opencode
mkdir -p /home/sprite/.config/opencode/command
mkdir -p /home/sprite/.config/opencode/skill

# Run downloads in parallel: repo clone, opencode install, opencode-setup tarball
echo "Starting parallel downloads..."

git clone "${authRepoUrl}" /home/sprite/repo &
PID_REPO=$!

curl -fsSL https://opencode.ai/install | bash &
PID_OPENCODE=$!

curl -sL ${sprites.opencodeSetupRepoUrl}/archive/refs/heads/main.tar.gz | tar -xzf - -C /tmp &
PID_SETUP=$!

# Wait for all downloads
echo "Waiting for downloads to complete..."
wait $PID_REPO || { echo "Repo clone failed"; exit 1; }
echo "Repo cloned"
wait $PID_OPENCODE || { echo "Opencode install failed"; exit 1; }
echo "Opencode installed"
wait $PID_SETUP || { echo "Setup tarball failed"; exit 1; }
echo "Setup tarball extracted"

# Setup opencode auth
${
  Option.isSome(opencodeAuth)
    ? `
echo "Setting up opencode auth..."
cat > /home/sprite/.local/share/opencode/auth.json << 'AUTHEOF'
${opencodeAuth.value}
AUTHEOF
chmod 600 /home/sprite/.local/share/opencode/auth.json
`
    : 'echo "No opencode auth configured"'
}

# Install commands and skills (fast local copies)
cp /tmp/${opencodeSetupRepoName}-main/command/*.md /home/sprite/.config/opencode/command/
cp -r /tmp/${opencodeSetupRepoName}-main/skill/* /home/sprite/.config/opencode/skill/
cp /tmp/${opencodeSetupRepoName}-main/bin/task-loop.sh /usr/local/bin/task-loop
chmod +x /usr/local/bin/task-loop

# Add opencode to PATH globally
echo 'export PATH="/home/sprite/.opencode/bin:$PATH"' >> /etc/profile.d/opencode.sh
echo 'export HOME=/home/sprite' >> /etc/profile.d/opencode.sh
echo 'export XDG_CONFIG_HOME=/home/sprite/.config' >> /etc/profile.d/opencode.sh
echo 'export XDG_DATA_HOME=/home/sprite/.local/share' >> /etc/profile.d/opencode.sh

# Also add to bashrc for non-login shells
echo 'export PATH="/home/sprite/.opencode/bin:$PATH"' >> /home/sprite/.bashrc
echo 'export HOME=/home/sprite' >> /home/sprite/.bashrc
echo 'export XDG_CONFIG_HOME=/home/sprite/.config' >> /home/sprite/.bashrc
echo 'export XDG_DATA_HOME=/home/sprite/.local/share' >> /home/sprite/.bashrc

# Create opencode config with default model
cat > /home/sprite/repo/opencode.json << 'CONFIGEOF'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-opus-4-5-20251101"
}
CONFIGEOF

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

    // Run setup in background using setsid to fully detach from terminal
    yield* sprites
      .execCommand(spriteName, [
        'bash',
        '-c',
        'setsid /tmp/setup.sh > /tmp/setup-runner.log 2>&1 < /dev/null &'
      ])
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
