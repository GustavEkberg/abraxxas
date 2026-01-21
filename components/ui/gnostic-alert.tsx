'use client'

import * as React from 'react'
import { createContext, useCallback, useContext, useState } from 'react'
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import { AlertTriangleIcon, InfoIcon, CheckCircleIcon, XCircleIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type AlertVariant = 'info' | 'warning' | 'error' | 'success'

interface AlertOptions {
  title?: string
  message: string
  variant?: AlertVariant
  confirmText?: string
}

interface ConfirmOptions {
  title?: string
  message: string
  variant?: AlertVariant
  confirmText?: string
  cancelText?: string
}

interface AlertContextValue {
  alert: (options: AlertOptions | string) => Promise<void>
  confirm: (options: ConfirmOptions | string) => Promise<boolean>
}

const AlertContext = createContext<AlertContextValue | null>(null)

const variantConfig: Record<
  AlertVariant,
  { icon: React.ElementType; iconClass: string; borderClass: string; bgClass: string }
> = {
  info: {
    icon: InfoIcon,
    iconClass: 'text-purple-400',
    borderClass: 'border-purple-500/30',
    bgClass: 'bg-purple-500/10'
  },
  warning: {
    icon: AlertTriangleIcon,
    iconClass: 'text-amber-400',
    borderClass: 'border-amber-500/30',
    bgClass: 'bg-amber-500/10'
  },
  error: {
    icon: XCircleIcon,
    iconClass: 'text-red-400',
    borderClass: 'border-red-500/30',
    bgClass: 'bg-red-500/10'
  },
  success: {
    icon: CheckCircleIcon,
    iconClass: 'text-emerald-400',
    borderClass: 'border-emerald-500/30',
    bgClass: 'bg-emerald-500/10'
  }
}

type DialogMode = 'alert' | 'confirm'

interface DialogState {
  open: boolean
  mode: DialogMode
  options: AlertOptions | ConfirmOptions
  resolveAlert: (() => void) | null
  resolveConfirm: ((value: boolean) => void) | null
}

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState>({
    open: false,
    mode: 'alert',
    options: { message: '' },
    resolveAlert: null,
    resolveConfirm: null
  })

  const alert = useCallback((optionsOrMessage: AlertOptions | string): Promise<void> => {
    const options: AlertOptions =
      typeof optionsOrMessage === 'string' ? { message: optionsOrMessage } : optionsOrMessage

    return new Promise<void>(resolve => {
      setState({
        open: true,
        mode: 'alert',
        options,
        resolveAlert: resolve,
        resolveConfirm: null
      })
    })
  }, [])

  const confirm = useCallback((optionsOrMessage: ConfirmOptions | string): Promise<boolean> => {
    const options: ConfirmOptions =
      typeof optionsOrMessage === 'string' ? { message: optionsOrMessage } : optionsOrMessage

    return new Promise<boolean>(resolve => {
      setState({
        open: true,
        mode: 'confirm',
        options,
        resolveAlert: null,
        resolveConfirm: resolve
      })
    })
  }, [])

  const handleClose = useCallback(
    (confirmed: boolean) => {
      if (state.mode === 'alert') {
        state.resolveAlert?.()
      } else {
        state.resolveConfirm?.(confirmed)
      }
      setState(prev => ({ ...prev, open: false, resolveAlert: null, resolveConfirm: null }))
    },
    [state]
  )

  const variant = state.options.variant ?? 'warning'
  const config = variantConfig[variant]
  const Icon = config.icon
  const isConfirmMode = state.mode === 'confirm'
  const cancelText = 'cancelText' in state.options ? state.options.cancelText : undefined

  return (
    <AlertContext.Provider value={{ alert, confirm }}>
      {children}
      <AlertDialogPrimitive.Root
        open={state.open}
        onOpenChange={open => !open && handleClose(false)}
      >
        <AlertDialogPrimitive.Portal>
          <AlertDialogPrimitive.Backdrop
            className={cn(
              'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0',
              'bg-black/60 backdrop-blur-sm duration-200 fixed inset-0 z-50'
            )}
          />
          <AlertDialogPrimitive.Popup
            className={cn(
              'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0',
              'data-closed:zoom-out-95 data-open:zoom-in-95',
              'fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
              'bg-zinc-950 border border-dashed duration-200 outline-none font-mono',
              config.borderClass
            )}
          >
            {/* Gnostic header decoration */}
            <div className="border-b border-dashed border-white/10 px-6 py-3">
              <div className="flex items-center gap-3 text-white/40 text-xs">
                <span>{'>'}</span>
                <span>TRANSMISSION RECEIVED</span>
                <span className="ml-auto">{'<'}</span>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Icon + Title */}
              <div className="flex items-start gap-4">
                <div className={cn('p-2 border border-dashed', config.borderClass, config.bgClass)}>
                  <Icon className={cn('size-5', config.iconClass)} />
                </div>
                <div className="flex-1 space-y-1">
                  <AlertDialogPrimitive.Title className="text-lg font-semibold text-white/90">
                    {state.options.title ?? getDefaultTitle(variant)}
                  </AlertDialogPrimitive.Title>
                  <AlertDialogPrimitive.Description className="text-sm text-white/60 leading-relaxed">
                    {state.options.message}
                  </AlertDialogPrimitive.Description>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                {isConfirmMode && (
                  <Button
                    variant="ghost"
                    className="border border-dashed border-white/20 font-mono hover:bg-white/5"
                    onClick={() => handleClose(false)}
                  >
                    {cancelText ?? 'Deny'}
                  </Button>
                )}
                <Button
                  variant="outline"
                  className={cn('border-dashed font-mono', config.borderClass, 'hover:bg-white/5')}
                  onClick={() => handleClose(true)}
                >
                  {state.options.confirmText ?? (isConfirmMode ? 'Confirm' : 'Acknowledge')}
                </Button>
              </div>
            </div>

            {/* Gnostic footer decoration */}
            <div className="border-t border-dashed border-white/10 px-6 py-2">
              <div className="text-center text-white/20 text-xs">
                {':::'} END TRANSMISSION {':::'}
              </div>
            </div>
          </AlertDialogPrimitive.Popup>
        </AlertDialogPrimitive.Portal>
      </AlertDialogPrimitive.Root>
    </AlertContext.Provider>
  )
}

function getDefaultTitle(variant: AlertVariant): string {
  switch (variant) {
    case 'info':
      return 'Divine Message'
    case 'warning':
      return 'Cosmic Warning'
    case 'error':
      return 'Ritual Failed'
    case 'success':
      return 'Blessing Received'
  }
}

export function useAlert(): AlertContextValue {
  const context = useContext(AlertContext)
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider')
  }
  return context
}
