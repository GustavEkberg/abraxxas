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
}): string {
  const { prdName, webhookUrl, webhookSecret } = config

  return `#!/bin/bash
set -euo pipefail

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

# Function to send completed webhook
send_completed() {
    if [ -f "$PRD_JSON_PATH" ]; then
        local prd_content
        prd_content=$(cat "$PRD_JSON_PATH" | jq -c '.')
        
        local payload
        payload=$(jq -n \\
            --arg type "completed" \\
            --argjson prdJson "$prd_content" \\
            '{type: $type, prdJson: ($prdJson | tostring)}')
        
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
    
    # Wait for log file to exist
    while [ ! -f "$LOG_FILE" ]; do
        sleep 1
    done
    
    # Tail the log file and watch for iteration markers
    tail -f "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do
        # Check for iteration marker: "=== Iteration N/M ==="
        if [[ "$line" =~ ===\\ Iteration\\ ([0-9]+)/([0-9]+)\\ === ]]; then
            local iteration="\${BASH_REMATCH[1]}"
            max_iterations="\${BASH_REMATCH[2]}"
            
            # Send task_loop_started on first iteration
            if [ "$last_iteration" -eq 0 ]; then
                send_task_loop_started
            fi
            
            # Only send progress if iteration changed
            if [ "$iteration" -ne "$last_iteration" ]; then
                last_iteration="$iteration"
                # Small delay to let prd.json be written
                sleep 2
                send_progress "$iteration" "$max_iterations"
            fi
        fi
        
        # Check for completion
        if [[ "$line" == *"PRD complete"* ]]; then
            sleep 2
            send_completed
            break
        fi
        
        # Check for max iterations reached
        if [[ "$line" == *"Max iterations"* ]]; then
            sleep 2
            send_completed
            break
        fi
    done
}

# Clean up any previous log file
rm -f "$LOG_FILE"

# Start the monitor in background
monitor_log &
MONITOR_PID=$!

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

      // Verify user owns parent project
      yield* getProject(manifest.projectId)

      yield* Effect.annotateCurrentSpan({
        'sprite.name': manifest.spriteName,
        'manifest.prdName': manifest.prdName
      })

      // Build webhook URL for this manifest
      const webhookUrl = `${sprites.webhookBaseUrl}/api/webhooks/manifest/${manifestId}`

      // Generate wrapper script that monitors task-loop and sends progress webhooks
      const wrapperScript = generateTaskLoopWrapperScript({
        prdName: manifest.prdName,
        webhookUrl,
        webhookSecret: manifest.webhookSecret
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
