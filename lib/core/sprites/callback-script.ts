import { createHmac, randomBytes } from 'crypto'
import { Option } from 'effect'
import { generateBaseSetupScript, type BaseSetupConfig } from './base-setup-script'

/**
 * Configuration for generating invocation callback scripts.
 * Note: Auth is handled via Sprites network policy (DNS whitelist), not password.
 */
export interface InvocationScriptConfig {
  sessionId: string
  taskId: string
  webhookUrl: string
  webhookSecret: string
  prompt: string
  /** Model in format provider/model (e.g., anthropic/claude-sonnet-4-5-20250929) */
  model: string
  /** Branch name for pushing changes */
  branchName: string
  /** Base setup configuration */
  baseSetup: BaseSetupConfig
}

/**
 * @deprecated Use InvocationScriptConfig instead
 */
export interface CallbackScriptConfig {
  sessionId: string
  taskId: string
  webhookUrl: string
  webhookSecret: string
  prompt: string
  repoUrl: string
  githubToken: string
  branchName: string
  /** Model in format provider/model (e.g., anthropic/claude-sonnet-4-5-20250929) */
  model: string
  /** Optional setup script to run before cloning (e.g., install opencode) */
  setupScript?: string
}

/**
 * Generate HMAC signature for webhook payload.
 */
export function generateSignature(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`
}

/**
 * Generate a random webhook secret.
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Default setup script - kept for backwards compatibility.
 * @deprecated Use generateBaseSetupScript from base-setup-script.ts instead
 */
export const DEFAULT_SETUP_SCRIPT = `
# Add common binary paths
export PATH="$HOME/.local/bin:$HOME/bin:$HOME/.opencode/bin:/usr/local/bin:$PATH"

echo "Checking for opencode..."
if ! command -v opencode &> /dev/null; then
    echo "Installing opencode..."
    curl -fsSL https://opencode.ai/install | bash
    
    # Re-source bashrc to pick up PATH changes
    [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"
    
    # Also try common install locations explicitly
    export PATH="$HOME/.local/bin:$HOME/bin:$HOME/.opencode/bin:$PATH"
fi


echo "opencode ready"
opencode --version || true
`

/**
 * Generate the invocation-specific execution script (webhook callbacks, opencode run, etc.)
 * This is appended after the base setup script.
 */
function generateInvocationExecutionScript(config: {
  sessionId: string
  taskId: string
  webhookUrl: string
  webhookSecret: string
  prompt: string
  model: string
  branchName: string
}): string {
  const { sessionId, taskId, webhookUrl, webhookSecret, prompt, model, branchName } = config

  // Escape special characters in the prompt for bash
  const escapedPrompt = prompt
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')

  return `
# ===========================================
# Invocation Execution Script
# ===========================================

WEBHOOK_URL="${webhookUrl}"
WEBHOOK_SECRET="${webhookSecret}"
SESSION_ID="${sessionId}"
TASK_ID="${taskId}"
BRANCH_NAME="${branchName}"

# Function to push code and get the actual branch name
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
        git commit -m "chore: final invocation changes" >/dev/null 2>&1 || true
    fi
    
    # Push the branch (redirect all output to avoid capturing it)
    git push -u origin "$branch_name" >/dev/null 2>&1 || git push origin "$branch_name" >/dev/null 2>&1 || true
    
    # Return only the branch name
    echo "$branch_name"
}

# Function to send webhook
send_webhook() {
    local type="$1"
    local summary="$2"
    local error="$3"
    local stats="$4"
    local progress_data="\${5:-}"
    local branch_name="\${6:-}"
    
    echo "Sending webhook: type=$type"
    
    # Build JSON payload
    local payload
    if [ "$type" = "completed" ]; then
        if [ -n "$stats" ] && [ -n "$branch_name" ]; then
            payload='{"type":"completed","sessionId":"'"$SESSION_ID"'","taskId":"'"$TASK_ID"'","summary":"'"$summary"'","branchName":"'"$branch_name"'","stats":'"$stats"'}'
        elif [ -n "$stats" ]; then
            payload='{"type":"completed","sessionId":"'"$SESSION_ID"'","taskId":"'"$TASK_ID"'","summary":"'"$summary"'","stats":'"$stats"'}'
        elif [ -n "$branch_name" ]; then
            payload='{"type":"completed","sessionId":"'"$SESSION_ID"'","taskId":"'"$TASK_ID"'","summary":"'"$summary"'","branchName":"'"$branch_name"'"}'
        else
            payload='{"type":"completed","sessionId":"'"$SESSION_ID"'","taskId":"'"$TASK_ID"'","summary":"'"$summary"'"}'
        fi
    elif [ "$type" = "error" ]; then
        payload='{"type":"error","sessionId":"'"$SESSION_ID"'","taskId":"'"$TASK_ID"'","error":"'"$error"'"}'
    elif [ "$type" = "progress" ]; then
        payload='{"type":"progress","sessionId":"'"$SESSION_ID"'","taskId":"'"$TASK_ID"'","progress":'"$progress_data"'}'
    else
        payload='{"type":"'"$type"'","sessionId":"'"$SESSION_ID"'","taskId":"'"$TASK_ID"'"}'
    fi
    
    # Generate HMAC signature
    local signature
    signature="sha256=$(echo -n "$payload" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')"
    
    echo "Webhook URL: $WEBHOOK_URL"
    echo "Payload length: \${#payload} bytes"
    
    # Send webhook with verbose output and proper error handling
    local response_code
    response_code=$(curl -w "%{http_code}" -o /tmp/webhook-response.txt -X POST "$WEBHOOK_URL" \\
        -H "Content-Type: application/json" \\
        -H "X-Webhook-Signature: $signature" \\
        -d "$payload" 2>&1)
    
    local curl_exit=$?
    
    if [ $curl_exit -eq 0 ] && [ "$response_code" = "200" ]; then
        echo "Webhook sent successfully (HTTP $response_code)"
        [ -f /tmp/webhook-response.txt ] && cat /tmp/webhook-response.txt
        return 0
    else
        echo "ERROR: Webhook failed (curl exit: $curl_exit, HTTP: $response_code)"
        [ -f /tmp/webhook-response.txt ] && cat /tmp/webhook-response.txt
        echo "Full curl output: $response_code"
        return 1
    fi
}

# Function to extract token counts from OpenCode JSON events
extract_token_stats() {
    local json_file="$1"
    
    if [ ! -f "$json_file" ]; then
        echo '{"messageCount":0,"inputTokens":0,"outputTokens":0}'
        return
    fi
    
    # Parse JSON events to extract token usage
    local message_count=0
    local input_tokens=0
    local output_tokens=0
    
    message_count=$(grep -c '"type":"step_finish"' "$json_file" 2>/dev/null || echo "0")
    input_tokens=$(grep -o '"tokens":{[^}]*"input":[0-9]*' "$json_file" 2>/dev/null | grep -o '"input":[0-9]*' | grep -o '[0-9]*' | awk '{s+=\$1} END {print s+0}')
    output_tokens=$(grep -o '"tokens":{[^}]*"output":[0-9]*' "$json_file" 2>/dev/null | grep -o '"output":[0-9]*' | grep -o '[0-9]*' | awk '{s+=\$1} END {print s+0}')
    
    message_count=\${message_count:-0}
    input_tokens=\${input_tokens:-0}
    output_tokens=\${output_tokens:-0}
    
    echo '{"messageCount":'"$message_count"',"inputTokens":'"$input_tokens"',"outputTokens":'"$output_tokens"'}'
}

# Function to send progress updates periodically
monitor_progress() {
    local json_file="$1"
    local output_file="$2"
    local pid="$3"
    
    echo "[Progress Monitor] Starting progress monitoring for PID $pid"
    
    while kill -0 "$pid" 2>/dev/null; do
        sleep 10
        
        if ! kill -0 "$pid" 2>/dev/null; then
            break
        fi
        
        local last_line=""
        if [ -f "$output_file" ]; then
            last_line=$(tail -n 5 "$json_file" 2>/dev/null | grep -o '"content":"[^"]*"' | tail -1 | sed 's/"content":"//;s/"$//' | head -c 200 || echo "Processing...")
        else
            last_line="Processing..."
        fi
        
        local stats=$(extract_token_stats "$json_file")
        local msg_count=$(echo "$stats" | grep -o '"messageCount":[0-9]*' | grep -o '[0-9]*' || echo "0")
        local in_tokens=$(echo "$stats" | grep -o '"inputTokens":[0-9]*' | grep -o '[0-9]*' | tail -1 || echo "0")
        local out_tokens=$(echo "$stats" | grep -o '"outputTokens":[0-9]*' | grep -o '[0-9]*' | tail -1 || echo "0")
        
        msg_count=\${msg_count:-0}
        in_tokens=\${in_tokens:-0}
        out_tokens=\${out_tokens:-0}
        
        local progress_json='{"message":"'"$last_line"'","messageCount":'"$msg_count"',"inputTokens":'"$in_tokens"',"outputTokens":'"$out_tokens"'}'
        
        send_webhook "progress" "" "" "" "$progress_json" || true
    done
}

echo ""
echo "Running opencode..."
echo "================================"

OPENCODE_OUTPUT_FILE="/tmp/opencode-output.txt"
OPENCODE_JSON_FILE="/tmp/opencode-events.jsonl"
OPENCODE_EXIT_CODE=0

touch "$OPENCODE_OUTPUT_FILE" "$OPENCODE_JSON_FILE"

nohup opencode run --model "${model}" --format json "${escapedPrompt} !ALWAYS COMMIT YOUR WORK TO BRANCH ${branchName} AND PUSH WHEN YOU ARE DONE!" > >(tee "$OPENCODE_OUTPUT_FILE" "$OPENCODE_JSON_FILE") 2>&1 &
OPENCODE_PID=$!

monitor_progress "$OPENCODE_JSON_FILE" "$OPENCODE_OUTPUT_FILE" "$OPENCODE_PID" &
MONITOR_PID=$!

if wait "$OPENCODE_PID"; then
    OPENCODE_EXIT_CODE=0
else
    OPENCODE_EXIT_CODE=$?
fi

kill "$MONITOR_PID" 2>/dev/null || true
wait "$MONITOR_PID" 2>/dev/null || true

echo ""
echo "================================"
echo "OpenCode exit code: $OPENCODE_EXIT_CODE"

SUMMARY=""
STATS_JSON=""
if [ -f "$OPENCODE_JSON_FILE" ]; then
    SUMMARY=$(grep '"type":"text"' "$OPENCODE_JSON_FILE" | tail -3 | grep -o '"text":"[^"]*"' | sed 's/"text":"//;s/"$//' | tr '\\n' ' ' | tail -c 500 | sed 's/\\\\/\\\\\\\\/g' | sed 's/"/\\\\"/g')
    
    if [ -z "$SUMMARY" ]; then
        SUMMARY="Task completed successfully"
    fi
    
    STATS_JSON=$(extract_token_stats "$OPENCODE_JSON_FILE")
fi

set +e

if [ $OPENCODE_EXIT_CODE -eq 0 ]; then
    echo "Execution completed successfully"
    
    # Push code and get the actual branch name
    ACTUAL_BRANCH=$(push_and_get_branch)
    echo "Branch: $ACTUAL_BRANCH"
    
    if [ -n "$SUMMARY" ]; then
        send_webhook "completed" "$SUMMARY" "" "$STATS_JSON" "" "$ACTUAL_BRANCH"
    else
        send_webhook "completed" "Task executed successfully" "" "$STATS_JSON" "" "$ACTUAL_BRANCH"
    fi
    
    WEBHOOK_EXIT=$?
    if [ $WEBHOOK_EXIT -ne 0 ]; then
        echo "WARNING: Webhook send failed, but task completed successfully"
    fi
else
    echo "Execution failed with exit code: $OPENCODE_EXIT_CODE"
    
    ERROR_CONTEXT=""
    if [ -n "$SUMMARY" ]; then
        ERROR_CONTEXT="OpenCode exited with code $OPENCODE_EXIT_CODE. Last output: $SUMMARY"
    else
        ERROR_CONTEXT="OpenCode exited with code $OPENCODE_EXIT_CODE"
    fi
    send_webhook "error" "" "$ERROR_CONTEXT" "" ""
    
    WEBHOOK_EXIT=$?
    if [ $WEBHOOK_EXIT -ne 0 ]; then
        echo "ERROR: Failed to send error webhook"
    fi
fi

echo ""
echo "=== Execution Complete ==="
`
}

/**
 * Generate the complete invocation script with base setup + execution.
 */
export function generateInvocationScript(config: InvocationScriptConfig): string {
  const { sessionId, taskId, webhookUrl, webhookSecret, prompt, model, branchName } = config

  const baseSetupScript = generateBaseSetupScript(config.baseSetup)
  const executionScript = generateInvocationExecutionScript({
    sessionId,
    taskId,
    webhookUrl,
    webhookSecret,
    prompt,
    model,
    branchName
  })

  return `#!/bin/bash
set -euo pipefail

# Redirect all output to /tmp/abraxas.log for log viewing
exec > >(tee /tmp/abraxas.log) 2>&1

echo "=== Abraxas Sprite Execution ==="
echo "Session: ${sessionId}"
echo "Task: ${taskId}"
echo ""

echo "=== Setup Phase ==="
${baseSetupScript}
echo ""

${executionScript}
`
}

/**
 * Generate the callback script that runs inside the Sprite.
 * @deprecated Use generateInvocationScript instead for new code.
 *
 * This function is kept for backwards compatibility.
 */
export function generateCallbackScript(config: CallbackScriptConfig): string {
  const {
    sessionId,
    taskId,
    webhookUrl,
    webhookSecret,
    prompt,
    repoUrl,
    githubToken,
    branchName,
    model
  } = config

  // Convert old config format to new format
  return generateInvocationScript({
    sessionId,
    taskId,
    webhookUrl,
    webhookSecret,
    prompt,
    model,
    branchName,
    baseSetup: {
      githubToken,
      repoUrl,
      opencodeAuth: Option.none(),
      opencodeSetupRepoUrl:
        process.env.OPENCODE_SETUP_REPO_URL || 'https://github.com/anomalyco/opencode-setup',
      branchName
    }
  })
}
