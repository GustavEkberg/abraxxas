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
import { createManifestAction } from '@/lib/core/manifest/create-manifest-action'

interface CreateManifestDialogProps {
  projectId: string
  trigger?: React.ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

type DialogState = { _tag: 'form' } | { _tag: 'loading' } | { _tag: 'error'; message: string }

export function CreateManifestDialog({
  projectId,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange
}: CreateManifestDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [name, setName] = useState('')
  const [prdName, setPrdName] = useState('')
  const [state, setState] = useState<DialogState>({ _tag: 'form' })

  // Support both controlled and uncontrolled modes
  const open = controlledOpen ?? internalOpen
  const setOpen = controlledOnOpenChange ?? setInternalOpen

  const canSubmit = name.length > 0 && state._tag === 'form'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setState({ _tag: 'loading' })

    const trimmedPrdName = prdName.trim() || undefined

    const result = await createManifestAction({
      projectId,
      name,
      prdName: trimmedPrdName
    })

    if (result._tag === 'Error') {
      setState({ _tag: 'error', message: result.message })
      return
    }

    // Close dialog on success - credentials visible in manifest card
    setOpen(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      // Reset state when closing
      setName('')
      setPrdName('')
      setState({ _tag: 'form' })
    }
  }

  const handleRetry = () => {
    setState({ _tag: 'form' })
  }

  // When controlled externally, don't render trigger
  const isControlled = controlledOpen !== undefined

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger render={trigger || <Button variant="outline">Create Manifest</Button>} />
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Summon Manifest</DialogTitle>
          <DialogDescription>
            Create a manifest to call upon the powers from beyond to complete complex tasks.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">How should the manifest be known?</Label>
            <Input
              id="name"
              placeholder="Σοφία"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={state._tag === 'loading'}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="prdName">
              Continue PRD <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="prdName"
              placeholder="feature-name"
              value={prdName}
              onChange={e => setPrdName(e.target.value)}
              disabled={state._tag === 'loading'}
            />
          </div>

          {state._tag === 'error' && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {state.message}
            </div>
          )}

          <div className="flex justify-end gap-2">
            {state._tag === 'error' ? (
              <>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleRetry}>
                  Retry
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={state._tag === 'loading'}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={!canSubmit}>
                  {state._tag === 'loading' ? 'Summoning...' : 'Summon'}
                </Button>
              </>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
