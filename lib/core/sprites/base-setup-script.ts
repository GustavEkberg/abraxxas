import { Option } from 'effect'

/**
 * Configuration for the base setup script.
 */
export interface BaseSetupConfig {
  /** GitHub token for repo authentication */
  githubToken: string
  /** Repository URL (https://github.com/owner/repo) */
  repoUrl: string
  /** Opencode auth JSON string (optional) */
  opencodeAuth: Option.Option<string>
  /** Opencode setup repo URL (for commands/skills) */
  opencodeSetupRepoUrl: string
  /** Project-specific setup script to run after base setup (optional) */
  localSetupScript?: string
  /** Git user email for commits */
  gitUserEmail?: string
  /** Git user name for commits */
  gitUserName?: string
  /** Branch to checkout (optional - will use default branch if not specified) */
  branchName?: string
}

/**
 * Generate the authenticated repo URL with GitHub token.
 */
export function getAuthRepoUrl(repoUrl: string, githubToken: string): string {
  return repoUrl.replace('https://github.com/', `https://${githubToken}@github.com/`)
}

/**
 * Generate the base setup script that handles common sprite initialization:
 * - Installs opencode, pnpm in parallel
 * - Clones repository
 * - Sets up environment variables
 * - Configures git
 * - Runs pnpm install
 *
 * This script is meant to be composed with execution-specific scripts.
 */
export function generateBaseSetupScript(config: BaseSetupConfig): string {
  const {
    githubToken,
    repoUrl,
    opencodeAuth,
    opencodeSetupRepoUrl,
    localSetupScript,
    gitUserEmail = process.env.GH_USER_EMAIL || 'abraxas@sprites.dev',
    gitUserName = process.env.GH_USER_NAME || 'abraxxxxas',
    branchName
  } = config

  const authRepoUrl = getAuthRepoUrl(repoUrl, githubToken)
  const opencodeSetupRepoName = opencodeSetupRepoUrl.split('/').pop() || 'opencode-setup'

  return `
# ===========================================
# Base Setup - Common to all sprite executions
# ===========================================

# Verify network connectivity
echo "Checking network connectivity..."
ping -c 2 google.com || { echo "ERROR: Network unreachable"; exit 1; }
echo "Network OK"

# Create directories upfront
mkdir -p /home/sprite/.local/share/opencode
mkdir -p /home/sprite/.config/opencode/command
mkdir -p /home/sprite/.config/opencode/skill
mkdir -p /home/sprite/repo

# Run downloads and installs in parallel
echo "Starting parallel downloads and installs..."

git clone --depth 1 "${authRepoUrl}" /home/sprite/repo &
PID_REPO=$!

curl -fsSL https://opencode.ai/install | bash &
PID_OPENCODE=$!

curl -sL ${opencodeSetupRepoUrl}/archive/refs/heads/main.tar.gz | tar -xzf - -C /tmp &
PID_SETUP=$!

export SHELL=/bin/bash
curl -fsSL https://get.pnpm.io/install.sh | SHELL=/bin/bash sh - &
PID_PNPM=$!

# Install Docker (runs in background, don't wait - takes too long)
nohup sh -c 'curl -fsSL https://get.docker.com | sh' > /tmp/docker-install.log 2>&1 &
echo "Docker install started in background (PID: $!)"

# Wait for critical downloads
echo "Waiting for downloads to complete..."
wait $PID_REPO || { echo "Repo clone failed"; exit 1; }
echo "Repo cloned"
wait $PID_OPENCODE || { echo "Opencode install failed"; exit 1; }
echo "Opencode installed"
wait $PID_SETUP || { echo "Setup tarball failed"; exit 1; }
echo "Setup tarball extracted"
wait $PID_PNPM || { echo "pnpm install failed"; exit 1; }
echo "pnpm installed"

# Add pnpm and opencode to PATH permanently (for current script)
export PNPM_HOME="/home/sprite/.local/share/pnpm"
export PATH="/usr/local/bin:$PNPM_HOME:/home/sprite/.opencode/bin:$PATH"

# Setup Docker environment
export DOCKER_HOST="unix:///var/run/docker.sock"

# Verify pnpm is accessible
echo "pnpm location: $(which pnpm 2>/dev/null || echo 'not found')"
ls -la "$PNPM_HOME" 2>/dev/null || true

# Add to shell configs for future sessions (bash)
cat >> /home/sprite/.bashrc << 'BASHRCEOF'
export PNPM_HOME="/home/sprite/.local/share/pnpm"
export PATH="/usr/local/bin:$PNPM_HOME:/home/sprite/.opencode/bin:$PATH"
export HOME=/home/sprite
export XDG_CONFIG_HOME=/home/sprite/.config
export XDG_DATA_HOME=/home/sprite/.local/share
export DOCKER_HOST="unix:///var/run/docker.sock"
BASHRCEOF

mkdir -p /home/sprite/.config/fish
cat >> /home/sprite/.config/fish/config.fish << 'FISHEOF'
set -gx PNPM_HOME "/home/sprite/.local/share/pnpm"
fish_add_path $PNPM_HOME
fish_add_path /home/sprite/.opencode/bin
set -gx DOCKER_HOST "unix:///var/run/docker.sock"
FISHEOF

# Add to /etc/profile.d for all shells
cat > /etc/profile.d/sprite-env.sh << 'PROFILEEOF'
export PNPM_HOME="/home/sprite/.local/share/pnpm"
export PATH="/usr/local/bin:$PNPM_HOME:/home/sprite/.opencode/bin:$PATH"
export HOME=/home/sprite
export XDG_CONFIG_HOME=/home/sprite/.config
export XDG_DATA_HOME=/home/sprite/.local/share
export DOCKER_HOST="unix:///var/run/docker.sock"
PROFILEEOF

# Docker daemon will be started by task-loop wrapper (install runs in background)

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

# Install commands and skills
cp /tmp/${opencodeSetupRepoName}-main/command/*.md /home/sprite/.config/opencode/command/ 2>/dev/null || true
cp -r /tmp/${opencodeSetupRepoName}-main/skill/* /home/sprite/.config/opencode/skill/ 2>/dev/null || true
if [ -f /tmp/${opencodeSetupRepoName}-main/bin/task-loop.sh ]; then
    cp /tmp/${opencodeSetupRepoName}-main/bin/task-loop.sh /usr/local/bin/task-loop && chmod +x /usr/local/bin/task-loop
fi

cd /home/sprite/repo

# Configure git
git config user.email "${gitUserEmail}"
git config user.name "${gitUserName}"

${
  branchName
    ? `
# Checkout branch (fetch + checkout if exists, create if not)
echo "Checking out branch: ${branchName}"
git fetch origin "${branchName}" 2>/dev/null || true
if git show-ref --verify --quiet "refs/remotes/origin/${branchName}"; then
    echo "Branch exists on remote, checking out..."
    git checkout "${branchName}" || { echo "ERROR: Failed to checkout branch"; exit 1; }
    git pull origin "${branchName}" 2>&1 || true
else
    echo "Creating new branch: ${branchName}"
    git checkout -b "${branchName}" || { echo "ERROR: Failed to create branch"; exit 1; }
fi
`
    : '# No branch specified, using default'
}

# Create opencode config with permissions and default model
cat > /home/sprite/repo/opencode.json << 'CONFIGEOF'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-opus-4-5-20251101",
  "agent": {
    "build": {
      "permission": {
        "read": {
          ".sprite/*": "allow",
          "/.sprite/*": "allow"
        },
        "write": {
          ".sprite/*": "allow",
          "/.sprite/*": "allow"
        }
      }
    }
  }
}
CONFIGEOF

# Run pnpm install if package.json exists
if [ -f /home/sprite/repo/package.json ]; then
    echo "Running pnpm install..."
    cd /home/sprite/repo
    pnpm install --frozen-lockfile 2>&1 || pnpm install 2>&1 || echo "WARNING: pnpm install had issues (continuing anyway)"
    echo "pnpm install complete"
fi

# Run local setup script if configured
${
  localSetupScript
    ? `
echo "Running local setup script..."
cat > /tmp/local-setup.sh << 'LOCALSETUPEOF'
${localSetupScript}
LOCALSETUPEOF
chmod +x /tmp/local-setup.sh
cd /home/sprite/repo
/tmp/local-setup.sh 2>&1 || echo "WARNING: Local setup script failed (continuing anyway)"
echo "Local setup script finished"
`
    : 'echo "No local setup script configured"'
}

# Start opencode serve in background for MCP access
echo "Starting opencode serve..."
HOME=/home/sprite XDG_CONFIG_HOME=/home/sprite/.config XDG_DATA_HOME=/home/sprite/.local/share nohup opencode serve --hostname 0.0.0.0 --port 8080 > /tmp/opencode-serve.log 2>&1 &
sleep 2
echo "opencode serve started on port 8080"

echo "=== Base Setup Complete ==="
`
}
