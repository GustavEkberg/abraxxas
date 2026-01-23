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
import { type Manifest, type Project, getManifestBranchName } from '@/lib/services/db/schema'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { deleteManifestAction } from '@/lib/core/manifest/delete-manifest-action'
import { useAlert } from '@/components/ui/gnostic-alert'

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

interface ManifestPageClientProps {
  manifest: Manifest
  project: Project
}

function StatusIcon({ status }: { status: Manifest['status'] }) {
  switch (status) {
    case 'pending':
      return <div className="size-2 rounded-full bg-yellow-400" />
    case 'active':
      return <div className="size-2 rounded-full bg-green-400" />
    case 'running':
      return <Loader2 className="size-3.5 animate-spin text-blue-400" />
    case 'completed':
      return <CheckCircle2 className="size-3.5 text-green-400" />
    case 'error':
      return <AlertCircle className="size-3.5 text-red-400" />
  }
}

export function ManifestPageClient({ manifest, project }: ManifestPageClientProps) {
  const router = useRouter()
  const { confirm } = useAlert()
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Append cwd to opencode web URL
  const opencodeUrl = manifest.spriteUrl ? `${manifest.spriteUrl}?cwd=/home/sprite/repo` : null

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Banish manifest?',
      message: 'This will permanently remove the manifest.',
      variant: 'warning'
    })
    if (!confirmed) return

    startTransition(async () => {
      const result = await deleteManifestAction(manifest.id)
      if (result._tag === 'Success') {
        router.push(`/rituals/${project.id}`)
      }
    })
  }

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
          <span className="font-mono text-sm text-white/70">{manifest.name}</span>
          <StatusIcon status={manifest.status} />
        </div>

        <div className="flex items-center gap-1">
          {manifest.spriteName && (
            <CopyButton
              value={manifest.spriteName}
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
                  {manifest.status === 'pending' ? 'Awaiting manifestation' : 'Sprite dormant'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-64 shrink-0 overflow-y-auto border-l border-dashed border-white/10 bg-zinc-900/30 p-3">
          <div className="space-y-3">
            {/* PRD Name */}
            {manifest.prdName && (
              <Card className="border-dashed border-white/10 bg-transparent p-3">
                <div className="font-mono text-xs">
                  <span className="text-white/40">prd: </span>
                  <span className="text-white/70">{manifest.prdName}</span>
                </div>
              </Card>
            )}

            {/* Branch - derived from prdName */}
            {manifest.prdName && (
              <Card className="border-dashed border-white/10 bg-transparent p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <GitBranch className="size-3.5 shrink-0 text-white/30" />
                    <code className="truncate font-mono text-xs text-white/50">
                      {getManifestBranchName(manifest.prdName)}
                    </code>
                  </div>
                  {project.repositoryUrl && (
                    <a
                      href={`${project.repositoryUrl.replace(/\.git$/, '')}/compare/main...${encodeURIComponent(getManifestBranchName(manifest.prdName))}`}
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
            {manifest.errorMessage && (
              <Card className="border-dashed border-red-500/20 bg-red-950/10 p-3">
                <p className="font-mono text-xs text-red-400/70">{manifest.errorMessage}</p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
