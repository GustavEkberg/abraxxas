import { Effect } from 'effect'
import { Sprites } from '@/lib/services/sprites/live-layer'
import { Db } from '@/lib/services/db/live-layer'
import { SpriteExecutionError } from '@/lib/services/sprites/errors'
import { getOpencodeAuth } from '@/lib/core/opencode-auth/get-opencode-auth'
import { decryptToken } from '@/lib/core/crypto/encrypt'
import { generateBaseSetupScript } from '@/lib/core/sprites/base-setup-script'
import { generateWebhookSecret } from '@/lib/core/sprites/callback-script'
import type { Project } from '@/lib/services/db/schema'
import * as schema from '@/lib/services/db/schema'

/**
 * Configuration for spawning a manifest sprite.
 */
export interface SpawnManifestSpriteConfig {
  project: Pick<Project, 'id' | 'repositoryUrl' | 'encryptedGithubToken' | 'localSetupScript'>
  /** User ID to fetch opencode auth for model access */
  userId: string
  /** Branch name to checkout (e.g., manifest-my-feature) */
  branchName: string
  /** PRD name derived from branch (e.g., my-feature) */
  prdName: string
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
 * If prdName provided and prd.json exists, runs task-loop at end of setup.
 * Note: opencode serve is already started by base setup.
 */
function generateManifestExecutionScript(config: {
  webhookUrl: string
  webhookSecret: string
  prdName?: string
  hasLocalSetup: boolean
}): string {
  const { webhookUrl, webhookSecret, prdName, hasLocalSetup } = config

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

${
  prdName
    ? `
# ===========================================
# Auto-start task-loop (prdName: ${prdName})
# ===========================================

# Check if prd.json exists for this PRD
PRD_FILE="/home/sprite/repo/.opencode/state/${prdName}/prd.json"
echo "Checking for PRD file: $PRD_FILE"
if [ -f "$PRD_FILE" ]; then
    echo "Found $PRD_FILE - starting task-loop..."
    
    # Wait for Docker to be installed and start it
    DOCKERD_PID=""
    DOCKER_READY=false
    
    if sudo docker info > /dev/null 2>&1; then
      echo "Docker already running"
      DOCKER_READY=true
    else
      echo "Waiting for Docker installation..."
      for i in {1..60}; do
        if command -v dockerd &> /dev/null; then
          echo "Docker installed after \${i}s"
          break
        fi
        sleep 1
      done
    
      if command -v dockerd &> /dev/null; then
        echo "Starting Docker daemon..."
        sudo dockerd > /dev/null 2>&1 &
        DOCKERD_PID=$!
    
        echo "Waiting for Docker to be ready..."
        for i in {1..30}; do
          if sudo docker info > /dev/null 2>&1; then
            echo "Docker is ready"
            DOCKER_READY=true
            break
          fi
          sleep 1
        done
      else
        echo "Docker not installed, skipping"
      fi
    fi
    
    ${
      hasLocalSetup
        ? `
    # Start docker compose services (local setup enabled)
    if [ "$DOCKER_READY" = true ]; then
      cd /home/sprite/repo
      if [ -f "docker-compose.yml" ] || [ -f "docker-compose.yaml" ]; then
        RUNNING_CONTAINERS=$(sudo docker compose ps -q 2>/dev/null | wc -l)
        if [ "$RUNNING_CONTAINERS" -gt 0 ]; then
          echo "Docker compose services already running"
        else
          echo "Starting docker compose services..."
          sudo docker compose up -d
          sleep 5
        fi
      fi
    fi
    `
        : '# No local setup - skipping docker compose'
    }
    
    # Keep sprite alive with periodic network activity
    (
      while true; do
        curl -s https://example.com > /dev/null 2>&1 || true
        sleep 30
      done
    ) &
    KEEPALIVE_PID=$!
    
    # Cleanup function
    cleanup() {
      kill $KEEPALIVE_PID 2>/dev/null || true
      if [ -n "\${DOCKERD_PID:-}" ]; then
        cd /home/sprite/repo
        if [ -f "docker-compose.yml" ] || [ -f "docker-compose.yaml" ]; then
          sudo docker compose down > /dev/null 2>&1 || true
        fi
        sudo kill $DOCKERD_PID 2>/dev/null || true
      fi
    }
    trap cleanup EXIT
    
    # Function to send error webhook
    send_error() {
        local error_msg="$1"
        local payload
        payload=$(jq -n --arg type "error" --arg error "$error_msg" '{type: $type, error: $error}')
        local signature
        signature="sha256=$(echo -n "$payload" | openssl dgst -sha256 -hmac "${webhookSecret}" | awk '{print $2}')"
        curl -s -X POST "${webhookUrl}" \\
            -H "Content-Type: application/json" \\
            -H "X-Webhook-Signature: $signature" \\
            -d "$payload" > /dev/null 2>&1 || true
    }
    
    # Run task-loop (output already goes to abraxas.log via exec redirect)
    cd /home/sprite/repo
    echo "=== Starting task-loop for ${prdName} ==="
    task-loop "${prdName}" 2>&1 | while IFS= read -r line; do echo "[$(date '+%Y-%m-%d %H:%M:%S')] $line"; done
    TASK_EXIT_CODE=\${PIPESTATUS[0]}
    
    if [ "$TASK_EXIT_CODE" -ne 0 ]; then
        send_error "task-loop exited with code $TASK_EXIT_CODE"
    fi
    
    echo "=== task-loop finished with exit code $TASK_EXIT_CODE ==="
else
    echo "No prd.json found at $PRD_FILE - skipping auto-start"
    echo "Use 'Start task-loop' button after creating PRD"
fi
`
    : '# No prdName provided - manual task-loop start required'
}
`
}

/**
 * Spawn a sprite for manifest execution (long-running opencode session).
 *
 * Creates a new sprite with public URL, clones the repo,
 * sets up opencode auth and abraxas-opencode-setup files,
 * then starts opencode serve and task-loop.
 */
export const spawnManifestSprite = (config: SpawnManifestSpriteConfig) =>
  Effect.gen(function* () {
    const sprites = yield* Sprites
    const db = yield* Db

    const { project, userId, branchName, prdName } = config

    // Generate webhook secret for this sprite
    const webhookSecret = generateWebhookSecret()

    // Build webhook URL for this sprite (using branchName as identifier)
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/manifest/${encodeURIComponent(branchName)}`

    const spriteName = generateManifestSpriteName(project.id)

    // Decrypt GitHub token for repo cloning
    const githubToken = yield* decryptToken(project.encryptedGithubToken)

    yield* Effect.annotateCurrentSpan({
      'sprite.name': spriteName,
      'project.id': project.id,
      'branch.name': branchName,
      'prd.name': prdName
    })

    yield* Effect.log(`Creating manifest sprite: ${spriteName} for branch ${branchName}`)

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

    // Insert sprite record into DB
    yield* db.insert(schema.sprites).values({
      projectId: project.id,
      branchName,
      type: 'manifest',
      status: 'running',
      spriteName,
      spriteUrl,
      webhookSecret
    })

    yield* Effect.log(`Saved sprite details to DB for branch ${branchName}`)

    // Get opencode auth for the setup script
    const opencodeAuth = yield* getOpencodeAuth(userId)

    // Generate base setup + manifest execution script
    const baseSetup = generateBaseSetupScript({
      githubToken,
      repoUrl: project.repositoryUrl,
      opencodeAuth,
      opencodeSetupRepoUrl: sprites.opencodeSetupRepoUrl,
      localSetupScript: project.localSetupScript ?? undefined,
      branchName
    })

    const hasLocalSetup = project.localSetupScript !== null
    const manifestExecution = generateManifestExecutionScript({
      webhookUrl,
      webhookSecret,
      prdName,
      hasLocalSetup
    })

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
