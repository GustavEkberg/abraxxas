'use server'

import { Effect, Option } from 'effect'
import { NextEffect } from '@/lib/next-effect'
import { AppLayer } from '@/lib/layers'
import { getLatestSession } from '@/lib/core/session/get-latest-session'

export interface TaskDetailsResult {
  errorMessage: string | null
}

export const getTaskDetailsAction = async (
  taskId: string
): Promise<{ _tag: 'Success'; data: TaskDetailsResult } | { _tag: 'Error'; message: string }> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* Effect.option(getLatestSession(taskId))

      return {
        errorMessage: Option.match(session, {
          onNone: () => null,
          onSome: s => s.errorMessage
        })
      }
    }).pipe(
      Effect.withSpan('action.task.getDetails'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Effect.succeed({
            _tag: 'Error' as const,
            message: 'message' in error ? error.message : 'Failed to fetch task details'
          }),
        onSuccess: data =>
          Effect.succeed({
            _tag: 'Success' as const,
            data
          })
      })
    )
  )
}
