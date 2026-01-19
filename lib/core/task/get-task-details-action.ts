'use server'

import { Effect, Option } from 'effect'
import { NextEffect } from '@/lib/next-effect'
import { AppLayer } from '@/lib/layers'
import { getComments } from '@/lib/core/comment/get-comments'
import { getLatestSession } from '@/lib/core/session/get-latest-session'

export interface TaskDetailsResult {
  comments: Array<{
    id: string
    content: string
    isAgentComment: boolean
    agentName: string | null
    userId: string | null
    createdAt: Date
  }>
  session: {
    messageCount: string | null
    inputTokens: string | null
    outputTokens: string | null
  } | null
}

export const getTaskDetailsAction = async (
  taskId: string
): Promise<{ _tag: 'Success'; data: TaskDetailsResult } | { _tag: 'Error'; message: string }> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const comments = yield* getComments(taskId)

      const session = yield* Effect.option(getLatestSession(taskId))

      return {
        comments,
        session: Option.match(session, {
          onNone: () => null,
          onSome: s => ({
            messageCount: s.messageCount,
            inputTokens: s.inputTokens,
            outputTokens: s.outputTokens
          })
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
