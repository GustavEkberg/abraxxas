import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { taskModelEnum } from '@/lib/services/db/schema'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatEmail(email: string): string {
  return email.toLowerCase().trim()
}

type TaskModel = (typeof taskModelEnum.enumValues)[number]

/**
 * Map task model enum to opencode model string (provider/model format)
 */
export function getOpencodeModel(taskModel: TaskModel): string {
  switch (taskModel) {
    case 'grok-1':
      return 'xai/grok-3-beta'
    case 'claude-opus-4-5':
      return 'anthropic/claude-opus-4-5-20251101'
    case 'claude-sonnet-4-5':
      return 'anthropic/claude-sonnet-4-5-20250929'
    case 'claude-haiku-4-5':
      return 'anthropic/claude-haiku-4-5-20251001'
    default:
      return 'anthropic/claude-sonnet-4-5-20250929'
  }
}
