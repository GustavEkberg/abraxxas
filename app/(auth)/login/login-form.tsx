'use client'

import { Button } from '@/components/ui/button'
import type { FormEvent } from 'react'
import { useState, useTransition } from 'react'
import { LoaderCircleIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { formatEmail } from '@/lib/utils'
import { authClient } from '@/lib/services/auth/auth-client'
import { useRouter } from 'next/navigation'

export const LoginForm = () => {
  const [email, setEmail] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isProcessing, startTransition] = useTransition()
  const router = useRouter()

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      setErrorMessage(null)

      const { data, error } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'sign-in'
      })

      if (error) {
        console.error('Error sending email', error)
        toast.error(`Login error: ${error.statusText}`)
        return setErrorMessage(error.statusText ?? 'Something went wrong. Try again later.')
      }

      if (data.success) {
        router.push(`/login/otp?email=${encodeURIComponent(email)}`)
      }
    })
  }

  return (
    <div className="w-full space-y-8 font-mono">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-white/90">ABRAXAS</h1>
        <p className="text-white/60">Enter the realm</p>
      </div>

      {/* Form */}
      <form onSubmit={handleLogin} className="w-full space-y-4">
        <Input
          id="email"
          type="email"
          placeholder="Your vessel identifier (email)"
          value={email}
          onChange={e => setEmail(formatEmail(e.target.value))}
          autoFocus
          required
          className="border-dashed border-white/20 bg-zinc-950 text-white/90 placeholder:text-white/40"
        />
        <Button
          type="submit"
          size="lg"
          className="w-full border border-dashed border-red-500 bg-red-600 text-white transition-all duration-200 hover:bg-red-700 active:scale-95"
          disabled={isProcessing}
        >
          {isProcessing && <LoaderCircleIcon className="size-4 mr-1 animate-spin" />}
          {isProcessing ? 'Channeling...' : 'Begin Invocation'}
        </Button>
      </form>

      {errorMessage && (
        <p className="text-red-400 text-sm text-center border border-dashed border-red-500/20 bg-red-500/10 p-3">
          {errorMessage}
        </p>
      )}

      {/* Footer */}
      <p className="text-center text-xs text-white/40">
        Harness the powers that came before us to build what will come after.
      </p>
    </div>
  )
}
