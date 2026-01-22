'use server'

import { Effect, Match, Option } from 'effect'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { getSession } from '@/lib/services/auth/get-session'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { eq } from 'drizzle-orm'

const None = { _tag: 'None' } as const
const NoExpiry = { _tag: 'NoExpiry' } as const
const Expired = (expiredAt: number) => ({ _tag: 'Expired', expiredAt }) as const
const Valid = (expiresAt: number) => ({ _tag: 'Valid', expiresAt }) as const

export type OpencodeAuthStatus =
  | typeof None
  | typeof NoExpiry
  | ReturnType<typeof Expired>
  | ReturnType<typeof Valid>

/**
 * Get the status of user's opencode auth (OAuth expiry)
 */
export const getOpencodeAuthStatusAction = async (): Promise<OpencodeAuthStatus> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const { user } = yield* getSession()
      const db = yield* Db

      const rows = yield* db
        .select({
          encryptedOpencodeAuth: schema.user.encryptedOpencodeAuth,
          anthropicOauthExpiresAt: schema.user.anthropicOauthExpiresAt
        })
        .from(schema.user)
        .where(eq(schema.user.id, user.id))

      return Option.fromNullable(rows[0]).pipe(
        Option.flatMap(r => Option.fromNullable(r.encryptedOpencodeAuth).pipe(Option.map(() => r))),
        Option.match({
          onNone: () => None,
          onSome: r => {
            if (r.anthropicOauthExpiresAt === null) {
              return NoExpiry
            }
            const expiresAt = r.anthropicOauthExpiresAt.getTime()
            if (expiresAt < Date.now()) {
              return Expired(expiresAt)
            }
            return Valid(expiresAt)
          }
        })
      )
    }).pipe(
      Effect.withSpan('action.opencode-auth.get-status'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error).pipe(
            Match.when({ _tag: 'UnauthenticatedError' }, () => NextEffect.redirect('/login')),
            Match.orElse(() => Effect.succeed(None))
          ),
        onSuccess: status => Effect.succeed(status)
      })
    )
  )
}
