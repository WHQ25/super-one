import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@superone/shared/agent-types'

/** Coverage changes even when another page only adds collapsed process. */
export function historyEdgeKey(message: ChatMessage | undefined, index: number, edge: 'older' | 'newer'): string | null {
  if (!message) return null
  return JSON.stringify([message.id, index, message.content.length,
    edge === 'older' ? message.metadata?.window?.omittedBefore : message.metadata?.window?.omittedAfter])
}

/** Visible history edges page automatically, including a first paint shorter than the viewport. */
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
      for (const [edge, element, load] of [
        ['older', top.current, next.loadOlder],
        ['newer', bottom.current, next.loadNewer],
      ] as const) {
        const bounds = element?.getBoundingClientRect()
        const visible = bounds && bounds.bottom > 0 && bounds.top < window.innerHeight
        if (!visible) { delete attempted.current[edge]; continue }
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
    const observer = new IntersectionObserver(schedule)
    if (top.current) observer.observe(top.current)
    if (bottom.current) observer.observe(bottom.current)
    window.addEventListener('resize', schedule)
    schedule()
    return () => { clearTimeout(timer); observer.disconnect(); window.removeEventListener('resize', schedule) }
  }, [options.epoch, options.older, options.newer, options.busy])

  return { top, bottom }
}
