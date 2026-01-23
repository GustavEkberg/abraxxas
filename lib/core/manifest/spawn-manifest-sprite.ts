import { Effect } from 'effect'
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { Sprites } from '@/lib/services/sprites/live-layer'
import { Db } from '@/lib/services/db/live-layer'
import { SpriteExecutionError } from '@/lib/services/sprites/errors'
import { getOpencodeAuth } from '@/lib/core/opencode-auth/get-opencode-auth'
import { decryptToken } from '@/lib/core/crypto/encrypt'
import { generateBaseSetupScript } from '@/lib/core/sprites/base-setup-script'
import type { Project } from '@/lib/services/db/schema'
import * as schema from '@/lib/services/db/schema'

/**
 * Configuration for spawning a manifest sprite.
 */
export interface SpawnManifestSpriteConfig {
  /** Manifest ID for logging/tracing */
  manifestId: string
  project: Pick<Project, 'id' | 'repositoryUrl' | 'encryptedGithubToken' | 'localSetupScript'>
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
 * Generate manifest-specific script (opencode serve startup).
 * Appended after base setup.
 */
function generateManifestExecutionScript(spritePassword: string): string {
  return `
# ===========================================
# Manifest Execution - Start opencode serve
# ===========================================

# Start opencode serve (must succeed)
echo "Starting opencode serve..."
cd /home/sprite/repo

# Verify opencode binary exists
if [ ! -f /home/sprite/.opencode/bin/opencode ]; then
    echo "ERROR: opencode binary not found at /home/sprite/.opencode/bin/opencode"
    ls -la /home/sprite/.opencode/bin/ 2>/dev/null || true
    exit 1
fi

echo "opencode binary found, starting serve..."
HOME=/home/sprite XDG_CONFIG_HOME=/home/sprite/.config XDG_DATA_HOME=/home/sprite/.local/share OPENCODE_SERVER_PASSWORD="${spritePassword}" nohup /home/sprite/.opencode/bin/opencode serve --hostname 0.0.0.0 --port 8080 > /tmp/opencode.log 2>&1 &
SERVE_PID=$!
sleep 2

# Verify it started (use || true to prevent set -e from triggering on dead process)
if kill -0 $SERVE_PID 2>/dev/null; then
    echo "opencode serve started successfully (PID: $SERVE_PID)"
else
    echo "ERROR: opencode serve failed to start"
    cat /tmp/opencode.log 2>/dev/null || true
    exit 1
fi

echo "=== Manifest Setup Complete ==="
`
}

/**
 * Spawn a sprite for manifest execution (long-running opencode session).
 *
 * Creates a new sprite with public URL, clones the repo,
 * sets up opencode auth and abraxas-opencode-setup files,
 * then starts opencode serve.
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

    // Generate base setup + manifest execution script
    const baseSetup = generateBaseSetupScript({
      githubToken,
      repoUrl: project.repositoryUrl,
      opencodeAuth,
      opencodeSetupRepoUrl: sprites.opencodeSetupRepoUrl,
      localSetupScript: project.localSetupScript ?? undefined
    })

    const manifestExecution = generateManifestExecutionScript(spritePassword)

    const setupScript = `#!/bin/bash
set -euo pipefail

# Redirect all output to /tmp/abraxas.log for log viewing
exec > >(tee /tmp/abraxas.log) 2>&1

echo "=== Manifest Sprite Setup ==="

# Keep sprite alive during setup
nohup ping google.com -c 60 > /dev/null 2>&1 &

${baseSetup}

${manifestExecution}
`

    // Write setup script to sprite (quick HTTP operation)
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

    // Run setup script via WebSocket TTY mode (survives disconnect - max_run_after_disconnect=0)
    yield* sprites.execDetached(spriteName, '/tmp/setup.sh', [], { startTimeout: 10000 }).pipe(
      Effect.mapError(
        error =>
          new SpriteExecutionError({
            message: `Failed to start setup script: ${error.message}`,
            spriteName,
            cause: error
          })
      )
    )

    yield* Effect.log(`Setup script started via WebSocket TTY for ${spriteName}`)

    return {
      spriteName,
      spriteUrl,
      spritePassword
    } satisfies SpawnManifestSpriteResult
  }).pipe(Effect.withSpan('Manifest.spawnManifestSprite'))
