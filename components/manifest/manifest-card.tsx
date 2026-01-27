'use client'

import { useState, useTransition, useEffect } from 'react'
import Link from 'next/link'
import {
  Check,
  ExternalLink,
  GitCompareArrows,
  Play,
  ScrollText,
  Square,
  Terminal
} from 'lucide-react'
import type { Sprite } from '@/lib/services/db/schema'
import type { ManifestPrdData, PrdJson } from '@/lib/core/manifest/fetch-prd-from-github'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAlert } from '@/components/ui/gnostic-alert'
import { spawnSpriteAction } from '@/lib/core/manifest/spawn-sprite-action'
import { stopSpriteAction } from '@/lib/core/manifest/stop-sprite-action'
import { tailLogAction } from '@/lib/core/sprite/tail-log-action'

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

function calcProgress(prdJson: PrdJson | null): { passed: number; total: number } | null {
  if (!prdJson) return null
  const total = prdJson.tasks.length
  const passed = prdJson.tasks.filter(t => t.passes).length
  return total > 0 ? { passed, total } : null
}

function ManifestProgress({ prdJson, isRunning }: { prdJson: PrdJson | null; isRunning: boolean }) {
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

function TailLogButton({ spriteName }: { spriteName: string }) {
  const { alert } = useAlert()
  const [isPending, startTransition] = useTransition()

  const handleTailLog = () => {
    startTransition(async () => {
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
    })
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleTailLog}
      disabled={isPending}
      className="h-7 px-2 text-white/40 hover:text-white/90"
      title="View sprite log"
    >
      <ScrollText className="size-3.5" />
    </Button>
  )
}

interface ManifestCardProps {
  projectId: string
  branchName: string
  prdName: string
  repositoryUrl: string
  prdData: ManifestPrdData | null
  sprite: Sprite | null
}

function buildCompareUrl(repositoryUrl: string, branchName: string): string {
  const cleanUrl = repositoryUrl.replace(/\.git$/, '')
  return `${cleanUrl}/compare/main...${encodeURIComponent(branchName)}`
}

function BranchCompareButton({
  branchName,
  compareUrl,
  className
}: {
  branchName: string
  compareUrl: string
  className?: string
}) {
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (e.shiftKey) {
      e.preventDefault()
      await navigator.clipboard.writeText(branchName)
    } else {
      window.open(compareUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      className={className}
      title={`Compare ${branchName} to main (Shift+click to copy)`}
    >
      <GitCompareArrows className="size-3.5" />
    </Button>
  )
}

export function ManifestCard({
  projectId,
  branchName,
  prdName,
  repositoryUrl,
  prdData,
  sprite
}: ManifestCardProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { confirm } = useAlert()

  const isRunning = sprite?.status === 'running'
  const isPendingStatus = sprite?.status === 'pending'
  const isActive = sprite?.status === 'active'
  const isError = sprite?.status === 'error'
  const hasSprite = !!sprite?.spriteName

  // Check if all tasks pass (completed)
  const isCompleted =
    prdData?.prdJson && prdData.prdJson.tasks.length > 0
      ? prdData.prdJson.tasks.every(t => t.passes)
      : false

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

  const handleSpawn = () => {
    setError(null)
    startTransition(async () => {
      const result = await spawnSpriteAction({ projectId, branchName, prdName })
      if (result._tag === 'Error') {
        setError(result.message)
      }
    })
  }

  const handleStop = async () => {
    const confirmed = await confirm({
      title: 'Stop this Sprite?',
      message: 'This will destroy the sprite and stop execution. You can spawn a new one later.',
      variant: 'warning',
      confirmText: 'Stop',
      cancelText: 'Cancel'
    })
    if (!confirmed) return
    setError(null)
    startTransition(async () => {
      const result = await stopSpriteAction(projectId, branchName)
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
          {!sprite && !isCompleted && (
            <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-xs text-white/40">
              Dormant
            </span>
          )}
          {isActive && (
            <span className="shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-xs text-green-400">
              Active
            </span>
          )}
          {isCompleted && <span className="shrink-0 text-xs text-green-400">Fulfilled</span>}
          {isError && <span className="shrink-0 text-xs text-red-400">Shattered</span>}

          {/* PRD name (read-only from GitHub branch) */}
          <span className="truncate text-sm font-medium text-white/90">{prdName}</span>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {hasSprite && sprite.spriteName && (
            <CopyButton
              value={sprite.spriteName}
              label="Copy sprite name"
              icon={<Terminal className="size-3.5" />}
            />
          )}
          {hasSprite && sprite.spriteUrl && (
            <Button
              variant="ghost"
              size="sm"
              render={<Link href={`/manifest/${encodeURIComponent(branchName)}`} />}
              className="h-7 px-2 text-white/40 hover:text-white/90"
              title="Open manifest"
            >
              <ExternalLink className="size-3.5" />
            </Button>
          )}
          {hasSprite && sprite.spriteName && <TailLogButton spriteName={sprite.spriteName} />}

          {/* Branch compare link */}
          <BranchCompareButton
            branchName={branchName}
            compareUrl={buildCompareUrl(repositoryUrl, branchName)}
            className="h-7 px-2 text-white/40"
          />

          {/* Spawn/Stop toggle button */}
          {!isCompleted && (
            <Button
              onClick={hasSprite ? handleStop : handleSpawn}
              disabled={isPending}
              size="sm"
              className={
                hasSprite
                  ? 'h-7 bg-red-600 px-2 hover:bg-red-700'
                  : 'h-7 bg-red-600 px-2 hover:bg-red-700'
              }
              title={hasSprite ? 'Stop sprite' : 'Spawn sprite'}
            >
              {hasSprite ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {/* Error message */}
      {(error || sprite?.errorMessage) && (
        <p className="mt-2 text-xs text-red-400">{error || sprite?.errorMessage}</p>
      )}

      {/* Progress bar based on prdJson tasks */}
      {prdData?.prdJson && <ManifestProgress prdJson={prdData.prdJson} isRunning={isRunning} />}
    </Card>
  )
}
