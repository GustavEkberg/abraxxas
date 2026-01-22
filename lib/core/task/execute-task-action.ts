'use server'

import { Effect, Match } from 'effect'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { getSession } from '@/lib/services/auth/get-session'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { getProject } from '@/lib/core/project/get-project'
import { eq } from 'drizzle-orm'
import { NotFoundError, ValidationError } from '@/lib/core/errors'
import { decryptToken } from '@/lib/core/crypto/encrypt'
import { spawnSpriteForTask } from '@/lib/core/sprites/spawn-sprite'
import { getOpencodeModel } from '@/lib/utils'
import { createId } from '@paralleldrive/cuid2'

type ExecuteTaskInput = {
  taskId: string
}

/**
 * Build prompt from task title, description, and comments.
 */
const buildPrompt = (
  task: schema.Task,
  comments: Array<{ content: string; isAgentComment: boolean; agentName: string | null }>
): string => {
  let prompt = `Task: ${task.title}\n\n`

  if (task.description) {
    prompt += `Description:\n${task.description}\n\n`
  }

  if (comments.length > 0) {
    prompt += `Comments:\n`
    comments.forEach(comment => {
      const author = comment.isAgentComment ? `Agent (${comment.agentName || 'unknown'})` : 'User'
      prompt += `- ${author}: ${comment.content}\n`
    })
    prompt += `\n`
  }

  return prompt
}

export const executeTaskAction = async (input: ExecuteTaskInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const { user } = yield* getSession()
      const db = yield* Db

      yield* Effect.annotateCurrentSpan({
        'task.id': input.taskId,
        'user.id': user.id
      })

      // Fetch the task
      const tasks = yield* db.select().from(schema.tasks).where(eq(schema.tasks.id, input.taskId))

      if (tasks.length === 0) {
        return yield* Effect.fail(
          new NotFoundError({
            message: 'Task not found',
            entity: 'task',
            id: input.taskId
          })
        )
      }

      const task = tasks[0]

      // Verify user owns the parent project
      const project = yield* getProject(task.projectId)

      // Check task not already executing
      if (task.executionState === 'in_progress') {
        return yield* Effect.fail(
          new ValidationError({
            message: 'Task is already executing',
            field: 'executionState'
          })
        )
      }

      // Fetch comments for the task
      const comments = yield* db
        .select({
          content: schema.comments.content,
          isAgentComment: schema.comments.isAgentComment,
          agentName: schema.comments.agentName
        })
        .from(schema.comments)
        .where(eq(schema.comments.taskId, input.taskId))
        .orderBy(schema.comments.createdAt)

      // Build prompt from task + comments
      const prompt = buildPrompt(task, comments)

      yield* Effect.log(`Built prompt for task ${task.id}: ${prompt.slice(0, 100)}...`)

      // Decrypt GitHub token
      const decryptedToken = yield* decryptToken(project.encryptedGithubToken)

      // Spawn sprite
      const { spriteName, spriteUrl, spritePassword, webhookSecret, branchName } =
        yield* spawnSpriteForTask({
          task: {
            id: task.id,
            title: task.title,
            description: task.description,
            branchName: task.branchName,
            model: task.model
          },
          project: {
            id: project.id,
            name: project.name,
            repositoryUrl: project.repositoryUrl,
            encryptedGithubToken: project.encryptedGithubToken
          },
          prompt,
          decryptedGithubToken: decryptedToken,
          userId: user.id,
          opencodeModel: getOpencodeModel(task.model)
        })

      yield* Effect.log(`Spawned sprite ${spriteName} for task ${task.id}`)

      // Create opencode session record with sprite credentials
      const sessionId = createId()
      yield* db.insert(schema.opencodeSessions).values({
        id: sessionId,
        taskId: task.id,
        sessionId: task.id,
        status: 'pending',
        executionMode: 'sprite',
        spriteName,
        spriteUrl,
        spritePassword,
        webhookSecret,
        branchName
      })

      // Update task to in_progress and set branchName if it was generated
      yield* db
        .update(schema.tasks)
        .set({
          executionState: 'in_progress',
          status: 'ritual',
          branchName
        })
        .where(eq(schema.tasks.id, task.id))

      // Post 'started' agent comment
      yield* db.insert(schema.comments).values({
        taskId: task.id,
        userId: null,
        isAgentComment: true,
        agentName: 'Abraxas',
        content: `Execution started on sprite: ${spriteName}\nBranch: ${branchName}`
      })

      yield* Effect.log(`Created session and comment for task ${task.id}`)

      return { task, spriteName, branchName }
    }).pipe(
      Effect.withSpan('action.task.execute', {
        attributes: {
          operation: 'task.execute'
        }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('NotFoundError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.when('UnauthorizedError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'You do not have access to this project'
              })
            ),
            Match.when('ValidationError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: `Failed to execute task: ${error.message}`
              })
            )
          ),
        onSuccess: result =>
          Effect.sync(() => {
            revalidatePath(`/rituals/${result.task.projectId}`)
            return {
              _tag: 'Success' as const,
              data: {
                taskId: result.task.id,
                spriteName: result.spriteName,
                branchName: result.branchName
              }
            }
          })
      })
    )
  )
}
