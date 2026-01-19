import { createHmac, randomBytes } from 'crypto'

/**
 * Configuration for generating callback scripts.
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
 * Default setup script - installs opencode if not present.
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
 * Generate the callback script that runs inside the Sprite.
 *
 * This script:
 * 1. Runs setup script to install dependencies (if provided)
 * 2. Clones the repository using the GitHub token
 * 3. Creates and checks out a new branch
 * 4. Runs opencode with the prompt
 * 5. Captures the exit code and output
 * 6. Sends a webhook with the result
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
    setupScript = DEFAULT_SETUP_SCRIPT
  } = config

  // Escape special characters in the prompt for bash
  const escapedPrompt = prompt
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')

  // Parse the repo URL to inject the token
  // https://github.com/owner/repo -> https://{token}@github.com/owner/repo
  const authRepoUrl = repoUrl.replace('https://github.com/', `https://${githubToken}@github.com/`)

  // Git user config from environment
  const gitUserEmail = process.env.GH_USER_EMAIL || 'abraxas@sprites.dev'
  const gitUserName = process.env.GH_USER_NAME || 'abraxxxxas'

  return `#!/bin/bash
set -euo pipefail

WEBHOOK_URL="${webhookUrl}"
WEBHOOK_SECRET="${webhookSecret}"
SESSION_ID="${sessionId}"
TASK_ID="${taskId}"
BRANCH_NAME="${branchName}"

# Function to send webhook
send_webhook() {
    local type="$1"
    local summary="$2"
    local error="$3"
    local stats="$4"
    local progress_data="\${5:-}"
    
    echo "Sending webhook: type=$type"
    
    # Build JSON payload
    local payload
    if [ "$type" = "completed" ]; then
        if [ -n "$stats" ]; then
            payload='{"type":"completed","sessionId":"'"$SESSION_ID"'","taskId":"'"$TASK_ID"'","summary":"'"$summary"'","stats":'"$stats"'}'
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

echo "=== Abraxas Sprite Execution ==="
echo "Session: $SESSION_ID"
echo "Task: $TASK_ID"
echo ""

# Run setup script
echo "=== Setup Phase ==="
${setupScript}
echo "=== Setup Complete ==="
echo ""

# Clone repository
echo "Cloning repository..."
set +e
if ! git clone "${authRepoUrl}" /home/sprite/repo 2>&1; then
    echo "ERROR: Failed to clone repository"
    send_webhook "error" "" "Failed to clone repository" "" ""
    exit 1
fi
set -e

cd /home/sprite/repo

# Configure git
git config user.email "${gitUserEmail}"
git config user.name "${gitUserName}"

# Create and checkout branch
echo "Creating branch: $BRANCH_NAME"
set +e
if ! git checkout -b "$BRANCH_NAME" 2>&1; then
    echo "ERROR: Failed to create branch: $BRANCH_NAME"
    send_webhook "error" "" "Failed to create branch: $BRANCH_NAME" "" ""
    exit 1
fi
set -e

echo ""
echo "Running opencode..."
echo "================================"

OPENCODE_OUTPUT_FILE="/tmp/opencode-output.txt"
OPENCODE_JSON_FILE="/tmp/opencode-events.jsonl"
OPENCODE_EXIT_CODE=0

touch "$OPENCODE_OUTPUT_FILE" "$OPENCODE_JSON_FILE"

opencode run --format json "${escapedPrompt} !ALWAYS COMMIT YOUR WORK TO BRANCH ${branchName} AND PUSH WHEN YOU ARE DONE!" > >(tee "$OPENCODE_OUTPUT_FILE" "$OPENCODE_JSON_FILE") 2>&1 &
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
    
    if [ -n "$SUMMARY" ]; then
        send_webhook "completed" "$SUMMARY" "" "$STATS_JSON"
    else
        send_webhook "completed" "Task executed successfully" "" "$STATS_JSON"
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
