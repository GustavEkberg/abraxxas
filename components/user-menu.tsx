'use client'

import * as React from 'react'
import { ChevronDownIcon, LogOutIcon, KeyIcon, AlertTriangleIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { saveOpencodeAuthAction } from '@/lib/core/opencode-auth/save-opencode-auth-action'
import {
  getOpencodeAuthStatusAction,
  type OpencodeAuthStatus
} from '@/lib/core/opencode-auth/get-opencode-auth-status-action'

export function UserMenu() {
  const [authDialogOpen, setAuthDialogOpen] = React.useState(false)
  const [authContent, setAuthContent] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState(false)
  const [authStatus, setAuthStatus] = React.useState<OpencodeAuthStatus>({ _tag: 'None' })

  // Check auth status on mount
  React.useEffect(() => {
    getOpencodeAuthStatusAction().then(setAuthStatus)
  }, [])

  const handleSaveAuth = async () => {
    if (!authContent.trim()) {
      setError('Please paste your auth.json content')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const result = await saveOpencodeAuthAction(authContent)
      if (result._tag === 'Error') {
        setError(result.message)
      } else {
        setSuccess(true)
        // Refresh auth status after save
        getOpencodeAuthStatusAction().then(setAuthStatus)
        setTimeout(() => {
          setAuthDialogOpen(false)
          setAuthContent('')
          setSuccess(false)
        }, 1500)
      }
    } catch {
      setError('Failed to save auth')
    } finally {
      setSaving(false)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = event => {
      const content = event.target?.result
      if (typeof content === 'string') {
        setAuthContent(content)
        setError(null)
      }
    }
    reader.readAsText(file)
  }

  const isExpired = authStatus._tag === 'Expired'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 border border-dashed border-white/20 px-4 py-2 text-sm text-white/60 transition-all duration-200 hover:border-white/30 hover:text-white/90 font-mono outline-none">
          Settings
          {isExpired && <AlertTriangleIcon className="size-4 text-amber-400" />}
          <ChevronDownIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="font-mono">
          {isExpired && (
            <>
              <div className="px-2 py-1.5 text-xs text-amber-400 flex items-center gap-2">
                <AlertTriangleIcon className="size-3" />
                Anthropic OAuth expired
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            className={`cursor-pointer ${isExpired ? 'text-amber-400 focus:text-amber-400' : ''}`}
            onClick={() => {
              setAuthDialogOpen(true)
              setError(null)
              setSuccess(false)
            }}
          >
            <KeyIcon className="size-4" />
            Upload Opencode Auth
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer text-red-400 focus:text-red-400"
            onClick={() => {
              const form = document.createElement('form')
              form.method = 'POST'
              form.action = '/api/auth/sign-out'
              document.body.appendChild(form)
              form.submit()
            }}
          >
            <LogOutIcon className="size-4" />
            Dispel Session
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={authDialogOpen} onOpenChange={setAuthDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Opencode Auth</DialogTitle>
            <DialogDescription>
              Upload your opencode auth.json to allow sprites to use your model subscriptions.
              Located at ~/.local/share/opencode/auth.json
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-white/60 mb-2">
                Select auth.json file or paste content below
              </label>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                className="block w-full text-sm text-white/60 file:mr-4 file:py-2 file:px-4 file:border file:border-dashed file:border-white/20 file:text-sm file:font-mono file:bg-transparent file:text-white/60 hover:file:border-white/30 hover:file:text-white/90 file:cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-sm text-white/60 mb-2">Or paste content</label>
              <textarea
                value={authContent}
                onChange={e => {
                  setAuthContent(e.target.value)
                  setError(null)
                }}
                placeholder='{"anthropic": {"type": "oauth", ...}}'
                rows={8}
                className="w-full bg-zinc-900 border border-dashed border-white/20 p-3 text-sm text-white/90 font-mono placeholder:text-white/30 focus:border-white/30 focus:outline-none resize-none"
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
            {success && <p className="text-sm text-green-400">Auth saved successfully!</p>}
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setAuthDialogOpen(false)}
              className="border border-dashed border-white/20 px-4 py-2 text-sm text-white/60 transition-all hover:border-white/30 hover:text-white/90"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveAuth}
              disabled={saving || !authContent.trim()}
              className="border border-dashed border-red-500 bg-red-600 px-4 py-2 text-sm text-white transition-all hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Auth'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
