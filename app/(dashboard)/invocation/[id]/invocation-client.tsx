'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  ExternalLink,
  GitBranch,
  Clock,
  MessageSquare,
  Coins,
  Terminal,
  AlertCircle,
  CheckCircle2,
  Loader2
} from 'lucide-react'
import type { Task, Project, OpencodeSession } from '@/lib/services/db/schema'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function StatusBadge({ status }: { status: OpencodeSession['status'] }) {
  const statusConfig = {
    pending: { icon: Clock, color: 'text-yellow-400 bg-yellow-400/10', label: 'Pending' },
    in_progress: { icon: Loader2, color: 'text-blue-400 bg-blue-400/10', label: 'Running' },
    completed: { icon: CheckCircle2, color: 'text-green-400 bg-green-400/10', label: 'Completed' },
    error: { icon: AlertCircle, color: 'text-red-400 bg-red-400/10', label: 'Error' }
  }

  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.color}`}
    >
      <Icon className={`size-3.5 ${status === 'in_progress' ? 'animate-spin' : ''}`} />
      {config.label}
    </span>
  )
}

export function InvocationClient({ task, project, session }: InvocationClientProps) {
  const [iframeLoaded, setIframeLoaded] = useState(false)

  // Build the opencode web URL - the server is started with --continue flag
  // which automatically attaches to the last active session
  const opencodeUrl = session?.spriteUrl ?? null

  // Stats from session
  const messageCount = session?.messageCount ? parseInt(session.messageCount, 10) : 0
  const inputTokens = session?.inputTokens ? parseInt(session.inputTokens, 10) : 0
  const outputTokens = session?.outputTokens ? parseInt(session.outputTokens, 10) : 0
  const totalTokens = inputTokens + outputTokens

  return (
    <div className="flex h-[calc(100vh-3.75rem)] flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href={`/rituals/${project.id}`}>
            <Button variant="ghost" size="sm" className="gap-2 text-white/60 hover:text-white">
              <ArrowLeft className="size-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-white">{task.title}</h1>
            <p className="text-sm text-white/50">{project.name}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {session && <StatusBadge status={session.status} />}

          {session?.spriteName && (
            <CopyButton
              value={session.spriteName}
              label="Copy sprite name"
              icon={<Terminal className="size-3.5" />}
            />
          )}

          {opencodeUrl && (
            <Button
              variant="ghost"
              size="sm"
              render={<a href={opencodeUrl} target="_blank" rel="noopener noreferrer" />}
              className="gap-2 text-white/60 hover:text-white"
            >
              <ExternalLink className="size-4" />
              Open in new tab
            </Button>
          )}
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
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="size-8 animate-spin text-white/40" />
                    <p className="text-sm text-white/40">Connecting to opencode session...</p>
                  </div>
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
                <Terminal className="mx-auto mb-4 size-12 text-white/20" />
                <h2 className="mb-2 text-lg font-medium text-white/60">No active session</h2>
                <p className="text-sm text-white/40">
                  {session
                    ? 'The sprite for this invocation is no longer running.'
                    : 'This invocation has no session yet.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar with stats */}
        <div className="w-80 shrink-0 overflow-y-auto border-l border-white/10 bg-zinc-900/50 p-4">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/40">
            Session Info
          </h2>

          {session ? (
            <div className="space-y-4">
              {/* Status card */}
              <Card className="border-white/10 bg-zinc-800/50 p-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40">
                  Status
                </div>
                <StatusBadge status={session.status} />
                {session.createdAt && (
                  <p className="mt-2 text-xs text-white/40">
                    Started {formatDate(new Date(session.createdAt))}
                  </p>
                )}
                {session.completedAt && (
                  <p className="text-xs text-white/40">
                    Completed {formatDate(new Date(session.completedAt))}
                  </p>
                )}
              </Card>

              {/* Stats card */}
              <Card className="border-white/10 bg-zinc-800/50 p-4">
                <div className="mb-3 text-xs font-medium uppercase tracking-wider text-white/40">
                  Usage
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm text-white/60">
                      <MessageSquare className="size-4" />
                      Messages
                    </span>
                    <span className="font-mono text-sm text-white">{messageCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm text-white/60">
                      <Coins className="size-4" />
                      Input tokens
                    </span>
                    <span className="font-mono text-sm text-white">
                      {formatTokens(inputTokens)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm text-white/60">
                      <Coins className="size-4" />
                      Output tokens
                    </span>
                    <span className="font-mono text-sm text-white">
                      {formatTokens(outputTokens)}
                    </span>
                  </div>
                  <div className="border-t border-white/10 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white/80">Total tokens</span>
                      <span className="font-mono text-sm font-medium text-white">
                        {formatTokens(totalTokens)}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Branch info */}
              {session.branchName && (
                <Card className="border-white/10 bg-zinc-800/50 p-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40">
                    Branch
                  </div>
                  <div className="flex items-center gap-2">
                    <GitBranch className="size-4 text-white/60" />
                    <code className="text-sm text-white">{session.branchName}</code>
                  </div>
                  {project.repositoryUrl && (
                    <a
                      href={`${project.repositoryUrl.replace(/\.git$/, '')}/compare/main...${encodeURIComponent(session.branchName)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                    >
                      View diff on GitHub
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </Card>
              )}

              {/* Error message */}
              {session.errorMessage && (
                <Card className="border-red-500/30 bg-red-950/20 p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-red-400">
                    <AlertCircle className="size-4" />
                    Error
                  </div>
                  <p className="text-sm text-red-300">{session.errorMessage}</p>
                </Card>
              )}

              {/* Task description */}
              {task.description && (
                <Card className="border-white/10 bg-zinc-800/50 p-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40">
                    Task Description
                  </div>
                  <p className="text-sm text-white/70">{task.description}</p>
                </Card>
              )}
            </div>
          ) : (
            <Card className="border-white/10 bg-zinc-800/50 p-4">
              <p className="text-sm text-white/40">No session data available.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
