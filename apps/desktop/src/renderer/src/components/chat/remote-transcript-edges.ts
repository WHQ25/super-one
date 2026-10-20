/** A vertical slice of a transcript edge or its scrollport. */
export interface HistoryEdgeRect {
  top: number
  bottom: number
}

export interface HistoryEdgeAttempt {
  older?: string
  newer?: string
}

const DEFAULT_PREFETCH_SCREENS = 1

function inReach(edge: HistoryEdgeRect | null, root: HistoryEdgeRect, margin: number): boolean {
  return !!edge && edge.bottom > root.top - margin && edge.top < root.bottom + margin
}

/**
 * Which history edge to page, matching the phone transcript.
 *
 * An edge within one screen of the scrollport loads. When both edges sit in
 * that band, only an edge actually inside the scrollport loads, so a short
 * window cannot pull the opposite page back in on every check. An edge that
 * has left the band drops its attempt, so coming back retries a failed page.
 */
export function planHistoryEdges(input: {
  root: HistoryEdgeRect
  top: HistoryEdgeRect | null
  bottom: HistoryEdgeRect | null
  older: string | null
  newer: string | null
  attempted: HistoryEdgeAttempt
  prefetchScreens?: number
}): { load: 'older' | 'newer' | null; drop: Array<'older' | 'newer'> } {
  const height = Math.max(0, input.root.bottom - input.root.top)
  const prefetch = height * (input.prefetchScreens ?? DEFAULT_PREFETCH_SCREENS)
  const margin = inReach(input.top, input.root, prefetch) && inReach(input.bottom, input.root, prefetch)
    ? 0
    : prefetch
  const drop: Array<'older' | 'newer'> = []
  const edges = [
    ['older', input.top, input.older],
    ['newer', input.bottom, input.newer],
  ] as const
  for (const [name, rect, key] of edges) {
    if (!inReach(rect, input.root, margin)) {
      drop.push(name)
      continue
    }
    if (!key || input.attempted[name] === key) continue
    return { load: name, drop }
  }
  return { load: null, drop }
}

/** The transcript scrollport, including a scroll area that has not overflowed yet. */
export function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node.dataset.slot === 'scroll-area-viewport' || node.hasAttribute('data-radix-scroll-area-viewport')) return node
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return node
  }
  return null
}
