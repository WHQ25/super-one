import { useState, useEffect, useRef } from 'react'
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

export function getStallColor(level: StallLevel, normalColor = 'text-muted-foreground'): string {
  if (level === 'critical') return 'text-red-500'
  if (level === 'warning') return 'text-amber-500'
  return normalColor
}

function readActiveLastEventAt(): number {
  const state = useChatStore.getState()
  const project = state.activeProject ? state.projectSessions[state.activeProject] : null
  const session = project?._activeSessionId ? project._sessions[project._activeSessionId] : null
  return session?.lastEventAt ?? 0
}

/**
 * `lastEventAt` may be a plain number or a getter. Prefer the getter when the
 * caller renders per session (e.g. a sidebar row): `lastEventAt` is rewritten on
 * every content delta, so *subscribing* to it re-renders the caller at stream
 * frequency, while this hook only needs the value once per second.
 */
export function useStallLevel(active: boolean, lastEventAt?: number | (() => number)): StallLevel {
  const [level, setLevel] = useState<StallLevel>('normal')
  const lastEventAtRef = useRef(lastEventAt)
  lastEventAtRef.current = lastEventAt

  useEffect(() => {
    if (!active) {
      setLevel('normal')
      return
    }
    const tick = (): void => {
      const source = lastEventAtRef.current
      const ts = typeof source === 'function'
        ? source()
        : source !== undefined
          ? source
          : readActiveLastEventAt()
      setLevel(getStallLevel(ts))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [active])

  return level
}
