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
import { Button } from '@/components/ui/button'
import {
  Check,
  ExternalLink,
  GitCompareArrows,
  Lock,
  ScrollText,
  Terminal,
  Trash2
} from 'lucide-react'
import { TaskDetailModal } from '@/components/invocations/task-detail-modal'
import { ManifestCard } from '@/components/manifest/manifest-card'
import { SummonMenu } from '@/components/summon-menu'
import { useFireIntensity } from '@/lib/contexts/fire-intensity-context'
import { useAlert } from '@/components/ui/gnostic-alert'
import { updateTaskAction } from '@/lib/core/task/update-task-action'
import { executeTaskAction } from '@/lib/core/task/execute-task-action'
import { deleteTaskAction } from '@/lib/core/task/delete-task-action'
import {
  getTaskDetailsAction,
  type TaskDetailsResult
} from '@/lib/core/task/get-task-details-action'
import { tailLogAction } from '@/lib/core/sprite/tail-log-action'
import type { Task, Project, Manifest } from '@/lib/services/db/schema'

function CopyButton({
  value,
  label,
  icon
}: {
  value: string
  label: string
  icon: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-7 px-2 text-white/40 hover:text-white/90"
      title={label}
    >
      {copied ? <Check className="size-3.5" /> : icon}
    </Button>
  )
}

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
    description: 'Rituals interrupted',
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

// Spark effect for running invocations
interface Spark {
  id: number
  x: number // percentage position in element
  y: number // percentage position in element
  angle: number
  distance: number
  duration: number
  delay: number
  size: number
}

function createInvocationSpark(id: number): Spark {
  return {
    id,
    x: Math.random() * 100,
    y: Math.random() * 100,
    angle: Math.random() * 360,
    distance: 20 + Math.random() * 40,
    duration: 0.6 + Math.random() * 0.4,
    delay: Math.random() * 0.15,
    size: 1.5 + Math.random() * 2
  }
}

function InvocationSparkParticle({ x, y, angle, distance, duration, delay, size }: Spark) {
  const rad = (angle * Math.PI) / 180
  const tx = Math.cos(rad) * distance
  const ty = Math.sin(rad) * distance
  const keyframeName = `inv-spark-${Math.round(angle)}-${Math.round(distance)}-${Math.round(x)}`

  return (
    <span
      className="pointer-events-none absolute rounded-full bg-red-400"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        left: `${x}%`,
        top: `${y}%`,
        animation: `${keyframeName} ${duration}s ease-out ${delay}s forwards`
      }}
    >
      <style>{`
        @keyframes ${keyframeName} {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 0.9; }
          100% { transform: translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(0.3); opacity: 0; }
        }
      `}</style>
    </span>
  )
}

function InvocationSparkBurst() {
  const [sparks, setSparks] = useState<Spark[]>([])

  useEffect(() => {
    let idCounter = 0
    const interval = setInterval(() => {
      const count = 2 + Math.floor(Math.random() * 3)
      const newSparks = Array.from({ length: count }, () => createInvocationSpark(idCounter++))
      setSparks(prev => [...prev.slice(-20), ...newSparks])
    }, 400)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible">
      {sparks.map(s => (
        <InvocationSparkParticle key={s.id} {...s} />
      ))}
    </div>
  )
}

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

function calcManifestProgress(prdJson: string | null): number {
  if (!prdJson) return 0
  try {
    const prd: unknown = JSON.parse(prdJson)
    if (typeof prd !== 'object' || prd === null) return 0
    const tasks = 'tasks' in prd && Array.isArray(prd.tasks) ? prd.tasks : []
    return tasks.filter(
      (t): t is { passes: true } =>
        typeof t === 'object' && t !== null && 'passes' in t && t.passes === true
    ).length
  } catch {
    return 0
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
      className={`flex min-w-0 flex-col border border-dashed bg-zinc-950/50 p-2 transition-colors font-mono md:min-w-[200px] md:p-3 ${
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
  sessionId: string
  messageCount: number
  inputTokens: number
  outputTokens: number
  spriteName: string | null
  spriteUrl: string | null
  spritePassword: string | null
  branchName: string | null
}

interface DraggableCardProps {
  task: Task
  onClick: (task: Task) => void
  stats?: TaskStats
  onDeleteTask?: (taskId: string) => void
  repositoryUrl?: string
  onTailLog?: (spriteName: string) => void
}

function buildCompareUrl(repositoryUrl: string, branchName: string): string {
  // repositoryUrl is https://github.com/owner/repo or https://github.com/owner/repo.git
  const cleanUrl = repositoryUrl.replace(/\.git$/, '')
  return `${cleanUrl}/compare/main...${encodeURIComponent(branchName)}`
}

function DraggableCard({
  task,
  onClick,
  stats,
  onDeleteTask,
  repositoryUrl,
  onTailLog
}: DraggableCardProps) {
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
      style={
        isExecuting ? { ...style, animation: 'invocation-shake 0.15s ease-in-out infinite' } : style
      }
      {...attributes}
      {...listeners}
      onClick={() => onClick(task)}
      className={`relative cursor-grab p-2 transition-all duration-200 hover:border-white/30 hover:bg-zinc-800 font-mono md:p-3 ${borderColor} ${bgColor} ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      {isExecuting && (
        <>
          <style>{`
            @keyframes invocation-shake {
              0%, 100% { transform: translateX(0) rotate(0deg); }
              25% { transform: translateX(-1px) rotate(-0.5deg); }
              75% { transform: translateX(1px) rotate(0.5deg); }
            }
          `}</style>
          <InvocationSparkBurst />
        </>
      )}
      <div className="mb-1 flex items-center justify-between gap-2 md:mb-1.5">
        <h3 className="min-w-0 truncate text-xs font-medium text-white/90 md:text-sm">
          {task.title}
        </h3>
        {isExecuting && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <div className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
            <span className="hidden text-xs text-red-400 md:inline">Executing</span>
          </div>
        )}
        {isError && <span className="flex-shrink-0 text-xs text-red-400">Error</span>}
        {isCompleted && <span className="flex-shrink-0 text-xs text-green-400">✓</span>}
      </div>
      <p className="line-clamp-2 text-xs text-white/60 md:text-sm">{task.description}</p>

      {/* Sprite action buttons */}
      {stats?.spriteName && (
        <div className="mt-2 flex items-center gap-1">
          <CopyButton
            value={stats.spriteName}
            label="Copy sprite name"
            icon={<Terminal className="size-3.5" />}
          />
          {stats.spriteUrl && (
            <>
              {stats.spritePassword && (
                <CopyButton
                  value={stats.spritePassword}
                  label="Copy password"
                  icon={<Lock className="size-3.5" />}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                render={<a href={stats.spriteUrl} target="_blank" rel="noopener noreferrer" />}
                onClick={e => e.stopPropagation()}
                className="h-7 px-2 text-white/40 hover:text-white/90"
                title="Open in new tab"
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </>
          )}
          {onTailLog && stats.spriteName && (
            <Button
              variant="ghost"
              size="sm"
              onClick={e => {
                e.stopPropagation()
                if (stats.spriteName) onTailLog(stats.spriteName)
              }}
              className="h-7 px-2 text-white/40 hover:text-white/90"
              title="View sprite log"
            >
              <ScrollText className="size-3.5" />
            </Button>
          )}
          {onDeleteTask && (
            <Button
              variant="ghost"
              size="sm"
              onClick={e => {
                e.stopPropagation()
                onDeleteTask(task.id)
              }}
              className="h-7 px-2 text-white/40 hover:text-red-400"
              title="Banish invocation"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          {/* Branch compare link */}
          {stats.branchName && repositoryUrl && (
            <Button
              variant="ghost"
              size="sm"
              render={
                <a
                  href={buildCompareUrl(repositoryUrl, stats.branchName)}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
              onClick={e => e.stopPropagation()}
              className="h-7 px-2 text-green-400 hover:text-green-300"
              title={`Compare ${stats.branchName} to main`}
            >
              <GitCompareArrows className="size-3.5" />
            </Button>
          )}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-white/40 md:mt-2 md:gap-2">
        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-400">{task.type}</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5">{task.model}</span>
        {stats && (stats.messageCount > 0 || stats.inputTokens + stats.outputTokens > 0) && (
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-white/40">
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
  const { alert, confirm } = useAlert()
  const {
    addRunningTask,
    removeRunningTask,
    updateTaskMessages,
    addRunningManifest,
    updateManifestProgress,
    removeRunningManifest
  } = useFireIntensity()
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [persistedRunningTasks, setPersistedRunningTasks] = useState<string[]>(() =>
    getPersistedRunningTasks(project.id)
  )
  const [taskStats, setTaskStats] = useState<Record<string, TaskStats>>(initialStats)
  const [manifests, setManifests] = useState<Manifest[]>(initialManifests)

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

  // Sync running manifests with fire intensity context (only 'running' status)
  useEffect(() => {
    const runningManifestList = manifests.filter(m => m.status === 'running')

    // Add/update running manifests with their completed task count
    runningManifestList.forEach(m => {
      const completedTasks = calcManifestProgress(m.prdJson)
      addRunningManifest(m.id, completedTasks)
      updateManifestProgress(m.id, completedTasks)
    })

    // Remove non-running manifests
    manifests.filter(m => m.status !== 'running').forEach(m => removeRunningManifest(m.id))
  }, [manifests, addRunningManifest, updateManifestProgress, removeRunningManifest])

  // Poll for running task/manifest status updates
  useEffect(() => {
    const currentRunningTasks = tasks.filter(task => task.executionState === 'in_progress')
    const allRunningTaskIds = new Set([
      ...currentRunningTasks.map(t => t.id),
      ...persistedRunningTasks
    ])
    const hasRunningManifests = manifests.some(
      m => m.status === 'pending' || m.status === 'active' || m.status === 'running'
    )

    // Poll if any tasks running OR any manifests in progress states
    if (allRunningTaskIds.size === 0 && !hasRunningManifests) return

    // Faster polling for manifests (3s) vs tasks (10s)
    const pollMs = hasRunningManifests ? 3000 : 10000

    const pollInterval = setInterval(() => {
      router.refresh()
    }, pollMs)

    return () => clearInterval(pollInterval)
  }, [tasks, persistedRunningTasks, manifests, router])

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
      setTaskDetails(null)
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

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      const confirmed = await confirm({
        title: 'Banish this Invocation?',
        message:
          'This will destroy the sprite and delete the invocation permanently. This cannot be undone.',
        variant: 'warning',
        confirmText: 'Banish',
        cancelText: 'Spare'
      })
      if (!confirmed) return

      const result = await deleteTaskAction(taskId)
      if (result._tag === 'Success') {
        router.refresh()
      } else {
        console.error('Failed to delete task:', result.message)
      }
    },
    [confirm, router]
  )

  const handleTailLog = useCallback(
    async (spriteName: string) => {
      const result = await tailLogAction(spriteName)
      if (result._tag === 'Success') {
        await alert({
          title: 'Sprite Log',
          message: result.output || '(empty)',
          variant: 'info',
          confirmText: 'Close'
        })
      } else {
        await alert({
          title: 'Log Unavailable',
          message: result.message,
          variant: 'error',
          confirmText: 'Dismiss'
        })
      }
    },
    [alert]
  )

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
      <div className="mx-auto min-h-screen max-w-[1600px] p-3 md:p-6">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3 md:mb-6">
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-mono text-xl font-bold text-white/90 md:text-3xl">
              {project.name}
            </h1>
            {project.description && (
              <p className="mt-1 line-clamp-2 text-sm text-white/60 md:mt-2 md:text-base">
                {project.description}
              </p>
            )}
            <p className="mt-1 truncate font-mono text-xs text-white/40 md:text-sm">
              {project.repositoryUrl.replace('https://github.com/', '')}
            </p>
          </div>
          <SummonMenu ritualId={project.id} localSetupEnabled={project.localSetupScript !== null} />
        </div>

        {/* Manifest Section */}
        <div className="mb-6 space-y-3 md:mb-10 md:space-y-4">
          <h2 className="font-mono text-base font-semibold text-white/90 md:text-lg">Manifests</h2>
          <div className="space-y-3">
            {manifests.map(manifest => (
              <ManifestCard
                key={manifest.id}
                manifest={manifest}
                repositoryUrl={project.repositoryUrl}
              />
            ))}
          </div>
        </div>

        {/* Invocations Section */}
        <div className="mb-4 md:mb-6">
          <h2 className="font-mono text-base font-semibold text-white/90 md:text-lg">
            Invocations
          </h2>
        </div>
        <div className="flex flex-col gap-2 md:grid md:gap-3 md:[grid-template-columns:repeat(5,1fr)] md:[grid-template-rows:1fr_1fr]">
          {COLUMNS.map(column => {
            const columnTasks = getTasksByStatus(column.id)

            // Desktop grid positioning
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
                <div className="mb-2 md:mb-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white/90 md:text-base">
                      {column.title}
                    </h2>
                    <span className="border border-dashed border-white/20 bg-white/5 px-1.5 py-0.5 text-xs text-white/60 font-mono">
                      {columnTasks.length}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-white/40">{column.description}</p>
                </div>

                {/* Tasks */}
                <div className="flex-1 space-y-1.5 md:space-y-2">
                  {columnTasks.length === 0 ? (
                    <div className="border border-dashed border-white/20 p-4 text-center text-xs text-white/30 font-mono md:p-8 md:text-sm">
                      Empty
                    </div>
                  ) : (
                    columnTasks.map(task => (
                      <DraggableCard
                        key={task.id}
                        task={task}
                        onClick={handleTaskClick}
                        stats={taskStats[task.id]}
                        onDeleteTask={taskStats[task.id]?.spriteName ? handleDeleteTask : undefined}
                        onTailLog={taskStats[task.id]?.spriteName ? handleTailLog : undefined}
                        repositoryUrl={project.repositoryUrl}
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
          ritualId={project.id}
          repositoryUrl={project.repositoryUrl}
          errorMessage={taskDetails?.errorMessage}
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
