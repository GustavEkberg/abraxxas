'use client'

import { useFireIntensity } from '@/lib/contexts/fire-intensity-context'
import { AsciiFire } from './ascii-fire'

/**
 * Wrapper component that connects AsciiFire to FireIntensityContext.
 * Renders ASCII fire animation at bottom of screen with intensity from running tasks.
 */
export function FireBackground() {
  const { intensity } = useFireIntensity()

  return <AsciiFire intensity={intensity} />
}
