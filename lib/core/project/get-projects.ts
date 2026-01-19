import { Effect } from 'effect'
import { getSession } from '@/lib/services/auth/get-session'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { eq } from 'drizzle-orm'

export const getProjects = () =>
  Effect.gen(function* () {
    const { user } = yield* getSession()
    const db = yield* Db

    const projects = yield* db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.userId, user.id))

    return projects
  }).pipe(Effect.withSpan('Project.getProjects'))
