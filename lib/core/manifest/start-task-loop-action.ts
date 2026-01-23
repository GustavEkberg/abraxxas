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
 * Generate a bash script that wraps task-loop and monitors its output for iteration markers.
 * When a new iteration is detected, it reads prd.json and sends a progress webhook.
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

# Start Docker daemon (installed async during setup, may need to wait)
DOCKERD_PID=""
DOCKER_READY=false

# Wait for Docker to be installed (up to 60s)
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

${
  hasLocalSetup
    ? `
# Start docker compose services (local setup enabled)
if [ "$DOCKER_READY" = true ]; then
  cd /home/sprite/repo
  if [ -f "docker-compose.yml" ] || [ -f "docker-compose.yaml" ]; then
    echo "Starting docker compose services..."
    sudo docker compose up -d
    sleep 5
    echo "Docker services started"
  fi
else
  echo "WARNING: Docker not ready, skipping docker compose"
fi
`
    : '# No local setup - skipping docker compose'
}

PRD_NAME="${prdName}"
WEBHOOK_URL="${webhookUrl}"
WEBHOOK_SECRET="${webhookSecret}"
LOG_FILE="/tmp/task-loop.log"
PRD_JSON_PATH="/home/sprite/repo/.opencode/state/\${PRD_NAME}/prd.json"

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

# Function to send progress webhook with current prd.json
send_progress() {
    local iteration="$1"
    local max_iterations="$2"
    
    if [ -f "$PRD_JSON_PATH" ]; then
        # Read and escape prd.json content for JSON embedding
        local prd_content
        prd_content=$(cat "$PRD_JSON_PATH" | jq -c '.')
        
        # Build payload with proper JSON escaping
        local payload
        payload=$(jq -n \\
            --arg type "progress" \\
            --argjson prdJson "$prd_content" \\
            --argjson iteration "$iteration" \\
            --argjson maxIterations "$max_iterations" \\
            '{type: $type, prdJson: ($prdJson | tostring), iteration: $iteration, maxIterations: $maxIterations}')
        
        send_webhook "$payload"
    fi
}

# Function to send task_loop_started webhook
send_task_loop_started() {
    if [ -f "$PRD_JSON_PATH" ]; then
        local prd_content
        prd_content=$(cat "$PRD_JSON_PATH" | jq -c '.')
        
        local payload
        payload=$(jq -n \\
            --arg type "task_loop_started" \\
            --argjson prdJson "$prd_content" \\
            '{type: $type, prdJson: ($prdJson | tostring)}')
        
        send_webhook "$payload"
    fi
}

# Function to push code and get branch name
push_and_get_branch() {
    cd /home/sprite/repo
    
    # Get current branch name first (before any push output)
    local branch_name
    branch_name=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    
    if [ -z "$branch_name" ] || [ "$branch_name" = "HEAD" ]; then
        echo ""
        return
    fi
    
    # Check if there are any changes to commit
    if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
        # Stage and commit any remaining changes
        git add -A
        git commit -m "chore: final manifest changes" >/dev/null 2>&1 || true
    fi
    
    # Push the branch (redirect all output to avoid capturing it)
    git push -u origin "$branch_name" >/dev/null 2>&1 || git push origin "$branch_name" >/dev/null 2>&1 || true
    
    # Return only the branch name
    echo "$branch_name"
}

# Function to send completed webhook (idempotent - uses flag file)
send_completed() {
    # Prevent duplicate completed webhooks
    if [ -f "/tmp/completed_sent" ]; then
        return
    fi
    touch "/tmp/completed_sent"
    
    # Push code and capture branch name
    local branch_name
    branch_name=$(push_and_get_branch)
    
    if [ -f "$PRD_JSON_PATH" ]; then
        local prd_content
        prd_content=$(cat "$PRD_JSON_PATH" | jq -c '.')
        
        local payload
        payload=$(jq -n \\
            --arg type "completed" \\
            --argjson prdJson "$prd_content" \\
            --arg branchName "$branch_name" \\
            '{type: $type, prdJson: ($prdJson | tostring), branchName: $branchName}')
        
        send_webhook "$payload"
    fi
}

# Function to send error webhook
send_error() {
    local error_msg="$1"
    local payload
    payload=$(jq -n --arg type "error" --arg error "$error_msg" '{type: $type, error: $error}')
    send_webhook "$payload"
}

# Monitor function that watches the log file
monitor_log() {
    local last_iteration=0
    local max_iterations=25
    local task_loop_started=false
    local completed_sent=false
    
    echo "[monitor] Starting monitor_log" >> /tmp/monitor-debug.log
    
    # Wait for log file to exist
    while [ ! -f "$LOG_FILE" ]; do
        sleep 1
    done
    
    echo "[monitor] Log file exists, starting tail" >> /tmp/monitor-debug.log
    
    # Tail the log file and watch for iteration markers
    tail -f "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do
        echo "[monitor] Read line: $line" >> /tmp/monitor-debug.log
        
        # Check for iteration marker: "=== Iteration N/M ==="
        if [[ "$line" =~ ===[[:space:]]Iteration[[:space:]]([0-9]+)/([0-9]+)[[:space:]]=== ]]; then
            local iteration="\${BASH_REMATCH[1]}"
            max_iterations="\${BASH_REMATCH[2]}"
            
            echo "[monitor] Matched iteration=$iteration max=$max_iterations" >> /tmp/monitor-debug.log
            
            # Send task_loop_started on first iteration
            if [ "$task_loop_started" = false ]; then
                task_loop_started=true
                echo "[monitor] Sending task_loop_started" >> /tmp/monitor-debug.log
                send_task_loop_started
            fi
            
            # Only send progress if iteration changed
            if [ "$iteration" -ne "$last_iteration" ]; then
                last_iteration="$iteration"
                echo "[monitor] Sending progress for iteration $iteration" >> /tmp/monitor-debug.log
                # Small delay to let prd.json be written
                sleep 2
                send_progress "$iteration" "$max_iterations"
            fi
        fi
        
        # Check for completion - must have seen task_loop_started first
        # task-loop outputs "✅ PRD complete!" or "⚠️ Max iterations reached"
        if [ "$task_loop_started" = true ] && [ "$completed_sent" = false ]; then
            if [[ "$line" == *"PRD complete"* ]] || [[ "$line" == *"Max iterations"* ]]; then
                completed_sent=true
                echo "[monitor] Sending completed" >> /tmp/monitor-debug.log
                sleep 2
                send_completed
                break
            fi
        fi
    done
    
    echo "[monitor] Monitor loop exited" >> /tmp/monitor-debug.log
}

# Clean up any previous state files
rm -f "$LOG_FILE"
rm -f "/tmp/completed_sent"
rm -f /tmp/monitor-debug.log

echo "[main] Starting wrapper script" >> /tmp/monitor-debug.log
echo "[main] PRD_NAME=$PRD_NAME" >> /tmp/monitor-debug.log
echo "[main] WEBHOOK_URL=$WEBHOOK_URL" >> /tmp/monitor-debug.log

# Start the monitor in background
monitor_log &
MONITOR_PID=$!
echo "[main] Monitor started with PID=$MONITOR_PID" >> /tmp/monitor-debug.log

# Run task-loop and capture output to log file
cd /home/sprite/repo
task-loop "$PRD_NAME" 2>&1 | tee "$LOG_FILE"
TASK_EXIT_CODE=\${PIPESTATUS[0]}

# Give monitor time to process final output
sleep 3

# Kill the monitor
kill "$MONITOR_PID" 2>/dev/null || true

# Send final webhook based on exit code
if [ "$TASK_EXIT_CODE" -ne 0 ]; then
    send_error "task-loop exited with code $TASK_EXIT_CODE"
else
    # Ensure completed webhook is sent if task-loop succeeded
    # This is a fallback in case the monitor missed the completion marker
    send_completed
fi

# Stop Docker to allow sprite to sleep
if [ -n "\${DOCKERD_PID:-}" ]; then
  echo "Stopping Docker..."
  cd /home/sprite/repo
  if [ -f "docker-compose.yml" ] || [ -f "docker-compose.yaml" ]; then
    sudo docker compose down > /dev/null 2>&1 || true
  fi
  sudo kill $DOCKERD_PID 2>/dev/null || true
  echo "Docker stopped"
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
