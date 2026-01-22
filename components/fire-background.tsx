'use client'

import { useFireIntensity } from '@/lib/contexts/fire-intensity-context'
import { AsciiFire } from './ascii-fire'

/**
 * Wrapper component that connects AsciiFire to FireIntensityContext.
 * Renders ASCII fire animation at bottom of screen with intensity from running tasks.
 * When manifests are running, also renders inverted fire at top ("as above, so below").
 */
export function FireBackground() {
  const { intensity, hasRunningManifest } = useFireIntensity()

  return (
    <>
      <AsciiFire intensity={intensity} />
      {hasRunningManifest && <AsciiFire intensity={intensity} inverted />}
    </>
  )
}
