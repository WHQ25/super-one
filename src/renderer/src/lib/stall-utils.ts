import { useState, useEffect, useRef } from 'react'
import { useActiveSession } from '@/stores/chat'

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

export function useStallLevel(active: boolean): StallLevel {
  const lastEventAt = useActiveSession((s) => active ? s.lastEventAt : 0)
  const [level, setLevel] = useState<StallLevel>('normal')
  const lastEventAtRef = useRef(lastEventAt)
  lastEventAtRef.current = lastEventAt

  useEffect(() => {
    if (!active) {
      setLevel('normal')
      return
    }
    const tick = () => setLevel(getStallLevel(lastEventAtRef.current))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [active])

  return level
}
