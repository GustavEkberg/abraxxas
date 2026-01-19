import { Effect } from 'effect'
import { getSession } from '@/lib/services/auth/get-session'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { eq } from 'drizzle-orm'
import { NotFoundError, UnauthorizedError } from '@/lib/core/errors'

export const getProject = (projectId: string) =>
  Effect.gen(function* () {
    const { user } = yield* getSession()
    const db = yield* Db

    const projects = yield* db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))

    if (projects.length === 0) {
      return yield* Effect.fail(
        new NotFoundError({
          message: 'Project not found',
          entity: 'project',
          id: projectId
        })
      )
    }

    const project = projects[0]

    if (project.userId !== user.id) {
      return yield* Effect.fail(
        new UnauthorizedError({
          message: 'You do not have access to this project'
        })
      )
    }

    return project
  }).pipe(Effect.withSpan('Project.getProject'))
