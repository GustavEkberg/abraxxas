'use server'

import { Effect, Match } from 'effect'
import { revalidatePath } from 'next/cache'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
import { getSession } from '@/lib/services/auth/get-session'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { encryptToken } from '@/lib/core/crypto/encrypt'

type CreateProjectInput = {
  name: string
  description?: string
  repositoryUrl: string
  githubToken: string
  agentsMdContent?: string
}

export const createProjectAction = async (input: CreateProjectInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const { user } = yield* getSession()
      const db = yield* Db

      yield* Effect.annotateCurrentSpan({
        'user.id': user.id,
        'user.email': user.email,
        'project.name': input.name
      })

      // Encrypt the GitHub token
      const encryptedGithubToken = yield* encryptToken(input.githubToken)

      // Create the project
      const [project] = yield* db
        .insert(schema.projects)
        .values({
          userId: user.id,
          name: input.name,
          description: input.description,
          repositoryUrl: input.repositoryUrl,
          encryptedGithubToken,
          agentsMdContent: input.agentsMdContent
        })
        .returning()

      return project
    }).pipe(
      Effect.withSpan('action.project.create', {
        attributes: {
          operation: 'project.create'
        }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: `Failed to create project: ${error.message}`
              })
            )
          ),
        onSuccess: project =>
          Effect.sync(() => {
            revalidatePath('/')
            return { _tag: 'Success' as const, data: project }
          })
      })
    )
  )
}
