'use client'

import { useState, useTransition } from 'react'
import { Copy, Check, ExternalLink, Play, Square } from 'lucide-react'
import type { Manifest } from '@/lib/services/db/schema'
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton
} from '@/components/ui/input-group'
import { startTaskLoopAction } from '@/lib/core/manifest/start-task-loop-action'
import { stopTaskLoopAction } from '@/lib/core/manifest/stop-task-loop-action'

type StatusConfig = {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

const statusConfig: Record<Manifest['status'], StatusConfig> = {
  pending: { label: 'Summoning', variant: 'secondary' },
  active: { label: 'Active', variant: 'default' },
  running: { label: 'Running', variant: 'default' },
  completed: { label: 'Complete', variant: 'outline' },
  error: { label: 'Failed', variant: 'destructive' }
}

function CopyableField({
  label,
  value,
  masked = false
}: {
  label: string
  value: string | null
  masked?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(!masked)

  if (!value) return null

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-1">
      <label className="text-muted-foreground text-xs font-medium">{label}</label>
      <InputGroup>
        <InputGroupInput
          readOnly
          value={revealed ? value : '\u2022'.repeat(Math.min(value.length, 24))}
          className="font-mono text-xs"
        />
        <InputGroupAddon align="inline-end">
          {masked && (
            <InputGroupButton
              onClick={() => setRevealed(r => !r)}
              aria-label={revealed ? 'Hide' : 'Reveal'}
            >
              {revealed ? 'Hide' : 'Show'}
            </InputGroupButton>
          )}
          <InputGroupButton onClick={handleCopy} aria-label="Copy">
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function formatTimestamp(date: Date | null) {
  if (!date) return null
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date)
}

export function ManifestCard({ manifest }: { manifest: Manifest }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const config = statusConfig[manifest.status]
  const isActive = manifest.status === 'active'
  const isRunning = manifest.status === 'running'
  const showControls = isActive || isRunning
  const hasSprite = !!manifest.spriteName

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

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Badge variant={config.variant}>{config.label}</Badge>
          <span className="font-mono text-sm">{manifest.prdName}</span>
        </CardTitle>
        <CardAction>
          {hasSprite && manifest.spriteUrl && (
            <Button
              variant="outline"
              size="sm"
              render={<a href={manifest.spriteUrl} target="_blank" rel="noopener noreferrer" />}
            >
              Open OpenCode
              <ExternalLink data-icon="inline-end" className="size-3" />
            </Button>
          )}
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <p className="text-destructive text-sm">{error}</p>}

        {manifest.errorMessage && (
          <p className="text-destructive text-sm">{manifest.errorMessage}</p>
        )}

        {hasSprite && (
          <div className="grid gap-3 sm:grid-cols-2">
            <CopyableField label="Sprite Name" value={manifest.spriteName} />
            <CopyableField label="Sprite URL" value={manifest.spriteUrl} />
            <CopyableField label="Password" value={manifest.spritePassword} masked />
          </div>
        )}

        {showControls && (
          <div className="flex gap-2">
            {isActive && (
              <Button onClick={handleStart} disabled={isPending} size="sm">
                <Play data-icon="inline-start" className="size-3" />
                {isPending ? 'Starting...' : 'Start Task Loop'}
              </Button>
            )}
            {isRunning && (
              <Button onClick={handleStop} disabled={isPending} variant="destructive" size="sm">
                <Square data-icon="inline-start" className="size-3" />
                {isPending ? 'Stopping...' : 'Stop Task Loop'}
              </Button>
            )}
          </div>
        )}

        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>Created: {formatTimestamp(manifest.createdAt)}</span>
          {manifest.completedAt && <span>Completed: {formatTimestamp(manifest.completedAt)}</span>}
        </div>
      </CardContent>
    </Card>
  )
}
