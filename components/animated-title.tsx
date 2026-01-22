'use client';

import { useEffect, useRef } from 'react';
import { useFireIntensity } from '@/lib/contexts/fire-intensity-context';

const BASE_INTENSITY = 5;
const BASE_TITLE = 'ἀβραξάς';
const fireChars = ' .:-=+*#%@';

/**
 * Animated ASCII fire in browser tab title.
 * Only animates when fire intensity exceeds base value (5).
 */
export function AnimatedTitle() {
  const { intensity } = useFireIntensity();
  const fireRef = useRef<number[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const isActive = intensity > BASE_INTENSITY;

    if (!isActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.title = BASE_TITLE;
      return;
    }

    // Already animating
    if (intervalRef.current) return;

    const width = 6;
    fireRef.current = new Array(width).fill(0);

    function step() {
      const fire = fireRef.current;

      for (let i = 0; i < width - 1; i++) {
        fire[i] = fire[i + 1];
      }

      fire[width - 1] = Math.floor(Math.random() * fireChars.length);

      for (let i = 1; i < width - 1; i++) {
        const avg = (fire[i - 1] + fire[i] + fire[i + 1]) / 3;
        fire[i] = Math.round(avg + (Math.random() - 0.5) * 2);
        fire[i] = Math.max(0, Math.min(fireChars.length - 1, fire[i]));
      }
    }

    function render() {
      const fireStr = fireRef.current
        .map(i => fireChars[Math.max(0, Math.min(i, fireChars.length - 1))])
        .join('');
      document.title = `${fireStr} ${BASE_TITLE} ${fireStr}`;
    }

    for (let i = 0; i < 5; i++) step();
    render();

    intervalRef.current = setInterval(() => {
      step();
      render();
    }, 200);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.title = BASE_TITLE;
    };
  }, [intensity]);

  return null;
}
