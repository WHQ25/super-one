import { useState, useEffect } from 'react'
import { useChatStore } from '@/stores/chat'

export type StallLevel = 'normal' | 'warning' | 'critical'

const STALL_WARNING_MS = 60_000
const STALL_CRITICAL_MS = 120_000

export function getStallLevel(lastEventAt: number): StallLevel {
  if (!lastEventAt) return 'normal'
  const gap = Date.now() - lastEventAt
  if (gap >= STALL_CRITICAL_MS) return 'critical'
  if (gap >= STALL_WARNING_MS) return 'warning'
  return 'normal'
}

export function getStallColor(level: StallLevel): string {
  if (level === 'critical') return 'text-red-500'
  if (level === 'warning') return 'text-amber-500'
  return 'text-muted-foreground'
}

function readActiveLastEventAt(): number {
  const state = useChatStore.getState()
  const project = state.activeProject ? state.projectSessions[state.activeProject] : null
  const session = project?._activeSessionId ? project._sessions[project._activeSessionId] : null
  return session?.lastEventAt ?? 0
}

export function useStallLevel(active: boolean): StallLevel {
  const [level, setLevel] = useState<StallLevel>('normal')

  useEffect(() => {
    if (!active) {
      setLevel('normal')
      return
    }
    const tick = (): void => setLevel(getStallLevel(readActiveLastEventAt()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [active])

  return level
}
