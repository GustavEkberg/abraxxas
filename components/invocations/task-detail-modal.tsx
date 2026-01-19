'use client'

import { useCallback, useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Comment } from './comment'
import { AddCommentForm } from './add-comment-form'
import { updateTaskAction } from '@/lib/core/task/update-task-action'
import { deleteTaskAction } from '@/lib/core/task/delete-task-action'
import { createCommentAction } from '@/lib/core/comment/create-comment-action'

type TaskType = 'bug' | 'feature' | 'plan' | 'other'
type TaskModel = 'grok-1' | 'claude-opus-4-5' | 'claude-sonnet-4-5' | 'claude-haiku-4-5'
type TaskExecutionState = 'idle' | 'in_progress' | 'awaiting_review' | 'completed' | 'error'

function isTaskType(value: string): value is TaskType {
  return value === 'bug' || value === 'feature' || value === 'plan' || value === 'other'
}

function isTaskModel(value: string): value is TaskModel {
  return (
    value === 'grok-1' ||
    value === 'claude-opus-4-5' ||
    value === 'claude-sonnet-4-5' ||
    value === 'claude-haiku-4-5'
  )
}

function isTaskExecutionState(value: string): value is TaskExecutionState {
  return (
    value === 'idle' ||
    value === 'in_progress' ||
    value === 'awaiting_review' ||
    value === 'completed' ||
    value === 'error'
  )
}

interface TaskWithSession {
  id: string
  title: string
  description: string | null
  type: string
  status: string
  executionState: string
  model: string
  branchName: string | null
  createdAt: Date
}

interface CommentData {
  id: string
  content: string
  isAgentComment: boolean
  agentName: string | null
  userId: string | null
  createdAt: Date
}

interface TaskDetailModalProps {
  task: TaskWithSession | null
  comments: CommentData[]
  ritualId: string
  repositoryUrl?: string
  session?: {
    messageCount: string | null
    inputTokens: string | null
    outputTokens: string | null
  } | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate?: () => void
}

/**
 * Task detail modal showing full task info and comments.
 * Uses server actions for all mutations.
 */
export function TaskDetailModal({
  task,
  comments: initialComments,
  ritualId: _ritualId,
  repositoryUrl,
  session,
  open,
  onOpenChange,
  onUpdate
}: TaskDetailModalProps) {
  const [comments, setComments] = useState<CommentData[]>(initialComments)
  const [selectedType, setSelectedType] = useState<string>('')
  const [updatingType, setUpdatingType] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [updatingModel, setUpdatingModel] = useState(false)
  const [selectedExecutionState, setSelectedExecutionState] = useState<string>('')
  const [updatingExecutionState, setUpdatingExecutionState] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const AVAILABLE_TYPES: TaskType[] = ['bug', 'feature', 'plan', 'other']

  const AVAILABLE_MODELS: TaskModel[] = [
    'grok-1',
    'claude-sonnet-4-5',
    'claude-opus-4-5',
    'claude-haiku-4-5'
  ]

  const AVAILABLE_EXECUTION_STATES: TaskExecutionState[] = [
    'idle',
    'in_progress',
    'awaiting_review',
    'completed',
    'error'
  ]

  // Sync state when task changes
  useEffect(() => {
    if (task && open) {
      setSelectedType(task.type)
      setSelectedModel(task.model)
      setSelectedExecutionState(task.executionState)
      setComments(initialComments)
      setError(null)
    }
  }, [task, open, initialComments])

  const handleAddComment = useCallback(
    async (content: string) => {
      if (!task) return

      const result = await createCommentAction({
        taskId: task.id,
        content
      })

      if (result._tag === 'Error') {
        setError(result.message)
        throw new Error(result.message)
      }

      // Add comment to local state optimistically
      setComments(prev => [
        ...prev,
        {
          id: result.data.id,
          content: result.data.content,
          isAgentComment: result.data.isAgentComment,
          agentName: result.data.agentName,
          userId: result.data.userId,
          createdAt: result.data.createdAt
        }
      ])

      onUpdate?.()
    },
    [task, onUpdate]
  )

  const handleTypeChange = useCallback(
    async (value: string | null) => {
      if (!task || !value || !isTaskType(value)) return

      setSelectedType(value)
      setUpdatingType(true)
      setError(null)

      try {
        const result = await updateTaskAction({
          taskId: task.id,
          type: value
        })

        if (result._tag === 'Error') {
          setError(result.message)
          setSelectedType(task.type)
          return
        }

        onUpdate?.()
      } catch (err) {
        console.error('Failed to update type:', err)
        setSelectedType(task.type)
        setError('Failed to update task type')
      } finally {
        setUpdatingType(false)
      }
    },
    [task, onUpdate]
  )

  const handleModelChange = useCallback(
    async (value: string | null) => {
      if (!task || !value || !isTaskModel(value)) return

      setSelectedModel(value)
      setUpdatingModel(true)
      setError(null)

      try {
        const result = await updateTaskAction({
          taskId: task.id,
          model: value
        })

        if (result._tag === 'Error') {
          setError(result.message)
          setSelectedModel(task.model)
          return
        }

        onUpdate?.()
      } catch (err) {
        console.error('Failed to update model:', err)
        setSelectedModel(task.model)
        setError('Failed to update task model')
      } finally {
        setUpdatingModel(false)
      }
    },
    [task, onUpdate]
  )

  const handleExecutionStateChange = useCallback(
    async (value: string | null) => {
      if (!task || !value || !isTaskExecutionState(value)) return

      setSelectedExecutionState(value)
      setUpdatingExecutionState(true)
      setError(null)

      try {
        const result = await updateTaskAction({
          taskId: task.id,
          executionState: value
        })

        if (result._tag === 'Error') {
          setError(result.message)
          setSelectedExecutionState(task.executionState)
          return
        }

        onUpdate?.()
      } catch (err) {
        console.error('Failed to update execution state:', err)
        setSelectedExecutionState(task.executionState)
        setError('Failed to update execution state')
      } finally {
        setUpdatingExecutionState(false)
      }
    },
    [task, onUpdate]
  )

  const handleDelete = useCallback(async () => {
    if (!task) return

    setIsDeleting(true)
    setError(null)

    try {
      const result = await deleteTaskAction(task.id)

      if (result._tag === 'Error') {
        setError(result.message)
        return
      }

      setDeleteConfirmOpen(false)
      onOpenChange(false)
      onUpdate?.()
    } catch (err) {
      console.error('Failed to delete task:', err)
      setError('Failed to delete task')
    } finally {
      setIsDeleting(false)
    }
  }, [task, onOpenChange, onUpdate])

  if (!task) return null

  const messageCount = session?.messageCount ? parseInt(session.messageCount, 10) : 0
  const inputTokens = session?.inputTokens ? parseInt(session.inputTokens, 10) : 0
  const outputTokens = session?.outputTokens ? parseInt(session.outputTokens, 10) : 0

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl lg:max-w-6xl max-h-[80vh] overflow-y-auto border-white/10 bg-zinc-950 text-white">
          <DialogHeader className="flex flex-row items-center justify-between">
            <DialogTitle className="text-2xl font-bold text-white/90">{task.title}</DialogTitle>
            <Button
              onClick={() => setDeleteConfirmOpen(true)}
              variant="destructive"
              size="sm"
              disabled={isDeleting}
              className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/20"
            >
              Delete
            </Button>
          </DialogHeader>

          {/* Error Message */}
          {error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Task metadata */}
          <div className="mb-6 flex items-center gap-4 flex-wrap">
            <span className="text-sm text-white/60">Status:</span>
            <span className="rounded-full bg-red-500/20 px-3 py-1 text-red-400 text-sm">
              {task.status}
            </span>
            {task.branchName && repositoryUrl && (
              <>
                <span className="text-sm text-white/60 ml-4">Branch:</span>
                <a
                  href={`${repositoryUrl}/compare/main...${task.branchName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded bg-purple-500/20 px-3 py-1 text-purple-400 text-sm hover:bg-purple-500/30 transition-colors duration-200"
                >
                  {task.branchName}
                </a>
              </>
            )}
            <span className="text-sm text-white/60 ml-4">Type:</span>
            <Select value={selectedType} onValueChange={handleTypeChange} disabled={updatingType}>
              <SelectTrigger className="w-fit border-white/10 bg-zinc-900/50">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-zinc-950">
                {AVAILABLE_TYPES.map(type => (
                  <SelectItem key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-white/60 ml-4">Model:</span>
            <Select
              value={selectedModel}
              onValueChange={handleModelChange}
              disabled={updatingModel}
            >
              <SelectTrigger className="w-fit border-white/10 bg-zinc-900/50">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-zinc-950">
                {AVAILABLE_MODELS.map(model => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-white/60 ml-4">State:</span>
            <Select
              value={selectedExecutionState}
              onValueChange={handleExecutionStateChange}
              disabled={updatingExecutionState}
            >
              <SelectTrigger className="w-fit border-white/10 bg-zinc-900/50">
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-zinc-950">
                {AVAILABLE_EXECUTION_STATES.map(state => (
                  <SelectItem key={state} value={state}>
                    {state.charAt(0).toUpperCase() + state.slice(1).replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Session stats */}
          {(messageCount > 0 || inputTokens + outputTokens > 0) && (
            <div className="mb-6 flex items-center gap-4">
              <span className="text-sm text-white/60">Session Stats:</span>
              <span className="rounded bg-red-500/10 px-3 py-1 text-red-400 text-sm">
                {messageCount} messages
              </span>
              {inputTokens + outputTokens > 0 && (
                <span className="rounded bg-red-500/10 px-3 py-1 text-red-400 text-sm">
                  {Math.round((inputTokens + outputTokens) / 1000)}k tokens
                </span>
              )}
            </div>
          )}

          {/* Description */}
          <div className="mb-8">
            <h3 className="mb-2 text-sm font-medium text-white/60">Description</h3>
            <div className="rounded-lg border border-white/10 bg-zinc-900/50 p-4 text-white/80 whitespace-pre-wrap">
              {task.description || 'No description provided'}
            </div>
          </div>

          {/* Comments section */}
          <div className="border-t border-white/10 pt-6">
            <h3 className="mb-4 text-lg font-semibold text-white/90">Comments</h3>

            {comments.length === 0 ? (
              <div className="mb-6 py-8 text-center text-white/40">No comments yet</div>
            ) : (
              <div className="mb-6 max-h-[400px] overflow-y-auto">
                {comments.map(comment => (
                  <Comment
                    key={comment.id}
                    content={comment.content}
                    isAgentComment={comment.isAgentComment}
                    agentName={comment.agentName}
                    userName={null}
                    createdAt={comment.createdAt}
                  />
                ))}
              </div>
            )}

            {/* Add comment form */}
            <AddCommentForm onSubmit={handleAddComment} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-sm border-white/10 bg-zinc-950 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-white/90">Delete invocation</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-white/70">
              Are you sure you want to delete this invocation? This action cannot be undone.
            </p>
          </div>
          <div className="flex gap-3 justify-end">
            <Button
              onClick={() => setDeleteConfirmOpen(false)}
              variant="outline"
              className="border-white/10 text-white/70 hover:text-white"
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/20"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
