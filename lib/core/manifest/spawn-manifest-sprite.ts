import { Effect } from 'effect'
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
  /** Webhook secret for HMAC signing */
  webhookSecret: string
  project: Pick<Project, 'id' | 'repositoryUrl' | 'encryptedGithubToken' | 'localSetupScript'>
  /** User ID to fetch opencode auth for model access */
  userId: string
  /** Branch to checkout (optional - will use default branch if not specified) */
  branchName?: string
}

/**
 * Result of spawning a manifest sprite.
 */
export interface SpawnManifestSpriteResult {
  spriteName: string
  spriteUrl: string
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
 * Generate manifest-specific script.
 * Installs send-prd-webhook command and persists webhook env vars.
 * Note: opencode serve is already started by base setup.
 */
function generateManifestExecutionScript(webhookUrl: string, webhookSecret: string): string {
  return `
# ===========================================
# Manifest Execution - Install webhook command
# ===========================================

# Install send-prd-webhook command
cat > /usr/local/bin/send-prd-webhook << 'WEBHOOKEOF'
#!/bin/bash
set -euo pipefail

if [ -z "\${MANIFEST_WEBHOOK_URL:-}" ] || [ -z "\${MANIFEST_WEBHOOK_SECRET:-}" ]; then
    echo "ERROR: MANIFEST_WEBHOOK_URL and MANIFEST_WEBHOOK_SECRET must be set"
    exit 1
fi

BRANCH_NAME=\$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

if [ -z "\$BRANCH_NAME" ] || [ "\$BRANCH_NAME" = "HEAD" ]; then
    echo "ERROR: Could not determine branch name"
    exit 1
fi

echo "Sending webhook for branch: \$BRANCH_NAME"

PAYLOAD=\$(jq -n --arg type "branch_ready" --arg branchName "\$BRANCH_NAME" '{type: \$type, branchName: \$branchName}')
SIGNATURE=\$(echo -n "\$PAYLOAD" | openssl dgst -sha256 -hmac "\$MANIFEST_WEBHOOK_SECRET" | awk '{print \$2}')

RESPONSE=\$(curl -s -w "\\n%{http_code}" -X POST "\$MANIFEST_WEBHOOK_URL" \\
  -H "Content-Type: application/json" \\
  -H "X-Webhook-Signature: sha256=\$SIGNATURE" \\
  -d "\$PAYLOAD")

HTTP_CODE=\$(echo "\$RESPONSE" | tail -n1)
BODY=\$(echo "\$RESPONSE" | sed '\$d')

if [ "\$HTTP_CODE" = "200" ]; then
    echo "Webhook sent successfully!"
    echo "  Type: branch_ready"
    echo "  Branch: \$BRANCH_NAME"
else
    echo "ERROR: Webhook failed with status \$HTTP_CODE"
    echo "Response: \$BODY"
    exit 1
fi
WEBHOOKEOF
chmod +x /usr/local/bin/send-prd-webhook

# Persist webhook env vars for all shells
cat >> /home/sprite/.bashrc << 'BASHRCEOF'
export MANIFEST_WEBHOOK_URL="${webhookUrl}"
export MANIFEST_WEBHOOK_SECRET="${webhookSecret}"
BASHRCEOF

cat >> /etc/profile.d/sprite-env.sh << 'PROFILEEOF'
export MANIFEST_WEBHOOK_URL="${webhookUrl}"
export MANIFEST_WEBHOOK_SECRET="${webhookSecret}"
PROFILEEOF

echo "send-prd-webhook command installed"
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

    const { manifestId, webhookSecret, project, userId } = config

    // Build webhook URL for this manifest
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/manifest/${manifestId}`

    const spriteName = generateManifestSpriteName(project.id)

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

    // Save sprite details to DB immediately so we don't lose them on timeout
    yield* db
      .update(schema.manifests)
      .set({
        status: 'active',
        spriteName,
        spriteUrl
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
      localSetupScript: project.localSetupScript ?? undefined,
      branchName: config.branchName
    })

    const manifestExecution = generateManifestExecutionScript(webhookUrl, webhookSecret)

    const setupScript = `#!/bin/bash
set -euo pipefail

# Redirect all output to /tmp/abraxas.log for log viewing
exec > >(tee /tmp/abraxas.log) 2>&1

echo "=== Manifest Sprite Setup ==="

# Webhook environment variables for /prd-task-hook skill
export MANIFEST_WEBHOOK_URL="${webhookUrl}"
export MANIFEST_WEBHOOK_SECRET="${webhookSecret}"

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
      spriteUrl
    } satisfies SpawnManifestSpriteResult
  }).pipe(Effect.withSpan('Manifest.spawnManifestSprite'))
