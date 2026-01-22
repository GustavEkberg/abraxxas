'use server'

import { Effect, Match } from 'effect'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { getProject } from './get-project'

/**
 * Default setup script that:
 * 1. Installs Docker
 * 2. Installs pnpm dependencies
 * 3. Starts docker compose services
 * 4. Parses docker-compose.yml to construct DATABASE_URL
 * 5. Creates .env.local with the DATABASE_URL
 */
const DEFAULT_SETUP_SCRIPT = `#!/bin/bash
set -e

# Install Docker
echo "Installing Docker..."
curl -fsSL https://get.docker.com | sh

# Start docker daemon with sudo
echo "Starting Docker daemon..."
sudo dockerd &

# Wait for docker to be ready
echo "Waiting for Docker to be ready..."
for i in {1..30}; do
  if sudo docker info > /dev/null 2>&1; then
    echo "Docker is ready"
    break
  fi
  sleep 1
done

cd /home/sprite/repo

# Install dependencies
pnpm install

# Start docker services
sudo docker compose up -d

# Wait for containers to be ready
sleep 5

# Parse docker-compose.yml for postgres DATABASE_URL
COMPOSE_FILE=""
[ -f "docker-compose.yml" ] && COMPOSE_FILE="docker-compose.yml"
[ -f "docker-compose.yaml" ] && COMPOSE_FILE="docker-compose.yaml"

if [ -n "$COMPOSE_FILE" ]; then
  POSTGRES_USER=$(grep -E '^\\s*POSTGRES_USER[=:]' "$COMPOSE_FILE" 2>/dev/null | head -1 | sed 's/.*[=:]\\s*//' | tr -d '"'"'" || true)
  POSTGRES_PASSWORD=$(grep -E '^\\s*POSTGRES_PASSWORD[=:]' "$COMPOSE_FILE" 2>/dev/null | head -1 | sed 's/.*[=:]\\s*//' | tr -d '"'"'" || true)
  POSTGRES_DB=$(grep -E '^\\s*POSTGRES_DB[=:]' "$COMPOSE_FILE" 2>/dev/null | head -1 | sed 's/.*[=:]\\s*//' | tr -d '"'"'" || true)
  PORT=$(grep -E '^\\s*-\\s*"?[0-9]+:[0-9]+"?' "$COMPOSE_FILE" 2>/dev/null | head -1 | sed 's/.*-\\s*"*\\([0-9]*\\):.*/\\1/' || true)
  
  [ -z "$POSTGRES_USER" ] && POSTGRES_USER="postgres"
  [ -z "$POSTGRES_PASSWORD" ] && POSTGRES_PASSWORD="postgres"
  [ -z "$POSTGRES_DB" ] && POSTGRES_DB="postgres"
  [ -z "$PORT" ] && PORT="5432"
  
  DATABASE_URL="postgres://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@localhost:\${PORT}/\${POSTGRES_DB}"
  
  echo "DATABASE_URL=\${DATABASE_URL}" > .env.local
  echo "Created .env.local with DATABASE_URL"
else
  echo "No docker-compose.yml found, skipping .env.local"
fi

echo "Local setup complete"
`

type ToggleLocalSetupResult =
  | { _tag: 'Success'; enabled: boolean }
  | { _tag: 'Error'; message: string }

/**
 * Toggle local setup script for a project.
 * If currently disabled (null), enables with default script.
 * If currently enabled (non-null), disables by setting to null.
 */
export const toggleLocalSetupAction = async (
  projectId: string
): Promise<ToggleLocalSetupResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const db = yield* Db

      // Verify user owns the project
      const project = yield* getProject(projectId)

      yield* Effect.annotateCurrentSpan({
        'project.id': project.id,
        'localSetup.currentlyEnabled': project.localSetupScript !== null
      })

      const isCurrentlyEnabled = project.localSetupScript !== null
      const newValue = isCurrentlyEnabled ? null : DEFAULT_SETUP_SCRIPT

      yield* db
        .update(schema.projects)
        .set({ localSetupScript: newValue })
        .where(eq(schema.projects.id, projectId))

      yield* Effect.log(
        `Local setup ${isCurrentlyEnabled ? 'disabled' : 'enabled'} for project ${projectId}`
      )

      return !isCurrentlyEnabled
    }).pipe(
      Effect.withSpan('action.project.toggleLocalSetup'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('NotFoundError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Project not found'
              })
            ),
            Match.when('UnauthorizedError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'You do not have access to this project'
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'message' in error ? error.message : 'Unknown error'
              })
            )
          ),
        onSuccess: enabled =>
          Effect.sync(() => {
            revalidatePath(`/rituals/${projectId}`)
            return {
              _tag: 'Success' as const,
              enabled
            }
          })
      })
    )
  )
}
