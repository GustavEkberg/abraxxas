'use client'

import { useEffect, useRef } from 'react'
import { useFireIntensity } from '@/lib/contexts/fire-intensity-context'

const BASE_TITLE = 'ἀβραξάς'
// Skip space char - fire should always be visible when active
const fireChars = '.:-=+*#%@'
// Base intensity when no tasks running
const IDLE_INTENSITY = 5

/**
 * Animated ASCII fire in browser tab title.
 * Animates when intensity exceeds idle value (i.e., when tasks are running).
 */
export function AnimatedTitle() {
  const { intensity } = useFireIntensity()
  const fireRef = useRef<number[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Fire shows when any task/manifest is running (intensity > idle baseline)
    const isActive = intensity > IDLE_INTENSITY

    if (!isActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      document.title = BASE_TITLE
      return
    }

    // Already animating
    if (intervalRef.current) return

    const width = 6
    fireRef.current = new Array(width).fill(0)

    function step() {
      const fire = fireRef.current

      for (let i = 0; i < width - 1; i++) {
        fire[i] = fire[i + 1]
      }

      fire[width - 1] = Math.floor(Math.random() * fireChars.length)

      for (let i = 1; i < width - 1; i++) {
        const avg = (fire[i - 1] + fire[i] + fire[i + 1]) / 3
        fire[i] = Math.round(avg + (Math.random() - 0.5) * 2)
        fire[i] = Math.max(0, Math.min(fireChars.length - 1, fire[i]))
      }
    }

    function render() {
      const fireStr = fireRef.current
        .map(i => fireChars[Math.max(0, Math.min(i, fireChars.length - 1))])
        .join('')
      document.title = `${fireStr} ${BASE_TITLE} ${fireStr}`
    }

    for (let i = 0; i < 5; i++) step()
    render()

    intervalRef.current = setInterval(() => {
      step()
      render()
    }, 200)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      document.title = BASE_TITLE
    }
  }, [intensity])

  return null
}
