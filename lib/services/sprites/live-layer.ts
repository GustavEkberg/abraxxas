import { Config, Context, Effect, Layer, Redacted } from 'effect'
import { SpritesClient } from '@fly/sprites'
import {
  SpritesApiError,
  SpritesConfigError,
  SpritesNotFoundError,
  SpriteExecutionError
} from './errors'

const SPRITES_API_BASE = 'https://api.sprites.dev/v1'

// Response types
export interface Sprite {
  id: string
  name: string
  organization: string
  url: string
  status: 'cold' | 'warm' | 'running'
  url_settings: {
    auth: 'sprite' | 'public'
  }
  created_at: string
  updated_at: string
}

export interface SpriteListEntry {
  name: string
  org_slug: string
  updated_at?: string
}

export interface SpriteListResponse {
  sprites: SpriteListEntry[]
  has_more: boolean
  next_continuation_token?: string
}

// Configuration service (internal)
class SpritesConfig extends Context.Tag('@app/SpritesConfig')<
  SpritesConfig,
  {
    readonly token: Redacted.Redacted<string>
    readonly webhookBaseUrl: string | undefined
    readonly timeoutMs: number
    readonly opencodeSetupRepoUrl: string
  }
>() {}

const SpritesConfigLive = Layer.effect(
  SpritesConfig,
  Effect.gen(function* () {
    const token = yield* Config.redacted('SPRITES_TOKEN').pipe(
      Effect.mapError(() => new SpritesConfigError({ message: 'SPRITES_TOKEN not found' }))
    )
    // Use VERCEL_BRANCH_URL for webhook base URL (auto-set by Vercel)
    // undefined locally - webhooks won't work in local dev anyway
    const vercelBranchUrl = yield* Config.string('VERCEL_BRANCH_URL').pipe(
      Effect.option,
      Effect.map(opt => (opt._tag === 'Some' ? `https://${opt.value}` : undefined))
    )
    const timeoutMs = yield* Config.number('SPRITE_TIMEOUT_MS').pipe(
      Config.withDefault(3600000) // 1 hour
    )
    const opencodeSetupRepoUrl = yield* Config.string('OPENCODE_SETUP_REPO_URL').pipe(
      Effect.mapError(
        () => new SpritesConfigError({ message: 'OPENCODE_SETUP_REPO_URL not found' })
      )
    )

    return { token, webhookBaseUrl: vercelBranchUrl, timeoutMs, opencodeSetupRepoUrl }
  })
)

// Type guard for error objects
const isErrorWithStatus = (error: unknown): error is { status?: number; message?: string } => {
  return typeof error === 'object' && error !== null && ('status' in error || 'message' in error)
}

// HTTP helper
const makeRequest = <T>(method: string, path: string, token: string, body?: unknown) =>
  Effect.tryPromise({
    try: async (): Promise<T | null> => {
      const response = await fetch(`${SPRITES_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw { status: response.status, message: text || response.statusText }
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return null
      }

      const text = await response.text()
      return text ? JSON.parse(text) : null
    },
    catch: error => {
      if (isErrorWithStatus(error) && error.status === 404) {
        return new SpritesNotFoundError({
          message: 'Sprite not found',
          spriteName: path.split('/')[2] || 'unknown'
        })
      }
      return new SpritesApiError({
        message:
          isErrorWithStatus(error) && error.message ? error.message : 'Sprites API request failed',
        status: isErrorWithStatus(error) ? error.status : undefined,
        cause: error
      })
    }
  })

// Service definition
// v4 migration: Change Effect.Service to ServiceMap.Service
export class Sprites extends Effect.Service<Sprites>()('@app/Sprites', {
  effect: Effect.gen(function* () {
    const config = yield* SpritesConfig

    const createSprite = (name: string, urlAuth: 'sprite' | 'public' = 'sprite') =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          'sprites.name': name,
          'sprites.urlAuth': urlAuth
        })

        const sprite = yield* makeRequest<Sprite>(
          'POST',
          '/sprites',
          Redacted.value(config.token),
          {
            name,
            url_settings: { auth: urlAuth }
          }
        )

        if (!sprite) {
          return yield* new SpritesApiError({ message: 'Create sprite returned no data' })
        }

        yield* Effect.annotateCurrentSpan({
          'sprites.id': sprite.id,
          'sprites.status': sprite.status
        })

        return sprite
      }).pipe(
        Effect.withSpan('Sprites.createSprite'),
        Effect.tapError(error => Effect.logError('Create sprite failed', { name, error }))
      )

    const getSprite = (name: string) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          'sprites.name': name
        })

        const sprite = yield* makeRequest<Sprite>(
          'GET',
          `/sprites/${name}`,
          Redacted.value(config.token)
        )

        if (!sprite) {
          return yield* new SpritesApiError({ message: 'Get sprite returned no data' })
        }

        return sprite
      }).pipe(
        Effect.withSpan('Sprites.getSprite'),
        Effect.tapError(error => Effect.logError('Get sprite failed', { name, error }))
      )

    const destroySprite = (name: string) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          'sprites.name': name
        })

        yield* makeRequest<void>('DELETE', `/sprites/${name}`, Redacted.value(config.token))
      }).pipe(
        Effect.withSpan('Sprites.destroySprite'),
        Effect.tapError(error => Effect.logError('Destroy sprite failed', { name, error }))
      )

    const execCommand = (
      spriteName: string,
      command: string[],
      options?: {
        env?: Record<string, string>
        dir?: string
        stdin?: string
        /** Max time to run after disconnect (e.g. "30s", "1m"). Default: 10s for non-TTY. */
        maxRunAfterDisconnect?: string
      }
    ) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          'sprites.name': spriteName,
          'sprites.command': command.join(' ')
        })

        const params = new URLSearchParams()
        command.forEach(c => params.append('cmd', c))
        if (options?.stdin) params.set('stdin', 'true')
        if (options?.dir) params.set('dir', options.dir)
        if (options?.maxRunAfterDisconnect)
          params.set('max_run_after_disconnect', options.maxRunAfterDisconnect)
        if (options?.env) {
          Object.entries(options.env).forEach(([key, value]) => {
            params.append('env', `${key}=${value}`)
          })
        }

        const path = `/sprites/${spriteName}/exec?${params.toString()}`

        const response = yield* Effect.tryPromise({
          try: async () => {
            const res = await fetch(`${SPRITES_API_BASE}${path}`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${Redacted.value(config.token)}`,
                'Content-Type': 'application/octet-stream'
              },
              body: options?.stdin || undefined
            })

            if (!res.ok) {
              const text = await res.text().catch(() => '')
              throw { status: res.status, message: text || res.statusText }
            }

            return res.text()
          },
          catch: error => {
            return new SpriteExecutionError({
              message:
                isErrorWithStatus(error) && error.message
                  ? error.message
                  : 'Command execution failed',
              spriteName,
              cause: error
            })
          }
        })

        return response
      }).pipe(
        Effect.withSpan('Sprites.execCommand'),
        Effect.tapError(error => Effect.logError('Exec command failed', { spriteName, error }))
      )

    const listSprites = (prefix?: string, maxResults?: number) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          'sprites.prefix': prefix || '',
          'sprites.maxResults': maxResults || 0
        })

        const params = new URLSearchParams()
        if (prefix) params.set('prefix', prefix)
        if (maxResults) params.set('max_results', maxResults.toString())

        const queryString = params.toString()
        const path = queryString ? `/sprites?${queryString}` : '/sprites'

        const response = yield* makeRequest<SpriteListResponse>(
          'GET',
          path,
          Redacted.value(config.token)
        )

        if (!response) {
          return yield* new SpritesApiError({ message: 'List sprites returned no data' })
        }

        return response
      }).pipe(
        Effect.withSpan('Sprites.listSprites'),
        Effect.tapError(error => Effect.logError('List sprites failed', { error }))
      )

    const updateUrlSettings = (name: string, auth: 'sprite' | 'public') =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          'sprites.name': name,
          'sprites.urlAuth': auth
        })

        const sprite = yield* makeRequest<Sprite>(
          'PUT',
          `/sprites/${name}`,
          Redacted.value(config.token),
          { url_settings: { auth } }
        )

        if (!sprite) {
          return yield* new SpritesApiError({ message: 'Update sprite returned no data' })
        }

        return sprite
      }).pipe(
        Effect.withSpan('Sprites.updateUrlSettings'),
        Effect.tapError(error => Effect.logError('Update URL settings failed', { name, error }))
      )

    /**
     * Execute a command via WebSocket with TTY mode enabled.
     * TTY mode has max_run_after_disconnect=0 (forever) by default,
     * so the command continues running after we disconnect.
     *
     * Use this for long-running setup scripts that need to survive HTTP timeouts.
     */
    const execDetached = (
      spriteName: string,
      command: string,
      args: string[] = [],
      options?: {
        env?: Record<string, string>
        cwd?: string
        stdin?: string
        /** Timeout in ms to wait for command to start before disconnecting (default: 5000) */
        startTimeout?: number
      }
    ) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          'sprites.name': spriteName,
          'sprites.command': `${command} ${args.join(' ')}`.trim()
        })

        yield* Effect.tryPromise({
          try: async () => {
            const client = new SpritesClient(Redacted.value(config.token))
            const sprite = client.sprite(spriteName)

            // Use TTY mode - it has max_run_after_disconnect=0 (forever) by default
            const cmd = sprite.spawn(command, args, {
              tty: true,
              env: options?.env,
              cwd: options?.cwd
            })

            // If we have stdin content, write it after command starts
            if (options?.stdin) {
              cmd.once('spawn', () => {
                cmd.stdin.write(options.stdin)
                cmd.stdin.end()
              })
            }

            // Wait for 'spawn' event (command started) then disconnect
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                cmd.kill()
                reject(new Error('Timeout waiting for command to start'))
              }, options?.startTimeout ?? 5000)

              cmd.once('spawn', () => {
                clearTimeout(timeout)
                // Small delay to ensure command is fully initialized
                setTimeout(() => {
                  cmd.kill() // Disconnect (command keeps running due to TTY mode)
                  resolve()
                }, 100)
              })

              cmd.once('error', err => {
                clearTimeout(timeout)
                reject(err)
              })
            })
          },
          catch: error => {
            return new SpriteExecutionError({
              message: error instanceof Error ? error.message : 'Failed to start detached command',
              spriteName,
              cause: error
            })
          }
        })
      }).pipe(
        Effect.withSpan('Sprites.execDetached'),
        Effect.tapError(error => Effect.logError('Exec detached failed', { spriteName, error }))
      )

    return {
      createSprite,
      getSprite,
      destroySprite,
      execCommand,
      execDetached,
      listSprites,
      updateUrlSettings,
      opencodeSetupRepoUrl: config.opencodeSetupRepoUrl,
      /** Webhook base URL (from VERCEL_BRANCH_URL). undefined locally. */
      webhookBaseUrl: config.webhookBaseUrl
    } as const
  })
}) {
  // Base layer (has unsatisfied SpritesConfig dependency)
  static layer = this.Default

  // Composed layer with all dependencies satisfied
  static Live = this.layer.pipe(Layer.provide(SpritesConfigLive))
}

// Re-export for convenience
export const SpritesLive = Sprites.Live
