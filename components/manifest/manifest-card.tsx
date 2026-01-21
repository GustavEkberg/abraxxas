'use client'

import { useState, useTransition } from 'react'
import { Check, ExternalLink, Link, Play, Square, Trash2, Terminal, Lock } from 'lucide-react'
import type { Manifest } from '@/lib/services/db/schema'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { startTaskLoopAction } from '@/lib/core/manifest/start-task-loop-action'
import { stopTaskLoopAction } from '@/lib/core/manifest/stop-task-loop-action'
import { deleteManifestAction } from '@/lib/core/manifest/delete-manifest-action'

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

export function ManifestCard({ manifest }: { manifest: Manifest }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

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

  const handleDelete = () => {
    if (!confirm('Delete this manifest? This will also destroy the sprite.')) return
    setError(null)
    startTransition(async () => {
      const result = await deleteManifestAction(manifest.id)
      if (result._tag === 'Error') {
        setError(result.message)
      }
    })
  }

  return (
    <Card className={`w-fit p-4 font-mono transition-all duration-200 ${borderColor} ${bgColor}`}>
      {/* Header row: status + name + actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* Status indicator */}
          {isRunning && (
            <div className="flex shrink-0 items-center gap-1">
              <div className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
              <span className="text-xs text-red-400">Running</span>
            </div>
          )}
          {isPendingStatus && (
            <div className="flex shrink-0 items-center gap-1">
              <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
              <span className="text-xs text-yellow-400">Summoning</span>
            </div>
          )}
          {isActive && (
            <span className="shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-xs text-green-400">
              Ready
            </span>
          )}
          {isCompleted && <span className="shrink-0 text-xs text-green-400">✓ Complete</span>}
          {isError && <span className="shrink-0 text-xs text-red-400">✗ Failed</span>}

          {/* PRD name */}
          <span className="truncate text-sm font-medium text-white/90">{manifest.prdName}</span>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-1">
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

          {/* Start/Stop controls */}
          {isActive && (
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

      {/* Progress placeholder - TODO: add actual progress later */}
      {isRunning && (
        <div className="mt-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-red-500/50" />
          </div>
        </div>
      )}
    </Card>
  )
}
