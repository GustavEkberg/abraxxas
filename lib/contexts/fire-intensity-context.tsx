'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

interface RunningTask {
  id: string;
  startedAt: number;
  messageCount?: number;
}

interface RunningManifest {
  id: string;
  startedAt: number;
}

interface FireIntensityContextValue {
  intensity: number;
  addRunningTask: (taskId: string, messageCount?: number) => void;
  removeRunningTask: (taskId: string) => void;
  updateTaskMessages: (taskId: string, messageCount: number) => void;
  runningTasks: RunningTask[];
  addRunningManifest: (manifestId: string) => void;
  removeRunningManifest: (manifestId: string) => void;
  runningManifests: RunningManifest[];
  hasRunningManifest: boolean;
}

const FireIntensityContext = createContext<FireIntensityContextValue | null>(null);

/**
 * Calculate fire intensity based on running tasks and manifests.
 *
 * Both use same formula:
 * - Base intensity: 10
 * - Message bonus (tasks only): +1 per message (up to max 10)
 * - Time bonus: +1 per 30 seconds (up to max 15)
 *
 * Intensity can exceed 35, triggering color changes above threshold.
 */
function calculateIntensity(tasks: RunningTask[], manifests: RunningManifest[]): number {
  if (tasks.length === 0 && manifests.length === 0) return 5;

  const now = Date.now();
  const baseIntensity = 5;
  const messageBonus = (messageCount: number) => Math.min(messageCount, 10);
  const timeBonus = (elapsed: number) => Math.min(Math.floor(elapsed / 30000), 15);

  const taskIntensity = tasks.reduce((sum, task) => {
    const elapsed = now - task.startedAt;
    const msgBonus = messageBonus(task.messageCount ?? 0);
    return sum + baseIntensity + msgBonus + timeBonus(elapsed);
  }, 0);

  const manifestIntensity = manifests.reduce((sum, manifest) => {
    const elapsed = now - manifest.startedAt;
    return sum + baseIntensity + timeBonus(elapsed);
  }, 0);

  return taskIntensity + manifestIntensity;
}

export function FireIntensityProvider({ children }: { children: ReactNode; }) {
  const [runningTasks, setRunningTasks] = useState<RunningTask[]>([]);
  const [runningManifests, setRunningManifests] = useState<RunningManifest[]>([]);
  const [intensity, setIntensity] = useState(calculateIntensity(runningTasks, runningManifests));

  const addRunningTask = useCallback((taskId: string, messageCount?: number) => {
    setRunningTasks(prev => {
      if (prev.some(t => t.id === taskId)) return prev;
      return [...prev, { id: taskId, startedAt: Date.now(), messageCount }];
    });
  }, []);

  const removeRunningTask = useCallback((taskId: string) => {
    setRunningTasks(prev => prev.filter(t => t.id !== taskId));
  }, []);

  const updateTaskMessages = useCallback((taskId: string, messageCount: number) => {
    setRunningTasks(prev => prev.map(t => (t.id === taskId ? { ...t, messageCount } : t)));
  }, []);

  const addRunningManifest = useCallback((manifestId: string) => {
    setRunningManifests(prev => {
      if (prev.some(m => m.id === manifestId)) return prev;
      return [...prev, { id: manifestId, startedAt: Date.now() }];
    });
  }, []);

  const removeRunningManifest = useCallback((manifestId: string) => {
    setRunningManifests(prev => prev.filter(m => m.id !== manifestId));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setIntensity(calculateIntensity(runningTasks, runningManifests));
    }, 1000);

    return () => clearInterval(interval);
  }, [runningTasks, runningManifests]);

  return (
    <FireIntensityContext.Provider
      value={{
        intensity,
        addRunningTask,
        removeRunningTask,
        updateTaskMessages,
        runningTasks,
        addRunningManifest,
        removeRunningManifest,
        runningManifests,
        hasRunningManifest: runningManifests.length > 0
      }}
    >
      {children}
    </FireIntensityContext.Provider>
  );
}

export function useFireIntensity() {
  const context = useContext(FireIntensityContext);
  if (!context) {
    throw new Error('useFireIntensity must be used within FireIntensityProvider');
  }
  return context;
}
