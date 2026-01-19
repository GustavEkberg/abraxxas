import { Data } from 'effect'

export class SpritesApiError extends Data.TaggedError('SpritesApiError')<{
  message: string
  status?: number
  cause?: unknown
}> {}

export class SpritesNotFoundError extends Data.TaggedError('SpritesNotFoundError')<{
  message: string
  spriteName: string
}> {}

export class SpritesConfigError extends Data.TaggedError('SpritesConfigError')<{
  message: string
  cause?: unknown
}> {}

export class SpriteExecutionError extends Data.TaggedError('SpriteExecutionError')<{
  message: string
  spriteName: string
  cause?: unknown
}> {}
