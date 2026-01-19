import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { Effect } from 'effect'
import { getProject } from '@/lib/core/project/get-project'
import { getTasks } from '@/lib/core/task/get-tasks'
import { getTaskSessions } from '@/lib/core/session/get-task-sessions'
import { AppLayer } from '@/lib/layers'
import { redirect } from 'next/navigation'
import { RitualBoardClient } from './board-client'

export const dynamic = 'force-dynamic'

interface RitualBoardContentProps {
  ritualId: string
}

async function RitualBoardContent({ ritualId }: RitualBoardContentProps) {
  await cookies()

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const project = yield* getProject(ritualId)
      const tasks = yield* getTasks(ritualId)
      const taskIds = tasks.map(t => t.id)
      const sessions = yield* getTaskSessions(taskIds)

      // Build message count map from latest session per task
      const sessionsByTask = new Map<string, number>()
      sessions.forEach(session => {
        if (!sessionsByTask.has(session.taskId) && session.messageCount) {
          const count = parseInt(session.messageCount, 10)
          if (!isNaN(count)) {
            sessionsByTask.set(session.taskId, count)
          }
        }
      })

      return { project, tasks, messageCountsByTask: Object.fromEntries(sessionsByTask) }
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Effect.sync(() => {
            if (error._tag === 'UnauthenticatedError') {
              redirect('/login')
            }
            if (error._tag === 'NotFoundError') {
              redirect('/')
            }
            if (error._tag === 'UnauthorizedError') {
              redirect('/')
            }
            throw new Error('message' in error ? error.message : 'Unknown error')
          }),
        onSuccess: data => Effect.succeed(data)
      })
    )
  )

  return (
    <RitualBoardClient
      project={result.project}
      initialTasks={result.tasks}
      initialMessageCounts={result.messageCountsByTask}
    />
  )
}

export default async function RitualBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-white/40">Channeling the ritual...</div>
        </div>
      }
    >
      <RitualBoardContent ritualId={id} />
    </Suspense>
  )
}
