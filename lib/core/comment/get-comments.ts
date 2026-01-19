import { Effect } from 'effect'
import { getSession } from '@/lib/services/auth/get-session'
import { Db } from '@/lib/services/db/live-layer'
import * as schema from '@/lib/services/db/schema'
import { eq, asc } from 'drizzle-orm'
import { NotFoundError, UnauthorizedError } from '@/lib/core/errors'

export const getComments = (taskId: string) =>
  Effect.gen(function* () {
    const { user } = yield* getSession()
    const db = yield* Db

    // Fetch task to get projectId
    const tasks = yield* db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId))

    if (tasks.length === 0) {
      return yield* Effect.fail(
        new NotFoundError({
          message: 'Task not found',
          entity: 'task',
          id: taskId
        })
      )
    }

    const task = tasks[0]

    // Verify user owns the parent project
    const projects = yield* db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, task.projectId))

    if (projects.length === 0) {
      return yield* Effect.fail(
        new NotFoundError({
          message: 'Project not found',
          entity: 'project',
          id: task.projectId
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

    // Fetch all comments for the task, ordered by createdAt ascending
    const comments = yield* db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.taskId, taskId))
      .orderBy(asc(schema.comments.createdAt))

    return comments
  }).pipe(Effect.withSpan('Comment.getComments'))
