'use server'

import { Effect, Match, Schema } from 'effect'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { getSession } from '@/lib/services/auth/get-session'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { encryptToken } from '@/lib/core/crypto/encrypt'
import { eq } from 'drizzle-orm'
import { ValidationError } from '@/lib/core/errors'

/**
 * Schema for opencode auth.json structure
 * Supports both API key and OAuth token types
 */
const OpencodeAuthEntry = Schema.Struct({
  type: Schema.Literal('api', 'oauth'),
  key: Schema.optional(Schema.String),
  refresh: Schema.optional(Schema.String),
  access: Schema.optional(Schema.String),
  expires: Schema.optional(Schema.Number)
})

const OpencodeAuthSchema = Schema.Record({
  key: Schema.String,
  value: OpencodeAuthEntry
})

type OpencodeAuth = typeof OpencodeAuthSchema.Type

/**
 * Extract Anthropic OAuth expiry from parsed auth.json
 * Returns Date if found, undefined otherwise
 */
const extractAnthropicExpiry = (auth: OpencodeAuth): Date | undefined => {
  const anthropic = auth['anthropic']
  if (anthropic?.type === 'oauth' && anthropic.expires !== undefined) {
    return new Date(anthropic.expires)
  }
  return undefined
}

/**
 * Save the user's opencode auth.json content (encrypted)
 * This allows sprites to use the user's model subscriptions
 */
export const saveOpencodeAuthAction = async (authJsonContent: string) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const { user } = yield* getSession()
      const db = yield* Db

      yield* Effect.annotateCurrentSpan({
        'user.id': user.id,
        'user.email': user.email
      })

      // Parse and validate the auth.json structure
      const parseResult = yield* Schema.decodeUnknown(OpencodeAuthSchema)(
        JSON.parse(authJsonContent)
      ).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid auth.json format. Expected opencode auth.json structure.',
              field: 'authJsonContent'
            })
        )
      )

      // Re-stringify to ensure consistent format
      const normalizedContent = JSON.stringify(parseResult)

      // Extract Anthropic OAuth expiry if present
      const anthropicOauthExpiresAt = extractAnthropicExpiry(parseResult)

      // Encrypt the entire auth.json content
      const encryptedAuth = yield* encryptToken(normalizedContent)

      // Update user with encrypted auth and expiry timestamp
      yield* db
        .update(schema.user)
        .set({
          encryptedOpencodeAuth: encryptedAuth,
          anthropicOauthExpiresAt
        })
        .where(eq(schema.user.id, user.id))

      return { saved: true }
    }).pipe(
      Effect.withSpan('action.opencode-auth.save', {
        attributes: {
          operation: 'opencode-auth.save'
        }
      }),
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
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: `Failed to save auth: ${error.message}`
              })
            )
          ),
        onSuccess: () =>
          Effect.succeed({
            _tag: 'Success' as const,
            message: 'Opencode auth saved successfully'
          })
      })
    )
  )
}
