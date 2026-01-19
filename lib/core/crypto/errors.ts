import { Data } from 'effect'

export class EncryptionError extends Data.TaggedError('EncryptionError')<{
  message: string
  cause?: unknown
}> {}

export class DecryptionError extends Data.TaggedError('DecryptionError')<{
  message: string
  cause?: unknown
}> {}

export class CryptoConfigError extends Data.TaggedError('CryptoConfigError')<{
  message: string
}> {}
