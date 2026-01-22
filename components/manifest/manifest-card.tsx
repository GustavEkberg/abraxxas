'use client'

import { useState, useTransition, useEffect } from 'react'
import {
  Check,
  ExternalLink,
  Link,
  Play,
  Square,
  Trash2,
  Terminal,
  Lock,
  Pencil
} from 'lucide-react'
import type { Manifest } from '@/lib/services/db/schema'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { useAlert } from '@/components/ui/gnostic-alert'
import { startTaskLoopAction } from '@/lib/core/manifest/start-task-loop-action'
import { stopTaskLoopAction } from '@/lib/core/manifest/stop-task-loop-action'
import { deleteManifestAction } from '@/lib/core/manifest/delete-manifest-action'
import { updatePrdNameAction } from '@/lib/core/manifest/update-prd-name-action'

const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

interface Spark {
  id: number
  angle: number
  distance: number
  duration: number
  delay: number
  size: number
}

function SparkParticle({ angle, distance, duration, delay, size }: Spark) {
  const rad = (angle * Math.PI) / 180
  const tx = Math.cos(rad) * distance
  const ty = Math.sin(rad) * distance

  return (
    <span
      className="pointer-events-none absolute left-1/2 top-1/2 rounded-full bg-red-400"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        animation: `spark-fly-${Math.round(angle)}-${Math.round(distance)} ${duration}s ease-out ${delay}s forwards`
      }}
    >
      <style>{`
        @keyframes spark-fly-${Math.round(angle)}-${Math.round(distance)} {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 0.9; }
          100% { transform: translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(0.3); opacity: 0; }
        }
      `}</style>
    </span>
  )
}

function createSpark(id: number): Spark {
  return {
    id,
    angle: Math.random() * 360,
    distance: 40 + Math.random() * 60,
    duration: 0.8 + Math.random() * 0.6,
    delay: Math.random() * 0.2,
    size: 2 + Math.random() * 3
  }
}

function SparkBurst() {
  const [sparks, setSparks] = useState<Spark[]>([])

  useEffect(() => {
    let idCounter = 0
    const interval = setInterval(() => {
      const count = 3 + Math.floor(Math.random() * 4)
      const newSparks = Array.from({ length: count }, () => createSpark(idCounter++))
      setSparks(prev => [...prev.slice(-30), ...newSparks])
    }, 300)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0">
      {sparks.map(s => (
        <SparkParticle key={s.id} {...s} />
      ))}
    </div>
  )
}

function calcProgress(prdJson: string | null): { passed: number; total: number } | null {
  if (!prdJson) return null
  try {
    const prd: unknown = JSON.parse(prdJson)
    if (typeof prd !== 'object' || prd === null) return null
    const tasks = 'tasks' in prd && Array.isArray(prd.tasks) ? prd.tasks : []
    const total = tasks.length
    const passed = tasks.filter(
      (t): t is { passes: true } =>
        typeof t === 'object' && t !== null && 'passes' in t && t.passes === true
    ).length
    return total > 0 ? { passed, total } : null
  } catch {
    return null
  }
}

function ManifestProgress({ prdJson, isRunning }: { prdJson: string | null; isRunning: boolean }) {
  const progress = calcProgress(prdJson)
  if (!progress) return null
  const { passed, total } = progress
  const percent = (passed / total) * 100
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-xs text-white/40">
        <span>
          {passed}/{total} tasks
        </span>
        <span>{Math.round(percent)}%</span>
      </div>
      <div className="relative h-1 w-full overflow-visible rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-red-500 transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
        {isRunning && (
          <div className="absolute top-1/2 -translate-y-1/2" style={{ left: `${percent}%` }}>
            <SparkBurst />
          </div>
        )}
      </div>
    </div>
  )
}

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

  const handleCopy = async () => {
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

function EditPrdNameDialog({
  manifestId,
  currentPrdName,
  disabled,
  highlight
}: {
  manifestId: string
  currentPrdName: string | null
  disabled?: boolean
  highlight?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [prdName, setPrdName] = useState(currentPrdName ?? '')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const validationError =
    prdName.length > 0 && !KEBAB_CASE_REGEX.test(prdName)
      ? 'Must be kebab-case (e.g., my-feature)'
      : null

  const canSubmit = prdName.length > 0 && !validationError && prdName !== (currentPrdName ?? '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setError(null)
    startTransition(async () => {
      const result = await updatePrdNameAction(manifestId, prdName)
      if (result._tag === 'Error') {
        setError(result.message)
      } else {
        setOpen(false)
      }
    })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setPrdName(currentPrdName ?? '')
      setError(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 px-2 ${highlight ? 'text-yellow-400 hover:text-yellow-300' : 'text-white/40 hover:text-white/90'}`}
            title={highlight ? 'Inscribe the path' : 'Edit path'}
            disabled={disabled}
          >
            <Pencil className="size-3.5" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit PRD Name</DialogTitle>
          <DialogDescription>
            Change the PRD name for this manifest. This determines which prd.json file will be
            executed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prdName">PRD Name</Label>
            <Input
              id="prdName"
              placeholder="my-feature"
              value={prdName}
              onChange={e => setPrdName(e.target.value)}
              disabled={isPending}
              aria-invalid={!!validationError}
              className="font-mono"
            />
            {validationError && <p className="text-destructive text-xs">{validationError}</p>}
            <p className="text-muted-foreground text-xs">
              Path: .opencode/state/{prdName || '<name>'}/prd.json
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isPending}>
              {isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ManifestCard({ manifest }: { manifest: Manifest }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { confirm } = useAlert()

  const isPendingStatus = manifest.status === 'pending'
  const isActive = manifest.status === 'active'
  const isRunning = manifest.status === 'running'
  const isCompleted = manifest.status === 'completed'
  const isError = manifest.status === 'error'
  const hasSprite = !!manifest.spriteName

  const borderColor = isRunning
    ? 'border-red-500/40 border-dashed'
    : isPendingStatus
      ? 'border-yellow-500/40 border-dashed'
      : isError
        ? 'border-red-500/40 border-dashed'
        : isCompleted
          ? 'border-green-500/40 border-dashed'
          : 'border-white/20 border-dashed'

  const bgColor = isRunning
    ? 'bg-red-950/20'
    : isPendingStatus
      ? 'bg-yellow-950/20'
      : isError
        ? 'bg-red-950/20'
        : 'bg-zinc-900'

  const handleStart = () => {
    setError(null)
    startTransition(async () => {
      const result = await startTaskLoopAction(manifest.id)
      if (result._tag === 'Error') {
        setError(result.message)
      }
      // Polling handled by board-client when manifest status changes
    })
  }

  const handleStop = () => {
    setError(null)
    startTransition(async () => {
      const result = await stopTaskLoopAction(manifest.id)
      if (result._tag === 'Error') {
        setError(result.message)
      }
    })
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Banish this Manifest?',
      message: 'This will destroy the sprite and banish it to the void. This cannot be undone.',
      variant: 'warning',
      confirmText: 'Banish',
      cancelText: 'Spare'
    })
    if (!confirmed) return
    setError(null)
    startTransition(async () => {
      const result = await deleteManifestAction(manifest.id)
      if (result._tag === 'Error') {
        setError(result.message)
      }
    })
  }

  return (
    <Card
      className={`relative max-w-full p-3 font-mono transition-all duration-200 md:w-fit md:p-4 ${borderColor} ${bgColor} ${isRunning ? 'animate-[shake_0.3s_ease-in-out_infinite]' : ''}`}
      style={
        isRunning
          ? {
              animation: 'shake 0.15s ease-in-out infinite'
            }
          : undefined
      }
    >
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0) rotate(0deg); }
          25% { transform: translateX(-1px) rotate(-0.5deg); }
          75% { transform: translateX(1px) rotate(0.5deg); }
        }
      `}</style>
      {/* Header row: status + name + actions */}
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {/* Status indicator */}
          {isRunning && (
            <div className="flex shrink-0 items-center gap-1">
              <div className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
              <span className="text-xs text-red-400">Invoking</span>
            </div>
          )}
          {isPendingStatus && (
            <div className="flex shrink-0 items-center gap-1">
              <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
              <span className="text-xs text-yellow-400">Conjuring</span>
            </div>
          )}
          {isActive && manifest.prdName && (
            <span className="shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-xs text-green-400">
              Awakened
            </span>
          )}
          {isActive && !manifest.prdName && (
            <span className="shrink-0 rounded bg-yellow-500/10 px-1.5 py-0.5 text-xs text-yellow-400">
              Unsealed
            </span>
          )}
          {isCompleted && <span className="shrink-0 text-xs text-green-400">✓ Fulfilled</span>}
          {isError && <span className="shrink-0 text-xs text-red-400">✗ Shattered</span>}

          {/* Manifest name */}
          <span className="truncate text-sm font-medium text-white/90">{manifest.name}</span>

          {/* PRD name indicator */}
          {manifest.prdName && (
            <span className="hidden text-xs text-white/40 md:inline">({manifest.prdName})</span>
          )}

          {/* Edit PRD name - only when editable, highlighted if not set */}
          {(isPendingStatus || isActive) && (
            <EditPrdNameDialog
              manifestId={manifest.id}
              currentPrdName={manifest.prdName}
              disabled={isPending}
              highlight={!manifest.prdName}
            />
          )}
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {hasSprite && manifest.spriteName && (
            <CopyButton
              value={manifest.spriteName}
              label="Copy sprite name"
              icon={<Terminal className="size-3.5" />}
            />
          )}
          {hasSprite && manifest.spriteUrl && (
            <>
              <CopyButton
                value={manifest.spriteUrl}
                label="Copy URL"
                icon={<Link className="size-3.5" />}
              />
              {manifest.spritePassword && (
                <CopyButton
                  value={manifest.spritePassword}
                  label="Copy password"
                  icon={<Lock className="size-3.5" />}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                render={<a href={manifest.spriteUrl} target="_blank" rel="noopener noreferrer" />}
                className="h-7 px-2 text-white/40 hover:text-white/90"
                title="Open in new tab"
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </>
          )}

          {/* Start/Stop controls - only show when prdName is set */}
          {isActive && manifest.prdName && (
            <Button
              onClick={handleStart}
              disabled={isPending}
              size="sm"
              className="h-7 bg-red-600 px-2 hover:bg-red-700"
              title="Start task loop"
            >
              <Play className="size-3.5" />
            </Button>
          )}
          {isRunning && (
            <Button
              onClick={handleStop}
              disabled={isPending}
              variant="destructive"
              size="sm"
              className="h-7 px-2"
              title="Stop task loop"
            >
              <Square className="size-3.5" />
            </Button>
          )}

          {/* Delete button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={isPending}
            className="h-7 px-2 text-white/40 hover:text-red-400"
            title="Delete manifest"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Error message */}
      {(error || manifest.errorMessage) && (
        <p className="mt-2 text-xs text-red-400">{error || manifest.errorMessage}</p>
      )}

      {/* Progress bar based on prdJson tasks */}
      {manifest.prdJson && <ManifestProgress prdJson={manifest.prdJson} isRunning={isRunning} />}
    </Card>
  )
}
