import { createContext, useContext, useEffect, useId, useMemo, useRef, type ReactNode } from 'react'

/**
 * Which rows inside one surface currently have their swipe actions showing.
 *
 * It exists so a container's own horizontal gesture can stand down while a row
 * is open. In the workspace drawer that is the difference between two readings
 * of the same leftward drag: with a row open the user is putting that row back,
 * not closing the drawer — and the drawer is the ancestor, so without this it
 * can only guess.
 *
 * Ref-backed rather than state: the sole consumer is a gesture predicate, and
 * re-rendering a whole panel of rows for a boolean nobody paints is pure cost.
 */
export type SwipeRevealScope = {
  report: (rowId: string, revealed: boolean) => void
  anyRevealed: () => boolean
}

const SwipeRevealContext = createContext<SwipeRevealScope | null>(null)

/** Created by the container that also owns the competing gesture. */
export function useSwipeRevealScope(): SwipeRevealScope {
  const revealed = useRef<Set<string>>(new Set())
  return useMemo(() => ({
    report: (rowId, open) => { if (open) revealed.current.add(rowId); else revealed.current.delete(rowId) },
    anyRevealed: () => revealed.current.size > 0,
  }), [])
}

export function SwipeRevealProvider({ scope, children }: { scope: SwipeRevealScope; children: ReactNode }) {
  return <SwipeRevealContext.Provider value={scope}>{children}</SwipeRevealContext.Provider>
}

/**
 * Reports this row's reveal state to the surrounding scope, if there is one — a
 * list outside any scope (the tablet sidebar) gets a no-op rather than a rule
 * about where it may be mounted.
 */
export function useReportSwipeReveal(): (revealed: boolean) => void {
  const scope = useContext(SwipeRevealContext)
  const rowId = useId()
  // A row unmounted while open would otherwise hold the scope open forever, and
  // the container's gesture would never come back.
  useEffect(() => () => scope?.report(rowId, false), [rowId, scope])
  return useMemo(() => (revealed: boolean) => scope?.report(rowId, revealed), [rowId, scope])
}
