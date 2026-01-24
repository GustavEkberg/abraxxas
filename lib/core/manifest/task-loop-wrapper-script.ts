/**
 * Generate a bash script that runs task-loop.
 * Progress/completion is detected by polling GitHub, not webhooks.
 */
export function generateTaskLoopWrapperScript(config: {
  prdName: string
  webhookUrl: string
  webhookSecret: string
  hasLocalSetup: boolean
}): string {
  const { prdName, webhookUrl, webhookSecret, hasLocalSetup } = config

  return `#!/bin/bash
set -euo pipefail

# Logging with timestamps
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Source environment (not auto-sourced in detached sessions)
# Wait for file to exist (setup script may still be writing it)
for i in {1..30}; do
  if [ -f /etc/profile.d/sprite-env.sh ]; then
    source /etc/profile.d/sprite-env.sh
    log "Environment sourced"
    break
  fi
  sleep 1
done

if [ ! -f /etc/profile.d/sprite-env.sh ]; then
  log "ERROR: /etc/profile.d/sprite-env.sh not found after 30s"
  exit 1
fi

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

# Keep sprite alive with periodic network activity
# Sprites go to sleep without outbound connections
(
  while true; do
    curl -s https://example.com > /dev/null 2>&1 || true
    sleep 30
  done
) &
KEEPALIVE_PID=$!
trap "kill $KEEPALIVE_PID 2>/dev/null || true" EXIT

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
