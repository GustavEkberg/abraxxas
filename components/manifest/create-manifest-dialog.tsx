'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
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
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton
} from '@/components/ui/input-group'
import { createManifestAction } from '@/lib/core/manifest/create-manifest-action'

interface CreateManifestDialogProps {
  projectId: string
  trigger?: React.ReactElement
}

function CopyableCredential({
  label,
  value,
  masked = false
}: {
  label: string
  value: string
  masked?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(!masked)

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

type DialogState =
  | { _tag: 'form' }
  | { _tag: 'loading' }
  | { _tag: 'success'; spriteUrl: string; spritePassword: string }
  | { _tag: 'error'; message: string }

export function CreateManifestDialog({ projectId, trigger }: CreateManifestDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [state, setState] = useState<DialogState>({ _tag: 'form' })

  const canSubmit = name.length > 0 && state._tag === 'form'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setState({ _tag: 'loading' })

    const result = await createManifestAction({ projectId, name })

    if (result._tag === 'Error') {
      setState({ _tag: 'error', message: result.message })
      return
    }

    setState({
      _tag: 'success',
      spriteUrl: result.data.spriteUrl,
      spritePassword: result.data.spritePassword
    })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      // Reset state when closing
      setName('')
      setState({ _tag: 'form' })
    }
  }

  const handleRetry = () => {
    setState({ _tag: 'form' })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger || <Button variant="outline">Create Manifest</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Summon Manifest</DialogTitle>
          <DialogDescription>
            Create a manifest sprite to autonomously complete PRD tasks.
          </DialogDescription>
        </DialogHeader>

        {state._tag === 'success' ? (
          <div className="space-y-4">
            <p className="text-sm text-green-400">Manifest sprite summoned successfully.</p>
            <div className="space-y-3">
              <CopyableCredential label="Sprite URL" value={state.spriteUrl} />
              <CopyableCredential label="Password" value={state.spritePassword} masked />
            </div>
            <p className="text-muted-foreground text-xs">
              Save these credentials. The password cannot be recovered.
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Manifest Name</Label>
              <Input
                id="name"
                placeholder="My Feature"
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={state._tag === 'loading'}
              />
              <p className="text-muted-foreground text-xs">
                Display name for this manifest. You can set the PRD name later after running /prd.
              </p>
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
        )}
      </DialogContent>
    </Dialog>
  )
}
