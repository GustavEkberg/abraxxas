'use server'

import { Effect, Match } from 'effect'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import { Sprites } from '@/lib/services/sprites/live-layer'
import * as schema from '@/lib/services/db/schema'
import { NotFoundError, ValidationError } from '@/lib/core/errors'
import { getProject } from '@/lib/core/project/get-project'

type StartTaskLoopResult = { _tag: 'Success' } | { _tag: 'Error'; message: string }

/**
 * Generate a bash script that runs task-loop.
 * Progress/completion is detected by polling GitHub, not webhooks.
 */
function generateTaskLoopWrapperScript(config: {
  prdName: string
  webhookUrl: string
  webhookSecret: string
  hasLocalSetup: boolean
}): string {
  const { prdName, webhookUrl, webhookSecret, hasLocalSetup } = config

  return `#!/bin/bash
set -euo pipefail

# Source environment (not auto-sourced in detached sessions)
source /etc/profile.d/sprite-env.sh

# Logging with timestamps
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Start Docker daemon (installed async during setup, may need to wait)
DOCKERD_PID=""
DOCKER_READY=false

# Check if Docker is already running
if sudo docker info > /dev/null 2>&1; then
  log "Docker already running"
  DOCKER_READY=true
else
  # Wait for Docker to be installed (up to 60s)
  log "Waiting for Docker installation..."
  for i in {1..60}; do
    if command -v dockerd &> /dev/null; then
      log "Docker installed after \${i}s"
      break
    fi
    sleep 1
  done

  if command -v dockerd &> /dev/null; then
    log "Starting Docker daemon..."
    sudo dockerd > /dev/null 2>&1 &
    DOCKERD_PID=$!

    log "Waiting for Docker to be ready..."
    for i in {1..30}; do
      if sudo docker info > /dev/null 2>&1; then
        log "Docker is ready"
        DOCKER_READY=true
        break
      fi
      sleep 1
    done
  else
    log "Docker not installed, skipping"
  fi
fi

${
  hasLocalSetup
    ? `
# Start docker compose services (local setup enabled)
if [ "$DOCKER_READY" = true ]; then
  cd /home/sprite/repo
  if [ -f "docker-compose.yml" ] || [ -f "docker-compose.yaml" ]; then
    # Check if services are already running
    RUNNING_CONTAINERS=$(sudo docker compose ps -q 2>/dev/null | wc -l)
    if [ "$RUNNING_CONTAINERS" -gt 0 ]; then
      log "Docker compose services already running ($RUNNING_CONTAINERS containers)"
    else
      log "Starting docker compose services..."
      sudo docker compose up -d
      sleep 5
      log "Docker services started"
    fi
  fi
else
  log "WARNING: Docker not ready, skipping docker compose"
fi
`
    : '# No local setup - skipping docker compose'
}

PRD_NAME="${prdName}"
WEBHOOK_URL="${webhookUrl}"
WEBHOOK_SECRET="${webhookSecret}"

# Function to send webhook with HMAC signature
send_webhook() {
    local payload="$1"
    local signature
    signature="sha256=$(echo -n "$payload" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')"
    
    curl -s -X POST "$WEBHOOK_URL" \\
        -H "Content-Type: application/json" \\
        -H "X-Webhook-Signature: $signature" \\
        -d "$payload" > /dev/null 2>&1 || true
}

# Function to send error webhook
send_error() {
    local error_msg="$1"
    local payload
    payload=$(jq -n --arg type "error" --arg error "$error_msg" '{type: $type, error: $error}')
    send_webhook "$payload"
}

# Run task-loop (prefix each line with timestamp)
cd /home/sprite/repo
task-loop "$PRD_NAME" 2>&1 | while IFS= read -r line; do echo "[$(date '+%Y-%m-%d %H:%M:%S')] $line"; done | tee /tmp/task-loop.log
TASK_EXIT_CODE=\${PIPESTATUS[0]}

# Send error webhook if task-loop failed
if [ "$TASK_EXIT_CODE" -ne 0 ]; then
    send_error "task-loop exited with code $TASK_EXIT_CODE"
fi

# Stop Docker to allow sprite to sleep
if [ -n "\${DOCKERD_PID:-}" ]; then
  log "Stopping Docker..."
  cd /home/sprite/repo
  if [ -f "docker-compose.yml" ] || [ -f "docker-compose.yaml" ]; then
    sudo docker compose down > /dev/null 2>&1 || true
  fi
  sudo kill $DOCKERD_PID 2>/dev/null || true
  log "Docker stopped"
fi

exit "$TASK_EXIT_CODE"
`
}

export const startTaskLoopAction = async (manifestId: string): Promise<StartTaskLoopResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const db = yield* Db
      const sprites = yield* Sprites

      yield* Effect.annotateCurrentSpan({ 'manifest.id': manifestId })

      // Fetch manifest
      const [manifest] = yield* db
        .select()
        .from(schema.manifests)
        .where(eq(schema.manifests.id, manifestId))
        .limit(1)

      if (!manifest) {
        return yield* Effect.fail(
          new NotFoundError({
            message: 'Manifest not found',
            entity: 'manifest',
            id: manifestId
          })
        )
      }

      // Verify manifest is active
      if (manifest.status !== 'active') {
        return yield* Effect.fail(
          new ValidationError({
            message: `Manifest must be active to start task loop (current: ${manifest.status})`,
            field: 'status'
          })
        )
      }

      // Verify sprite name exists
      if (!manifest.spriteName) {
        return yield* Effect.fail(
          new ValidationError({
            message: 'Manifest has no sprite associated',
            field: 'spriteName'
          })
        )
      }

      // Verify webhook secret exists
      if (!manifest.webhookSecret) {
        return yield* Effect.fail(
          new ValidationError({
            message: 'Manifest has no webhook secret',
            field: 'webhookSecret'
          })
        )
      }

      // Verify prdName is set
      if (!manifest.prdName) {
        return yield* Effect.fail(
          new ValidationError({
            message: 'PRD name must be set before starting task loop',
            field: 'prdName'
          })
        )
      }

      // Verify user owns parent project and get local setup config
      const project = yield* getProject(manifest.projectId)
      const hasLocalSetup = project.localSetupScript !== null

      yield* Effect.annotateCurrentSpan({
        'sprite.name': manifest.spriteName,
        'manifest.prdName': manifest.prdName,
        'project.hasLocalSetup': hasLocalSetup
      })

      // Build webhook URL for this manifest
      const webhookUrl = `${sprites.webhookBaseUrl}/api/webhooks/manifest/${manifestId}`

      // Generate wrapper script that monitors task-loop and sends progress webhooks
      const wrapperScript = generateTaskLoopWrapperScript({
        prdName: manifest.prdName,
        webhookUrl,
        webhookSecret: manifest.webhookSecret,
        hasLocalSetup
      })

      // Write wrapper script to sprite
      yield* sprites.execCommand(
        manifest.spriteName,
        ['bash', '-c', 'cat > /tmp/task-loop-wrapper.sh && chmod +x /tmp/task-loop-wrapper.sh'],
        { stdin: wrapperScript }
      )

      // Execute wrapper script in background using setsid to fully detach
      yield* sprites.execCommand(manifest.spriteName, [
        'bash',
        '-c',
        'setsid /tmp/task-loop-wrapper.sh > /tmp/wrapper.log 2>&1 < /dev/null &'
      ])

      yield* Effect.log(
        `Started task loop with progress monitoring on sprite ${manifest.spriteName}`
      )

      return { projectId: manifest.projectId }
    }).pipe(
      Effect.withSpan('action.manifest.startTaskLoop'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('NotFoundError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Manifest not found'
              })
            ),
            Match.when('UnauthorizedError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'You do not have access to this manifest'
              })
            ),
            Match.when('ValidationError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            )
          ),
        onSuccess: result =>
          Effect.sync(() => {
            revalidatePath(`/rituals/${result.projectId}`)
            return { _tag: 'Success' as const }
          })
      })
    )
  )
}
