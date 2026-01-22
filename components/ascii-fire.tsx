'use client';

import { useEffect, useRef } from 'react';

interface AsciiFireProps {
  intensity?: number; // 0+, dynamic based on running tasks
  inverted?: boolean; // If true, render at top of screen (fire burns downward)
}

/**
 * ASCII fire background effect.
 * Renders a fire animation at the bottom (or top if inverted) of the screen.
 * Fire size caps at intensity 35, above which color shifts from white to red/yellow.
 * Intensity increases with active ritual tasks and manifests.
 * Smoothly interpolates intensity changes for a gradual visual effect.
 *
 * When inverted=true, renders at top with fire burning downward ("as above, so below").
 */
export function AsciiFire({ intensity = 0, inverted = false }: AsciiFireProps) {
  const fireRef = useRef<HTMLPreElement>(null);
  const firePixelsRef = useRef<number[]>([]);
  const widthRef = useRef(0);
  const heightRef = useRef(200);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const currentIntensityRef = useRef(0);
  const targetIntensityRef = useRef(0);

  // Update target intensity when prop changes (without restarting animation)
  // Halve intensity on mobile (<768px) to reduce visual noise
  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    targetIntensityRef.current = (isMobile && intensity > 10) ? intensity * 0.5 : intensity;
  }, [intensity]);

  useEffect(() => {
    if (!fireRef.current) return;

    // ASCII characters sorted by visual weight (density)
    const charSet = ' .:-=+*#%@'.split('');
    const height = heightRef.current;
    const decayRate = 2; // Controls fire height
    const interpolationSpeed = 0.15; // Speed of intensity change (0-1, lower = slower)

    function init() {
      // Calculate width based on character size (~6px per char)
      widthRef.current = Math.floor(window.innerWidth / 6);
      firePixelsRef.current = new Array(widthRef.current * height).fill(0);
    }

    function step() {
      const width = widthRef.current;
      const firePixels = firePixelsRef.current;

      // Smoothly interpolate current intensity towards target
      const diff = targetIntensityRef.current - currentIntensityRef.current;
      if (Math.abs(diff) > 0.1) {
        currentIntensityRef.current += diff * interpolationSpeed;
      } else {
        currentIntensityRef.current = targetIntensityRef.current;
      }

      // 1. Update the "Source" (bottom row) with interpolated intensity
      // Cap fire size at 35, use excess intensity for color changes
      const rawIntensity = Math.round(currentIntensityRef.current);
      const displayIntensity = Math.min(rawIntensity, 35);
      for (let i = 0; i < width; i++) {
        firePixels[(height - 1) * width + i] = displayIntensity;
      }

      // 2. Propagate heat upwards
      for (let x = 0; x < width; x++) {
        for (let y = 1; y < height; y++) {
          const srcIdx = y * width + x;
          const pixel = firePixels[srcIdx];

          if (pixel === 0) {
            firePixels[srcIdx - width] = 0;
          } else {
            const decay = Math.floor(Math.random() * decayRate);
            const drift = Math.floor(Math.random() * 3) - 1;
            const dstIdx = srcIdx - width + drift;

            if (dstIdx >= 0) {
              firePixels[dstIdx] = Math.max(0, pixel - decay);
            }
          }
        }
      }
      render();
    }

    function getFireColor(intensity: number): string {
      if (intensity <= 120) {
        return 'rgba(255, 255, 255, 0.4)'; // white
      }

      // Above 35, interpolate towards red/yellow
      // At intensity 120, should be fully red/yellow
      const colorProgress = Math.min(intensity - 120, 1);

      // Interpolate from white (255,255,255) to orange-red (255,100,0)
      const r = Math.round(255 - colorProgress * 255); // 255 -> 0
      const g = 0;
      const b = 0;

      return `rgba(${r}, ${g}, ${b}, 0.4)`;
    }

    function render() {
      if (!fireRef.current) return;

      const lines: string[] = [];
      const width = widthRef.current;
      const firePixels = firePixelsRef.current;
      const currentIntensity = currentIntensityRef.current;

      for (let y = 0; y < height; y++) {
        let line = '';
        for (let x = 0; x < width; x++) {
          const pixelIntensity = firePixels[y * width + x];
          if (pixelIntensity === 0) {
            line += ' ';
          } else {
            const charIdx = Math.floor((pixelIntensity / 35) * (charSet.length - 1));
            line += charSet[charIdx];
          }
        }
        lines.push(line);
      }

      // If inverted, reverse the lines so fire appears to burn downward
      if (inverted) {
        lines.reverse();
      }

      fireRef.current.textContent = lines.join('\n');

      // Apply color based on intensity
      fireRef.current.style.color = getFireColor(currentIntensity);
    }

    function animate() {
      step();
      animationFrameRef.current = requestAnimationFrame(animate);
    }

    init();
    animate();

    const handleResize = () => init();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [inverted]);

  return (
    <pre
      ref={fireRef}
      className={`z-50 pointer-events-none fixed left-0 w-full whitespace-pre text-center font-mono text-[10px] leading-[8px] text-white/40 ${inverted ? 'top-0' : 'bottom-0'}`}
      aria-hidden="true"
    />
  );
}
