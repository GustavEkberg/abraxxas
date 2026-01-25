'use server'

import { Effect, Match } from 'effect'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import { Sprites } from '@/lib/services/sprites/live-layer'
import { SpriteExecutionError } from '@/lib/services/sprites/errors'
import { getProject } from '@/lib/core/project/get-project'
import { getOpencodeAuth } from '@/lib/core/opencode-auth/get-opencode-auth'
import { decryptToken } from '@/lib/core/crypto/encrypt'
import { generateBaseSetupScript } from '@/lib/core/sprites/base-setup-script'
import { generateWebhookSecret } from '@/lib/core/sprites/callback-script'
import * as schema from '@/lib/services/db/schema'
import { generateManifestSpriteName } from './spawn-manifest-sprite'

type SpawnPrdCreatorInput = {
  projectId: string
}

type SpawnPrdCreatorSuccess = {
  _tag: 'Success'
  data: {
    spriteName: string
    spriteUrl: string
    branchName: string
  }
}

type SpawnPrdCreatorError = {
  _tag: 'Error'
  message: string
}

type SpawnPrdCreatorResult = SpawnPrdCreatorSuccess | SpawnPrdCreatorError

/**
 * Spawn an ephemeral sprite for creating a new PRD.
 * This sprite does NOT auto-start task-loop - it's for manual PRD creation.
 * User creates the PRD, pushes to a new manifest- branch, then destroys the sprite.
 */
export const spawnPrdCreatorAction = async (
  input: SpawnPrdCreatorInput
): Promise<SpawnPrdCreatorResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // Verify user owns the project
      const project = yield* getProject(input.projectId)
      const db = yield* Db
      const sprites = yield* Sprites

      yield* Effect.annotateCurrentSpan({
        'project.id': project.id
      })

      // Generate a temporary branch name for the creator sprite
      const timestamp = Date.now()
      const branchName = `manifest-creator-${timestamp}`

      // Generate webhook secret
      const webhookSecret = generateWebhookSecret()
      const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/manifest/${encodeURIComponent(branchName)}`

      const spriteName = generateManifestSpriteName(project.id)

      // Decrypt GitHub token for repo cloning
      const githubToken = yield* decryptToken(project.encryptedGithubToken)

      yield* Effect.log(`Creating PRD creator sprite: ${spriteName}`)

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

      // Set network policy
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
      }

      // Insert sprite record into DB
      yield* db.insert(schema.sprites).values({
        branchName,
        projectId: project.id,
        type: 'manifest',
        status: 'active',
        spriteName,
        spriteUrl,
        webhookSecret
      })

      yield* Effect.log(`Saved PRD creator sprite to DB`)

      // Get opencode auth for the setup script
      const opencodeAuth = yield* getOpencodeAuth(project.userId)

      // Generate base setup script (no task-loop, just repo clone and opencode serve)
      const baseSetup = generateBaseSetupScript({
        githubToken,
        repoUrl: project.repositoryUrl,
        opencodeAuth,
        opencodeSetupRepoUrl: sprites.opencodeSetupRepoUrl,
        localSetupScript: project.localSetupScript ?? undefined
        // No branchName - start from default branch
      })

      const setupScript = `#!/bin/bash
set -euo pipefail

# Redirect all output to /tmp/abraxas.log for log viewing
exec > >(tee /tmp/abraxas.log) 2>&1

echo "=== PRD Creator Sprite Setup ==="

# Webhook environment variables for /prd-task-hook skill
export MANIFEST_WEBHOOK_URL="${webhookUrl}"
export MANIFEST_WEBHOOK_SECRET="${webhookSecret}"

# Keep sprite alive during setup
nohup ping google.com -c 60 > /dev/null 2>&1 &

${baseSetup}

echo "=== PRD Creator Ready ==="
echo "Create your PRD using the /prd skill, then push to a manifest- branch."
echo "When done, destroy this sprite from the UI."
`

      // Write setup script to sprite
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

      // Run setup script via WebSocket TTY mode
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

      yield* Effect.log(`Setup script started for PRD creator ${spriteName}`)

      return {
        spriteName,
        spriteUrl,
        branchName
      }
    }).pipe(
      Effect.withSpan('action.manifest.spawnPrdCreator'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error).pipe(
            Match.when({ _tag: 'UnauthenticatedError' }, () => NextEffect.redirect('/login')),
            Match.when({ _tag: 'NotFoundError' }, () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Project not found'
              })
            ),
            Match.when({ _tag: 'UnauthorizedError' }, () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'You do not have access to this project'
              })
            ),
            Match.orElse(e =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'message' in e ? e.message : 'Failed to spawn PRD creator'
              })
            )
          ),
        onSuccess: result =>
          Effect.sync(() => {
            revalidatePath(`/rituals/${input.projectId}`)
            return {
              _tag: 'Success' as const,
              data: result
            }
          })
      })
    )
  )
}
