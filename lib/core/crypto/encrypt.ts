import { Config, Effect, Redacted } from 'effect'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { CryptoConfigError, DecryptionError, EncryptionError } from './errors'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const SALT_LENGTH = 64
const TAG_LENGTH = 16

/**
 * Get encryption key from config
 */
const getEncryptionKey = Effect.gen(function* () {
  const keyConfig = yield* Config.redacted('ENCRYPTION_KEY')
  const key = Redacted.value(keyConfig)

  if (!key || key.length === 0) {
    return yield* Effect.fail(
      new CryptoConfigError({ message: 'ENCRYPTION_KEY is not configured' })
    )
  }

  return key
}).pipe(Effect.withSpan('crypto.getEncryptionKey'))

/**
 * Encrypt a token using AES-256-GCM
 * Returns base64-encoded string: iv:salt:authTag:encryptedData
 */
export const encryptToken = (token: string) =>
  Effect.gen(function* () {
    const key = yield* getEncryptionKey

    return yield* Effect.try({
      try: () => {
        // Generate random IV and salt
        const iv = randomBytes(IV_LENGTH)
        const salt = randomBytes(SALT_LENGTH)

        // Create cipher
        const cipher = createCipheriv(ALGORITHM, Buffer.from(key, 'hex'), iv)

        // Encrypt
        const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])

        // Get auth tag
        const authTag = cipher.getAuthTag()

        // Combine: iv:salt:authTag:encryptedData
        const result = Buffer.concat([iv, salt, authTag, encrypted])

        return result.toString('base64')
      },
      catch: error => new EncryptionError({ message: 'Failed to encrypt token', cause: error })
    })
  }).pipe(Effect.withSpan('crypto.encryptToken'))

/**
 * Decrypt a token encrypted with encryptToken
 * Expects base64-encoded string: iv:salt:authTag:encryptedData
 */
export const decryptToken = (encryptedToken: string) =>
  Effect.gen(function* () {
    const key = yield* getEncryptionKey

    return yield* Effect.try({
      try: () => {
        // Decode from base64
        const buffer = Buffer.from(encryptedToken, 'base64')

        // Extract components
        const iv = buffer.subarray(0, IV_LENGTH)
        const _salt = buffer.subarray(IV_LENGTH, IV_LENGTH + SALT_LENGTH)
        const authTag = buffer.subarray(
          IV_LENGTH + SALT_LENGTH,
          IV_LENGTH + SALT_LENGTH + TAG_LENGTH
        )
        const encryptedData = buffer.subarray(IV_LENGTH + SALT_LENGTH + TAG_LENGTH)

        // Create decipher
        const decipher = createDecipheriv(ALGORITHM, Buffer.from(key, 'hex'), iv)
        decipher.setAuthTag(authTag)

        // Decrypt
        const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()])

        return decrypted.toString('utf8')
      },
      catch: error => new DecryptionError({ message: 'Failed to decrypt token', cause: error })
    })
  }).pipe(Effect.withSpan('crypto.decryptToken'))
