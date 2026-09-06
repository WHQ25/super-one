import { useState, useEffect, useRef } from 'react'
import { useChatStore } from '@/stores/chat'
import type { StallLevel } from '@superone/chat-view/presenters/stall-color'

export { getStallColor, type StallLevel } from '@superone/chat-view/presenters/stall-color'

const STALL_WARNING_MS = 60_000
const STALL_CRITICAL_MS = 120_000

/** Mirrors the `transition-colors duration-500` the stall titles carry, plus a
 *  frame of slack, so the repaint remount lands after the color has settled. */
const STALL_COLOR_SETTLE_MS = 560

export function getStallLevel(lastEventAt: number): StallLevel {
  if (!lastEventAt) return 'normal'
  const gap = Date.now() - lastEventAt
  if (gap >= STALL_CRITICAL_MS) return 'critical'
  if (gap >= STALL_WARNING_MS) return 'warning'
  return 'normal'
}

/**
 * Chromium never repaints the `text-overflow: ellipsis` glyph on a color-only
 * style change: the drawn "…" keeps whatever color it was first painted with
 * until something else invalidates that region (hovering the row, a screenshot
 * capture). A session that stalls red and then recovers therefore renders white
 * text with a red "…" — the mismatch the sidebar showed.
 *
 * Feed this to React's `key` on the element that owns the truncation, so the
 * node is recreated whenever the stall color changes. A fresh layout object is
 * always painted from scratch, which is the only fix that does not depend on
 * Blink's paint-invalidation heuristics.
 *
 * The delayed half matters when the color is *animated*: the stall title carries
 * `transition-colors duration-500`, so at the instant the class changes the
 * painted color is still the old one. Remounting only then re-paints the "…"
 * red again and the transition slides the rest of the text to white behind it —
 * the original bug, one repaint later. So the key also flips once the transition
 * has settled, when the computed color has actually reached its target.
 */
export function useEllipsisRepaintKey(colorClassName: string): string {
  const [settled, setSettled] = useState(colorClassName)

  useEffect(() => {
    if (settled === colorClassName) return
    const id = setTimeout(() => setSettled(colorClassName), STALL_COLOR_SETTLE_MS)
    return () => clearTimeout(id)
  }, [colorClassName, settled])

  return `${colorClassName}|${settled}`
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
