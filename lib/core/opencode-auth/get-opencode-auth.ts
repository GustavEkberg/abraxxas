import { Effect, Option } from 'effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { decryptToken } from '@/lib/core/crypto/encrypt'
import { eq } from 'drizzle-orm'

/**
 * Get decrypted opencode auth for a user
 * Returns Option.none() if user has no auth configured
 */
export const getOpencodeAuth = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Db

    const [user] = yield* db
      .select({ encryptedOpencodeAuth: schema.user.encryptedOpencodeAuth })
      .from(schema.user)
      .where(eq(schema.user.id, userId))

    if (!user?.encryptedOpencodeAuth) {
      return Option.none<string>()
    }

    const decryptedAuth = yield* decryptToken(user.encryptedOpencodeAuth)
    return Option.some(decryptedAuth)
  }).pipe(Effect.withSpan('opencode-auth.get'))
