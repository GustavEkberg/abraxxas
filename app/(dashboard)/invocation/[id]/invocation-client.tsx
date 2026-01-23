'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Check,
  ExternalLink,
  GitBranch,
  GitCompareArrows,
  Terminal,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Trash2
} from 'lucide-react'
import type { Task, Project, OpencodeSession } from '@/lib/services/db/schema'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { deleteTaskAction } from '@/lib/core/task/delete-task-action'

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

interface InvocationClientProps {
  task: Task
  project: Project
  session: OpencodeSession | null
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

function StatusIcon({ status }: { status: OpencodeSession['status'] }) {
  switch (status) {
    case 'pending':
      return <div className="size-2 rounded-full bg-yellow-400" />
    case 'in_progress':
      return <Loader2 className="size-3.5 animate-spin text-blue-400" />
    case 'completed':
      return <CheckCircle2 className="size-3.5 text-green-400" />
    case 'error':
      return <AlertCircle className="size-3.5 text-red-400" />
  }
}

export function InvocationClient({ task, project, session }: InvocationClientProps) {
  const router = useRouter()
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [isPending, startTransition] = useTransition()

  const opencodeUrl = session?.spriteUrl ?? null

  const handleDelete = () => {
    if (!confirm('Banish this invocation?')) return

    startTransition(async () => {
      const result = await deleteTaskAction(task.id)
      if (result._tag === 'Success') {
        router.push(`/rituals/${project.id}`)
      }
    })
  }

  const messageCount = session?.messageCount ? parseInt(session.messageCount, 10) : 0
  const inputTokens = session?.inputTokens ? parseInt(session.inputTokens, 10) : 0
  const outputTokens = session?.outputTokens ? parseInt(session.outputTokens, 10) : 0
  const totalTokens = inputTokens + outputTokens

  return (
    <div className="flex h-[calc(100vh-3.75rem)] flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-dashed border-white/10 px-3 py-2">
        <div className="flex items-center gap-3">
          <Link href={`/rituals/${project.id}`}>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-white/40 hover:text-white">
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="square" />
              </svg>
            </Button>
          </Link>
          <span className="font-mono text-sm text-white/70">{task.title}</span>
          {session && <StatusIcon status={session.status} />}
        </div>

        <div className="flex items-center gap-1">
          {session?.spriteName && (
            <CopyButton
              value={session.spriteName}
              label="Copy sprite"
              icon={<Terminal className="size-3.5" />}
            />
          )}

          {opencodeUrl && (
            <Button
              variant="ghost"
              size="sm"
              render={<a href={opencodeUrl} target="_blank" rel="noopener noreferrer" />}
              className="h-7 px-2 text-white/40 hover:text-white/90"
              title="Open in new tab"
            >
              <ExternalLink className="size-3.5" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={isPending}
            className="h-7 px-2 text-white/40 hover:text-red-400"
            title="Banish"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Iframe area */}
        <div className="flex-1 bg-zinc-950">
          {opencodeUrl ? (
            <div className="relative h-full w-full">
              {!iframeLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
                  <Loader2 className="size-6 animate-spin text-white/20" />
                </div>
              )}
              <iframe
                src={opencodeUrl}
                className="h-full w-full border-0"
                onLoad={() => setIframeLoaded(true)}
                allow="clipboard-read; clipboard-write"
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Terminal className="mx-auto mb-3 size-8 text-white/10" />
                <p className="font-mono text-xs text-white/30">
                  {session ? 'Sprite dormant' : 'Awaiting invocation'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-64 shrink-0 overflow-y-auto border-l border-dashed border-white/10 bg-zinc-900/30 p-3">
          {session ? (
            <div className="space-y-3">
              {/* Stats */}
              <Card className="border-dashed border-white/10 bg-transparent p-3">
                <div className="space-y-2 font-mono text-xs">
                  <div className="flex justify-between text-white/40">
                    <span>messages</span>
                    <span className="text-white/70">{messageCount}</span>
                  </div>
                  <div className="flex justify-between text-white/40">
                    <span>tokens</span>
                    <span className="text-white/70">{formatTokens(totalTokens)}</span>
                  </div>
                  {inputTokens > 0 && (
                    <div className="flex justify-between pl-2 text-white/30">
                      <span>in</span>
                      <span>{formatTokens(inputTokens)}</span>
                    </div>
                  )}
                  {outputTokens > 0 && (
                    <div className="flex justify-between pl-2 text-white/30">
                      <span>out</span>
                      <span>{formatTokens(outputTokens)}</span>
                    </div>
                  )}
                </div>
              </Card>

              {/* Branch */}
              {session.branchName && (
                <Card className="border-dashed border-white/10 bg-transparent p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <GitBranch className="size-3.5 shrink-0 text-white/30" />
                      <code className="truncate font-mono text-xs text-white/50">
                        {session.branchName}
                      </code>
                    </div>
                    {project.repositoryUrl && (
                      <a
                        href={`${project.repositoryUrl.replace(/\.git$/, '')}/compare/main...${encodeURIComponent(session.branchName)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-white/30 hover:text-white/60"
                      >
                        <GitCompareArrows className="size-3.5" />
                      </a>
                    )}
                  </div>
                </Card>
              )}

              {/* Error */}
              {session.errorMessage && (
                <Card className="border-dashed border-red-500/20 bg-red-950/10 p-3">
                  <p className="font-mono text-xs text-red-400/70">{session.errorMessage}</p>
                </Card>
              )}

              {/* Description */}
              {task.description && (
                <Card className="border-dashed border-white/10 bg-transparent p-3">
                  <p className="font-mono text-xs text-white/40">{task.description}</p>
                </Card>
              )}
            </div>
          ) : (
            <p className="font-mono text-xs text-white/20">No session bound</p>
          )}
        </div>
      </div>
    </div>
  )
}
