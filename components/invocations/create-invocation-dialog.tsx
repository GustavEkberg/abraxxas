'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { createTaskAction } from '@/lib/core/task/create-task-action'

type TaskType = 'bug' | 'feature' | 'plan' | 'other'
type TaskModel = 'grok-1' | 'claude-opus-4-5' | 'claude-sonnet-4-5' | 'claude-haiku-4-5'

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

interface CreateInvocationDialogProps {
  ritualId: string
  trigger?: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface FormData {
  title: string
  description: string
  type: TaskType
  model: TaskModel
}

/**
 * Dialog for creating a new invocation (task).
 * Uses mystical theming and language.
 */
export function CreateInvocationDialog({
  ritualId,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange
}: CreateInvocationDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Support both controlled and uncontrolled modes
  const open = controlledOpen ?? internalOpen
  const setOpen = controlledOnOpenChange ?? setInternalOpen

  const [formData, setFormData] = useState<FormData>({
    title: '',
    description: '',
    type: 'feature',
    model: 'claude-opus-4-5'
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const result = await createTaskAction({
      projectId: ritualId,
      title: formData.title,
      description: formData.description || undefined,
      type: formData.type,
      model: formData.model
    })

    if (result._tag === 'Error') {
      setError(result.message)
      setLoading(false)
      return
    }

    // Reset form and close dialog
    setFormData({
      title: '',
      description: '',
      type: 'feature',
      model: 'claude-sonnet-4-5'
    })
    setOpen(false)
    setLoading(false)
  }

  // When controlled externally, don't render trigger
  const isControlled = controlledOpen !== undefined

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger
          render={
            trigger || (
              <Button className="border border-dashed border-red-500 bg-red-600 hover:bg-red-700">
                Cast New Invocation
              </Button>
            )
          }
        />
      )}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl text-white/90">Cast New Invocation</DialogTitle>
          <DialogDescription className="text-white/60">
            Summon a new invocation to The Abyss. Channel your intent into the void.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Task Title */}
          <div className="space-y-2">
            <Label htmlFor="title" className="text-white/90">
              Invocation Title
            </Label>
            <Input
              id="title"
              placeholder="Conjure authentication wards"
              value={formData.title}
              onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
              required
              disabled={loading}
              className="border-dashed border-white/20 bg-zinc-900 text-white/90 placeholder:text-white/40"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-white/90">
              Incantation (Optional)
            </Label>
            <Textarea
              id="description"
              placeholder="Describe the dark purpose of this invocation..."
              value={formData.description}
              onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={4}
              disabled={loading}
              className="border-dashed border-white/20 bg-zinc-900 text-white/90 placeholder:text-white/40"
            />
          </div>

          {/* Type Select */}
          <div className="space-y-2">
            <Label htmlFor="type" className="text-white/90">
              Invocation Type
            </Label>
            <Select
              value={formData.type}
              onValueChange={value => {
                if (value && isTaskType(value)) {
                  setFormData(prev => ({ ...prev, type: value }))
                }
              }}
              disabled={loading}
            >
              <SelectTrigger
                id="type"
                className="border-dashed border-white/20 bg-zinc-900 text-white/90 w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feature">Conjuration</SelectItem>
                <SelectItem value="bug">Exorcism</SelectItem>
                <SelectItem value="plan">Divination</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Model Select */}
          <div className="space-y-2">
            <Label htmlFor="model" className="text-white/90">
              Summoned Entity
            </Label>
            <Select
              value={formData.model}
              onValueChange={value => {
                if (value && isTaskModel(value)) {
                  setFormData(prev => ({ ...prev, model: value }))
                }
              }}
              disabled={loading}
            >
              <SelectTrigger
                id="model"
                className="border-dashed border-white/20 bg-zinc-900 text-white/90 w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grok-1">Grok-1</SelectItem>
                <SelectItem value="claude-sonnet-4-5">Claude Sonnet 4.5</SelectItem>
                <SelectItem value="claude-opus-4-5">Claude Opus 4.5</SelectItem>
                <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-white/40">The demon that will execute this invocation</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="border-dashed border-white/20 bg-transparent text-white/60 hover:bg-zinc-900 hover:text-white/90"
            >
              Abandon
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="border border-dashed border-red-500 bg-red-600 text-white transition-all duration-200 hover:bg-red-700 active:scale-95 disabled:opacity-50"
            >
              {loading ? 'Casting...' : 'Cast Invocation'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
