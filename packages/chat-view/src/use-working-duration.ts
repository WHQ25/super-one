import { useEffect, useState } from 'react'

/**
 * Milliseconds elapsed since `since`, ticking once a second while `since` is set
 * and `paused` is false. Returns 0 when there is nothing to time. Every "working
 * for …" label shares this so the cadence and the parsing of the timestamp stay
 * identical across surfaces.
 */
export function useWorkingDuration(since: string | number | undefined | null, paused = false): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === undefined || since === null || paused) return
    const tick = () => setNow(Date.now())
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [paused, since])
  const parsed = typeof since === 'string' ? new Date(since).getTime() : since
  return parsed !== undefined && parsed !== null && Number.isFinite(parsed) ? Math.max(0, now - parsed) : 0
}
