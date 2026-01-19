'use server'

import { Effect, Match } from 'effect'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { getProject } from '@/lib/core/project/get-project'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { encryptToken } from '@/lib/core/crypto/encrypt'
import { eq } from 'drizzle-orm'

type UpdateProjectInput = {
  projectId: string
  name?: string
  description?: string
  repositoryUrl?: string
  githubToken?: string
  agentsMdContent?: string
}

export const updateProjectAction = async (input: UpdateProjectInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // Verify user owns project before update
      const project = yield* getProject(input.projectId)
      const db = yield* Db

      yield* Effect.annotateCurrentSpan({
        'project.id': input.projectId,
        'project.name': project.name
      })

      // Build update values, re-encrypt GitHub token if provided
      const updateValues: Partial<typeof schema.projects.$inferInsert> = {}

      if (input.name !== undefined) updateValues.name = input.name
      if (input.description !== undefined) updateValues.description = input.description
      if (input.repositoryUrl !== undefined) updateValues.repositoryUrl = input.repositoryUrl
      if (input.agentsMdContent !== undefined) updateValues.agentsMdContent = input.agentsMdContent

      if (input.githubToken !== undefined) {
        const encryptedGithubToken = yield* encryptToken(input.githubToken)
        updateValues.encryptedGithubToken = encryptedGithubToken
      }

      // Update the project
      const [updatedProject] = yield* db
        .update(schema.projects)
        .set(updateValues)
        .where(eq(schema.projects.id, input.projectId))
        .returning()

      return updatedProject
    }).pipe(
      Effect.withSpan('action.project.update', {
        attributes: {
          operation: 'project.update'
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
                message: 'You do not have permission to update this project'
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: `Failed to update project: ${error.message}`
              })
            )
          ),
        onSuccess: updatedProject =>
          Effect.sync(() => {
            revalidatePath('/')
            revalidatePath(`/rituals/${input.projectId}`)
            return { _tag: 'Success' as const, data: updatedProject }
          })
      })
    )
  )
}
