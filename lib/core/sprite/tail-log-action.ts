'use server'

import { Effect, Match } from 'effect'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Sprites } from '@/lib/services/sprites/live-layer'
import { ValidationError } from '@/lib/core/errors'
import { getSession } from '@/lib/services/auth/get-session'

type TailLogResult = { _tag: 'Success'; output: string } | { _tag: 'Error'; message: string }

const LOG_FILE = '/tmp/abraxas.log'
const DEFAULT_LINES = 20

export const tailLogAction = async (
  spriteName: string,
  options?: { lines?: number }
): Promise<TailLogResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      yield* getSession() // require auth
      const sprites = yield* Sprites

      if (!spriteName) {
        return yield* Effect.fail(
          new ValidationError({
            message: 'Sprite name is required',
            field: 'spriteName'
          })
        )
      }

      yield* Effect.annotateCurrentSpan({
        'sprite.name': spriteName,
        'log.lines': options?.lines ?? DEFAULT_LINES
      })

      const output = yield* sprites.execCommand(spriteName, [
        'tail',
        '-n',
        String(options?.lines ?? DEFAULT_LINES),
        LOG_FILE
      ])

      return { _tag: 'Success' as const, output }
    }).pipe(
      Effect.withSpan('action.sprite.tailLog'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('ValidationError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.when('SpriteExecutionError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Log file may not exist yet or sprite unavailable'
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            )
          ),
        onSuccess: result => Effect.succeed(result)
      })
    )
  )
}
