'use client'

import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { CreateInvocationDialog } from '@/components/invocations/create-invocation-dialog'
import { CreateManifestDialog } from '@/components/manifest/create-manifest-dialog'
import { Button } from '@/components/ui/button'

interface SummonMenuProps {
  ritualId: string
}

/**
 * Esoteric sigil icon - a stylized summoning symbol
 */
function SigilIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Central point */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      {/* Inner triangle pointing up */}
      <path d="M12 6 L16.5 15 L7.5 15 Z" />
      {/* Outer circle */}
      <circle cx="12" cy="12" r="9" />
      {/* Cross lines extending from center */}
      <line x1="12" y1="3" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="21" />
      <line x1="3" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="21" y2="12" />
    </svg>
  )
}

/**
 * Dropdown menu for summoning new invocations or manifests.
 * Combines both creation actions into a single esoteric-themed menu.
 */
export function SummonMenu({ ritualId }: SummonMenuProps) {
  const [invocationOpen, setInvocationOpen] = useState(false)
  const [manifestOpen, setManifestOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              className="border-dashed border-red-500/50 bg-transparent text-red-400 hover:border-red-500 hover:bg-red-500/10 hover:text-red-300"
              aria-label="Summon"
            >
              <SigilIcon className="size-5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setInvocationOpen(true)} className="cursor-pointer">
            <span className="flex items-center gap-2">
              <span className="text-red-400">&#x25C8;</span>
              Cast Invocation
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setManifestOpen(true)} className="cursor-pointer">
            <span className="flex items-center gap-2">
              <span className="text-purple-400">&#x29BE;</span>
              Conjure Manifest
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogs rendered outside dropdown - controlled mode, no trigger */}
      <CreateInvocationDialog
        ritualId={ritualId}
        open={invocationOpen}
        onOpenChange={setInvocationOpen}
      />
      <CreateManifestDialog
        projectId={ritualId}
        open={manifestOpen}
        onOpenChange={setManifestOpen}
      />
    </>
  )
}
