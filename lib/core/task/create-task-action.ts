'use server'

import { Effect, Match } from 'effect'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { getProject } from '@/lib/core/project/get-project'

type CreateTaskInput = {
  projectId: string
  title: string
  description?: string
  type: 'bug' | 'feature' | 'plan' | 'other'
  model: 'grok-1' | 'claude-opus-4-5' | 'claude-sonnet-4-5' | 'claude-haiku-4-5'
}

export const createTaskAction = async (input: CreateTaskInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // Verify user owns the project
      const project = yield* getProject(input.projectId)
      const db = yield* Db

      yield* Effect.annotateCurrentSpan({
        'project.id': project.id,
        'task.title': input.title,
        'task.type': input.type,
        'task.model': input.model
      })

      // Create the task
      const [task] = yield* db
        .insert(schema.tasks)
        .values({
          projectId: input.projectId,
          title: input.title,
          description: input.description,
          type: input.type,
          model: input.model
          // status and executionState use their defaults from schema
        })
        .returning()

      return task
    }).pipe(
      Effect.withSpan('action.task.create', {
        attributes: {
          operation: 'task.create'
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
                message: 'Project not found'
              })
            ),
            Match.when('UnauthorizedError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'You do not have access to this project'
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: `Failed to create task: ${error.message}`
              })
            )
          ),
        onSuccess: task =>
          Effect.sync(() => {
            revalidatePath(`/rituals/${input.projectId}`)
            return { _tag: 'Success' as const, data: task }
          })
      })
    )
  )
}
