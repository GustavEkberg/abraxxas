'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

interface RunningTask {
  id: string
  startedAt: number
  messageCount?: number
}

interface FireIntensityContextValue {
  intensity: number
  addRunningTask: (taskId: string, messageCount?: number) => void
  removeRunningTask: (taskId: string) => void
  updateTaskMessages: (taskId: string, messageCount: number) => void
  runningTasks: RunningTask[]
}

const FireIntensityContext = createContext<FireIntensityContextValue | null>(null)

/**
 * Calculate fire intensity based on running tasks.
 *
 * - Base intensity per task: 10
 * - Message bonus: +1 per message (up to max 10 bonus per task)
 * - Time bonus: +1 per 30 seconds (up to max 15 bonus per task)
 * - Intensity can exceed 35, triggering color changes above threshold
 */
function calculateIntensity(tasks: RunningTask[]): number {
  if (tasks.length === 0) return 0

  const now = Date.now()
  const baseIntensityPerTask = 10
  const messageBonus = (messageCount: number) => {
    return Math.min(messageCount, 10)
  }
  const timeBonus = (elapsed: number) => {
    const bonus = Math.floor(elapsed / 30000)
    return Math.min(bonus, 15)
  }

  const totalIntensity = tasks.reduce((sum, task) => {
    const elapsed = now - task.startedAt
    const msgBonus = messageBonus(task.messageCount ?? 0)
    return sum + baseIntensityPerTask + msgBonus + timeBonus(elapsed)
  }, 0)

  return totalIntensity
}

export function FireIntensityProvider({ children }: { children: ReactNode }) {
  const [runningTasks, setRunningTasks] = useState<RunningTask[]>([])
  const [intensity, setIntensity] = useState(calculateIntensity(runningTasks))

  const addRunningTask = useCallback((taskId: string, messageCount?: number) => {
    setRunningTasks(prev => {
      if (prev.some(t => t.id === taskId)) return prev
      return [...prev, { id: taskId, startedAt: Date.now(), messageCount }]
    })
  }, [])

  const removeRunningTask = useCallback((taskId: string) => {
    setRunningTasks(prev => prev.filter(t => t.id !== taskId))
  }, [])

  const updateTaskMessages = useCallback((taskId: string, messageCount: number) => {
    setRunningTasks(prev => prev.map(t => (t.id === taskId ? { ...t, messageCount } : t)))
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setIntensity(calculateIntensity(runningTasks))
    }, 1000)

    return () => clearInterval(interval)
  }, [runningTasks])

  return (
    <FireIntensityContext.Provider
      value={{
        intensity,
        addRunningTask,
        removeRunningTask,
        updateTaskMessages,
        runningTasks
      }}
    >
      {children}
    </FireIntensityContext.Provider>
  )
}

export function useFireIntensity() {
  const context = useContext(FireIntensityContext)
  if (!context) {
    throw new Error('useFireIntensity must be used within FireIntensityProvider')
  }
  return context
}
