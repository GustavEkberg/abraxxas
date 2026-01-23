'use client'

import { useCallback, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { deleteTaskAction } from '@/lib/core/task/delete-task-action'

function BranchLink({ branchName, repositoryUrl }: { branchName: string; repositoryUrl: string }) {
  const [copied, setCopied] = useState(false)
  const compareUrl = `${repositoryUrl}/compare/main...${branchName}`

  const handleClick = async (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault()
      await navigator.clipboard.writeText(branchName)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      window.open(compareUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-white/60">Branch:</span>
      <button
        onClick={handleClick}
        className={`w-fit truncate rounded bg-purple-500/20 px-3 py-1 text-sm hover:bg-purple-500/30 transition-colors duration-200 ${copied ? 'text-green-400' : 'text-purple-400'}`}
        title="Click to compare, Shift+click to copy"
      >
        {branchName}
      </button>
    </div>
  )
}

interface TaskWithSession {
  id: string
  title: string
  description: string | null
  executionState: string
  branchName: string | null
}

interface TaskDetailModalProps {
  task: TaskWithSession | null
  ritualId: string
  repositoryUrl?: string
  errorMessage?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate?: () => void
}

/**
 * Task detail modal showing task title, prompt, branch link, and error message.
 * Simplified view focused on essential information.
 */
export function TaskDetailModal({
  task,
  ritualId: _ritualId,
  repositoryUrl,
  errorMessage,
  open,
  onOpenChange,
  onUpdate
}: TaskDetailModalProps) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const isError = task.executionState === 'error'

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto border-white/10 bg-zinc-950 text-white md:max-h-[80vh] lg:max-w-6xl">
          <DialogHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <DialogTitle className="text-lg font-bold text-white/90 md:text-2xl">
              {task.title}
            </DialogTitle>
            <Button
              onClick={() => setDeleteConfirmOpen(true)}
              variant="destructive"
              size="sm"
              disabled={isDeleting}
              className="w-fit bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/20"
            >
              Delete
            </Button>
          </DialogHeader>

          {/* Error Message (from action failures) */}
          {error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Task Error State */}
          {isError && errorMessage && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3">
              <h3 className="mb-1 text-sm font-medium text-red-400">Execution Error</h3>
              <p className="text-sm text-red-300 whitespace-pre-wrap">{errorMessage}</p>
            </div>
          )}

          {/* Branch Link - shift+click to copy branch name */}
          {task.branchName && repositoryUrl && (
            <BranchLink branchName={task.branchName} repositoryUrl={repositoryUrl} />
          )}

          {/* Initial Prompt (title + description) */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-white/60">Initial Prompt</h3>
            <div className="rounded-lg border border-white/10 bg-zinc-900/50 p-3 text-sm text-white/80 whitespace-pre-wrap md:p-4 md:text-base">
              <div className="font-medium mb-2">{task.title}</div>
              {task.description && <div className="text-white/70">{task.description}</div>}
            </div>
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
