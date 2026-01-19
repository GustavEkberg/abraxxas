import { Effect } from 'effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'

type CreateAgentCommentInput = {
  taskId: string
  content: string
  agentName: string
}

export const createAgentComment = (input: CreateAgentCommentInput) =>
  Effect.gen(function* () {
    const db = yield* Db

    yield* Effect.annotateCurrentSpan({
      'comment.taskId': input.taskId,
      'comment.agentName': input.agentName,
      'comment.contentLength': input.content.length
    })

    const [comment] = yield* db
      .insert(schema.comments)
      .values({
        taskId: input.taskId,
        userId: null,
        isAgentComment: true,
        agentName: input.agentName,
        content: input.content
      })
      .returning()

    return comment
  }).pipe(
    Effect.withSpan('Comment.createAgentComment', {
      attributes: {
        operation: 'comment.createAgent'
      }
    })
  )
