import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@superone/shared/agent-types'

/** Coverage changes even when another page only adds collapsed process. */
export function historyEdgeKey(message: ChatMessage | undefined, index: number, edge: 'older' | 'newer'): string | null {
  if (!message) return null
  return JSON.stringify([message.id, index, message.content.length,
    edge === 'older' ? message.metadata?.window?.omittedBefore : message.metadata?.window?.omittedAfter])
}

/** How far past the viewport, in screens, an edge starts paging so the reader rarely reaches it. */
const PREFETCH_SCREENS = 1

function withinReach(element: HTMLElement | null, margin: number): boolean {
  const bounds = element?.getBoundingClientRect()
  return !!bounds && bounds.bottom > -margin && bounds.top < window.innerHeight + margin
}

/** History edges near the viewport page automatically, including a first paint shorter than the viewport. */
export function useHistoryEdges(options: {
  epoch: number
  older: string | null
  newer: string | null
  busy: boolean
  notBefore: () => number
  loadOlder: () => void
  loadNewer: () => void
}) {
  const top = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const current = useRef(options)
  current.current = options
  const attempted = useRef<{ epoch: number; older?: string; newer?: string }>({ epoch: options.epoch })
  if (attempted.current.epoch !== options.epoch) attempted.current = { epoch: options.epoch }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      const next = current.current
      if (next.busy) return
      const wait = next.notBefore() - performance.now()
      if (wait > 0) { timer = setTimeout(check, wait); return }
      const edges = [
        ['older', top.current, next.loadOlder],
        ['newer', bottom.current, next.loadNewer],
      ] as const
      // With both ends in prefetch reach, each page would trim the other end
      // out of the mounted window and back in again; only a visible end pages.
      const prefetch = window.innerHeight * PREFETCH_SCREENS
      const margin = edges.every(([, element]) => withinReach(element, prefetch)) ? 0 : prefetch
      for (const [edge, element, load] of edges) {
        if (!withinReach(element, margin)) { delete attempted.current[edge]; continue }
        const key = next[edge]
        if (!key || attempted.current[edge] === key) continue
        // Retry on another edge visit or a gesture, not every failed/no-op render.
        attempted.current[edge] = key
        load()
        break
      }
    }
    // Let scroll anchoring and the mounted-window cooldown settle first.
    const schedule = () => { clearTimeout(timer); timer = setTimeout(check, 80) }
    // One observer per margin `check` can use: the prefetch reach and the viewport.
    const observers = [{ rootMargin: `${PREFETCH_SCREENS * 100}% 0px` }, {}]
      .map(init => new IntersectionObserver(schedule, init))
    for (const observer of observers) {
      if (top.current) observer.observe(top.current)
      if (bottom.current) observer.observe(bottom.current)
    }
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      clearTimeout(timer)
      for (const observer of observers) observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [options.epoch, options.older, options.newer, options.busy])

  return { top, bottom }
}
