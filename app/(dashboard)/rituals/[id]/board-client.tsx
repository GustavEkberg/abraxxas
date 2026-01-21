'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Card } from '@/components/ui/card'
import { CreateInvocationDialog } from '@/components/invocations/create-invocation-dialog'
import { TaskDetailModal } from '@/components/invocations/task-detail-modal'
import { ManifestCard } from '@/components/manifest/manifest-card'
import { CreateManifestDialog } from '@/components/manifest/create-manifest-dialog'
import { useFireIntensity } from '@/lib/contexts/fire-intensity-context'
import { updateTaskAction } from '@/lib/core/task/update-task-action'
import { executeTaskAction } from '@/lib/core/task/execute-task-action'
import {
  getTaskDetailsAction,
  type TaskDetailsResult
} from '@/lib/core/task/get-task-details-action'
import type { Task, Project, Manifest } from '@/lib/services/db/schema'

const COLUMNS = [
  {
    id: 'abyss',
    title: 'The Abyss',
    description: 'Invocations waiting in darkness',
    color: 'border-white/10'
  },
  {
    id: 'altar',
    title: 'The Altar',
    description: 'Prepared for demonic rituals',
    color: 'border-red-500/20'
  },
  {
    id: 'ritual',
    title: 'The Ritual',
    description: 'Active invocations',
    color: 'border-red-500/20'
  },
  {
    id: 'cursed',
    title: 'The Cursed',
    description: 'Blocked with errors',
    color: 'border-red-500/20'
  },
  {
    id: 'trial',
    title: 'The Trial',
    description: 'Awaiting Judgement',
    color: 'border-yellow-500/20'
  },
  {
    id: 'vanquished',
    title: 'The Vanquished',
    description: 'Returned to the Void',
    color: 'border-green-500/20'
  }
] as const

const RUNNING_TASKS_STORAGE_KEY = 'abraxas_running_tasks'

function getPersistedRunningTasks(ritualId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(`${RUNNING_TASKS_STORAGE_KEY}_${ritualId}`)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function persistRunningTasks(ritualId: string, taskIds: string[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`${RUNNING_TASKS_STORAGE_KEY}_${ritualId}`, JSON.stringify(taskIds))
  } catch (error) {
    console.warn('Failed to persist running tasks:', error)
  }
}

interface DroppableColumnProps {
  id: string
  color: string
  children: React.ReactNode
  style?: React.CSSProperties
}

function DroppableColumn({ id, color, children, style }: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[280px] flex-col border border-dashed bg-zinc-950/50 p-4 transition-colors font-mono ${
        isOver ? 'border-red-500/40 bg-zinc-900/50' : ''
      }`}
      style={{
        borderColor: isOver ? undefined : color.replace('border-', '').replace('/', ' / '),
        ...style
      }}
    >
      {children}
    </div>
  )
}

interface TaskStats {
  messageCount: number
  inputTokens: number
  outputTokens: number
}

interface DraggableCardProps {
  task: Task
  onClick: (task: Task) => void
  stats?: TaskStats
}

function DraggableCard({ task, onClick, stats }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id
  })

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`
      }
    : undefined

  const isExecuting = task.executionState === 'in_progress'
  const isError = task.executionState === 'error'
  const isCompleted = task.executionState === 'completed'

  const borderColor = isExecuting
    ? 'border-red-500/40 border-dashed'
    : isError
      ? 'border-red-500/40 border-dashed'
      : isCompleted
        ? 'border-green-500/40 border-dashed'
        : 'border-white/20 border-dashed'

  const bgColor = isExecuting ? 'bg-red-950/20' : isError ? 'bg-red-950/20' : 'bg-zinc-900'

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(task)}
      className={`cursor-grab p-4 transition-all duration-200 hover:border-white/30 hover:bg-zinc-800 font-mono ${borderColor} ${bgColor} ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-white/90">{task.title}</h3>
        {isExecuting && (
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
            <span className="text-xs text-red-400">Executing</span>
          </div>
        )}
        {isError && <span className="text-xs text-red-400">Error</span>}
        {isCompleted && <span className="text-xs text-green-400">✓</span>}
      </div>
      <p className="line-clamp-2 text-sm text-white/60">{task.description}</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-white/40">
        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-400">{task.type}</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5">{task.model}</span>
        {stats && (stats.messageCount > 0 || stats.inputTokens + stats.outputTokens > 0) && (
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-400">
            {stats.messageCount}m · {Math.round((stats.inputTokens + stats.outputTokens) / 1000)}k
          </span>
        )}
      </div>
    </Card>
  )
}

interface RitualBoardClientProps {
  project: Project
  initialTasks: Task[]
  initialStats: Record<string, TaskStats>
  initialManifests: Manifest[]
}

export function RitualBoardClient({
  project,
  initialTasks,
  initialStats,
  initialManifests
}: RitualBoardClientProps) {
  const router = useRouter()
  const { addRunningTask, removeRunningTask, updateTaskMessages } = useFireIntensity()
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [persistedRunningTasks, setPersistedRunningTasks] = useState<string[]>(() =>
    getPersistedRunningTasks(project.id)
  )
  const [taskStats, setTaskStats] = useState<Record<string, TaskStats>>(initialStats)
  const [manifests, setManifests] = useState<Manifest[]>(initialManifests)
  const [showManifestHistory, setShowManifestHistory] = useState(true)

  // Derive active and historical manifests
  const activeManifest = manifests.find(m => ['pending', 'active', 'running'].includes(m.status))
  const historicalManifests = manifests.filter(m => ['completed', 'error'].includes(m.status))

  // Task detail modal state - store ID only to avoid stale data issues
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [showTaskDetail, setShowTaskDetail] = useState(false)
  const [taskDetails, setTaskDetails] = useState<TaskDetailsResult | null>(null)

  // Derive selectedTask from tasks array to always have fresh data
  const selectedTask = selectedTaskId ? (tasks.find(t => t.id === selectedTaskId) ?? null) : null

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    })
  )

  // Sync running tasks with fire intensity context
  useEffect(() => {
    const runningTasks = tasks.filter(task => task.executionState === 'in_progress')

    // Add any new running tasks to fire intensity with message count
    runningTasks.forEach(task => {
      const messageCount = taskStats[task.id]?.messageCount ?? 0
      addRunningTask(task.id, messageCount)
    })

    // Update message counts for existing running tasks
    runningTasks.forEach(task => {
      const stats = taskStats[task.id]
      if (stats) {
        updateTaskMessages(task.id, stats.messageCount)
      }
    })

    // Remove completed tasks from fire intensity and localStorage
    tasks
      .filter(task => task.executionState !== 'in_progress')
      .forEach(task => {
        removeRunningTask(task.id)
        setPersistedRunningTasks(prev => {
          const updated = prev.filter(id => id !== task.id)
          persistRunningTasks(project.id, updated)
          return updated
        })
      })
  }, [tasks, taskStats, project.id, addRunningTask, removeRunningTask, updateTaskMessages])

  // Poll for running task status updates
  useEffect(() => {
    const currentRunningTasks = tasks.filter(task => task.executionState === 'in_progress')
    const allRunningTaskIds = new Set([
      ...currentRunningTasks.map(t => t.id),
      ...persistedRunningTasks
    ])

    if (allRunningTaskIds.size === 0) return

    const pollInterval = setInterval(async () => {
      // Refresh page to get updated task data
      router.refresh()
    }, 10000)

    return () => clearInterval(pollInterval)
  }, [tasks, persistedRunningTasks, router])

  // Sync tasks, stats, and manifests when server data changes (from router.refresh)
  // This is acceptable because we're syncing with external system (server state)
  if (tasks !== initialTasks) {
    setTasks(initialTasks)
  }
  if (taskStats !== initialStats) {
    setTaskStats(initialStats)
  }
  if (manifests !== initialManifests) {
    setManifests(initialManifests)
  }

  // Fetch task details when modal opens
  const fetchTaskDetails = useCallback(async (taskId: string) => {
    const result = await getTaskDetailsAction(taskId)
    if (result._tag === 'Success') {
      setTaskDetails(result.data)
    } else {
      console.error('Failed to fetch task details:', result.message)
      setTaskDetails({ comments: [], session: null })
    }
  }, [])

  const getTasksByStatus = (status: string) => {
    return tasks.filter(task => task.status === status)
  }

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id)
    setActiveTask(task || null)
  }

  const handleTaskClick = (task: Task) => {
    setSelectedTaskId(task.id)
    setShowTaskDetail(true)
    fetchTaskDetails(task.id)
  }

  const handleTaskUpdate = useCallback(() => {
    router.refresh()
    if (selectedTask) {
      fetchTaskDetails(selectedTask.id)
    }
  }, [router, selectedTask, fetchTaskDetails])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)

    if (!over) return

    type TaskStatus = 'abyss' | 'altar' | 'ritual' | 'cursed' | 'trial' | 'vanquished'
    type ExecutionState = 'idle' | 'in_progress' | 'awaiting_review' | 'completed' | 'error'

    const taskId = typeof active.id === 'string' ? active.id : String(active.id)
    const newStatus = typeof over.id === 'string' ? over.id : String(over.id)

    const isTaskStatus = (value: string): value is TaskStatus =>
      ['abyss', 'altar', 'ritual', 'cursed', 'trial', 'vanquished'].includes(value)

    if (!isTaskStatus(newStatus)) return

    const task = tasks.find(t => t.id === taskId)
    if (!task || task.status === newStatus) return

    const originalStatus = task.status

    // Optimistically update UI immediately - drag lands instantly
    setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, status: newStatus } : t)))

    // Fire server action async - don't await
    updateTaskAction({ taskId, status: newStatus }).then(result => {
      if (result._tag === 'Error') {
        // Revert on error
        setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, status: originalStatus } : t)))
        console.error('Failed to update task status:', result.message)
      }
    })

    // If moved to "ritual" column, trigger execution async
    if (newStatus === 'ritual') {
      const inProgressState: ExecutionState = 'in_progress'

      // Optimistically set in_progress immediately
      setTasks(prev =>
        prev.map(t => (t.id === taskId ? { ...t, executionState: inProgressState } : t))
      )
      addRunningTask(taskId)

      // Persist running task to localStorage immediately
      setPersistedRunningTasks(prev => {
        const updated = [...prev, taskId]
        persistRunningTasks(project.id, updated)
        return updated
      })

      // Fire execution async - move to cursed on failure
      executeTaskAction({ taskId }).then(executeResult => {
        if (executeResult._tag === 'Success') {
          // Refresh to get updated comments
          router.refresh()
        } else {
          console.error('Failed to execute task:', executeResult.message)
          const cursedStatus: TaskStatus = 'cursed'
          const errorState: ExecutionState = 'error'
          // Move to cursed on execution error
          setTasks(prev =>
            prev.map(t =>
              t.id === taskId ? { ...t, status: cursedStatus, executionState: errorState } : t
            )
          )

          // Also update server with cursed status
          updateTaskAction({ taskId, status: cursedStatus, executionState: errorState })
        }
      })
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="min-h-screen p-6">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/')}
            className="mb-4 text-sm text-white/60 transition-colors hover:text-white/90 font-mono"
          >
            ← Return to Chamber
          </button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white/90">{project.name}</h1>
              {project.description && <p className="mt-2 text-white/60">{project.description}</p>}
              <p className="mt-1 text-sm text-white/40">
                {project.repositoryUrl.replace('https://github.com/', '')}
              </p>
            </div>
            <CreateInvocationDialog ritualId={project.id} />
          </div>
        </div>

        {/* Manifest Section */}
        <div className="mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-lg font-semibold text-white/90">Manifests</h2>
            {!activeManifest && <CreateManifestDialog projectId={project.id} />}
          </div>

          {activeManifest ? (
            <ManifestCard manifest={activeManifest} />
          ) : (
            <div className="border border-dashed border-white/10 bg-zinc-950/50 p-6 text-center font-mono text-sm text-white/40">
              No active manifest. Create one to spawn an autonomous agent.
            </div>
          )}

          {historicalManifests.length > 0 && (
            <div>
              <button
                onClick={() => setShowManifestHistory(prev => !prev)}
                className="font-mono text-sm text-white/60 transition-colors hover:text-white/90"
              >
                {showManifestHistory ? '▼' : '▶'} History ({historicalManifests.length})
              </button>
              {showManifestHistory && (
                <div className="mt-3 space-y-3">
                  {historicalManifests.map(manifest => (
                    <ManifestCard key={manifest.id} manifest={manifest} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Board Columns */}
        <div
          className="grid gap-4 overflow-x-auto"
          style={{
            gridTemplateColumns: 'repeat(5, 1fr)',
            gridTemplateRows: '1fr 1fr'
          }}
        >
          {COLUMNS.map(column => {
            const columnTasks = getTasksByStatus(column.id)

            const gridStyles: Record<
              string,
              { gridColumn: number | string; gridRow: number | string }
            > = {
              abyss: { gridColumn: 1, gridRow: '1 / 3' },
              altar: { gridColumn: 2, gridRow: '1 / 3' },
              ritual: { gridColumn: 3, gridRow: '1 / 3' },
              trial: { gridColumn: 4, gridRow: 1 },
              cursed: { gridColumn: 4, gridRow: 2 },
              vanquished: { gridColumn: 5, gridRow: '1 / 3' }
            }

            return (
              <DroppableColumn
                key={column.id}
                id={column.id}
                color={column.color}
                style={gridStyles[column.id]}
              >
                {/* Column Header */}
                <div className="mb-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white/90">{column.title}</h2>
                    <span className="border border-dashed border-white/20 bg-white/5 px-2 py-1 text-xs text-white/60 font-mono">
                      {columnTasks.length}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-white/40">{column.description}</p>
                </div>

                {/* Tasks */}
                <div className="flex-1 space-y-3">
                  {columnTasks.length === 0 ? (
                    <div className="border border-dashed border-white/20 p-8 text-center text-sm text-white/30 font-mono">
                      Empty
                    </div>
                  ) : (
                    columnTasks.map(task => (
                      <DraggableCard
                        key={task.id}
                        task={task}
                        onClick={handleTaskClick}
                        stats={taskStats[task.id]}
                      />
                    ))
                  )}
                </div>
              </DroppableColumn>
            )
          })}
        </div>

        {/* Task Detail Modal */}
        <TaskDetailModal
          task={selectedTask}
          comments={taskDetails?.comments ?? []}
          ritualId={project.id}
          repositoryUrl={project.repositoryUrl}
          session={taskDetails?.session}
          open={showTaskDetail}
          onOpenChange={setShowTaskDetail}
          onUpdate={handleTaskUpdate}
        />
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeTask ? (
          <Card className="cursor-grabbing border-white/20 bg-zinc-900 p-4 opacity-80">
            <h3 className="mb-2 font-medium text-white/90">{activeTask.title}</h3>
            <p className="line-clamp-2 text-sm text-white/60">{activeTask.description}</p>
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
