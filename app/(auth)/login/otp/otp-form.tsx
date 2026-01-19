'use client'

import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp'
import { LoaderCircleIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { authClient } from '@/lib/services/auth/auth-client'
import { useRouter } from 'next/navigation'

type Props = {
  email: string
}

export const OtpForm = ({ email }: Props) => {
  const [otp, setOtp] = useState('')
  const [isProcessing, startTransition] = useTransition()
  const [showError, setShowError] = useState(false)
  const router = useRouter()

  const handleChange = (value: string) => {
    setShowError(false)
    setOtp(value)
  }

  const handleSend = async () => {
    startTransition(async () => {
      const { error } = await authClient.signIn.emailOtp({
        email,
        otp
      })

      if (error) {
        setShowError(true)
        toast.error(`Login error: ${error.message}`)
        return
      }

      router.push('/')
    })
  }

  return (
    <div className="flex flex-col items-center justify-center text-center gap-8 font-mono">
      {/* Header */}
      <div className="flex flex-col justify-center items-center space-y-4">
        <h1 className="text-2xl font-bold text-white/90">ABRAXAS</h1>
        <div className="text-6xl text-white/20">&#9683;</div>
        <h2 className="text-xl text-white/80">A sigil has been dispatched to {email}</h2>
      </div>

      {/* Status */}
      <div className="h-6">
        {isProcessing ? (
          <div className="flex items-center gap-2 text-white/60">
            <LoaderCircleIcon className="animate-spin size-4" />
            <span>Verifying the seal...</span>
          </div>
        ) : showError ? (
          <div className="text-red-400 border border-dashed border-red-500/20 bg-red-500/10 px-3 py-1">
            Invalid sigil
          </div>
        ) : (
          <p className="text-white/60">Enter the sacred sequence to complete the binding</p>
        )}
      </div>

      {/* OTP Input */}
      <InputOTP
        value={otp}
        onChange={handleChange}
        onComplete={handleSend}
        maxLength={6}
        disabled={isProcessing}
        autoFocus
      >
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          <InputOTPSlot index={3} />
          <InputOTPSlot index={4} />
          <InputOTPSlot index={5} />
        </InputOTPGroup>
      </InputOTP>

      {/* Footer */}
      <p className="text-white/40 text-sm text-center max-w-sm">
        Sigils are only dispatched to bound vessels. Check the shadow realm (spam folder) if the
        message has not arrived.
        <Link
          href="/login"
          className="block mt-2 text-red-400 hover:text-red-300 transition-colors"
        >
          Request a new sigil
        </Link>
      </p>
    </div>
  )
}
