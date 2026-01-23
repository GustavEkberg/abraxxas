import { Effect, Option } from 'effect'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { NextEffect } from '@/lib/next-effect'
import { AppLayer } from '@/lib/layers'
import { Db } from '@/lib/services/db/live-layer'
import { getSession } from '@/lib/services/auth/get-session'
import { getLatestSession } from '@/lib/core/session/get-latest-session'
import * as schema from '@/lib/services/db/schema'
import { InvocationClient } from './invocation-client'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function InvocationPage({ params }: PageProps) {
  const { id: taskId } = await params

  const result = await NextEffect.runPromise(
    Effect.gen(function* () {
      yield* getSession()
      const db = yield* Db

      // Fetch the task
      const tasks = yield* db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, taskId))
        .limit(1)

      if (tasks.length === 0) {
        return { _tag: 'NotFound' as const }
      }

      const task = tasks[0]

      // Fetch the project for context
      const projects = yield* db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, task.projectId))
        .limit(1)

      const project = projects[0]

      // Fetch the latest session for this task
      const sessionResult = yield* Effect.option(getLatestSession(taskId))

      const session = Option.getOrNull(sessionResult)

      return {
        _tag: 'Success' as const,
        data: {
          task,
          project,
          session
        }
      }
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.catchAll(error => {
        if ('_tag' in error && error._tag === 'UnauthenticatedError') {
          return NextEffect.redirect('/login')
        }
        return Effect.succeed({ _tag: 'Error' as const, message: String(error) })
      })
    )
  )

  if (result._tag === 'NotFound') {
    notFound()
  }

  if (result._tag === 'Error') {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-red-400">Error: {result.message}</p>
      </div>
    )
  }

  const { task, project, session } = result.data

  return <InvocationClient task={task} project={project} session={session} />
}
