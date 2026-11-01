import { observeElementRect } from '@tanstack/react-virtual'

/** One line plus the row's vertical padding. `measureElement` corrects a wrap or an open child list. */
export const SESSION_ROW_ESTIMATE = 32

/**
 * Active and settled lists share this cap. The viewport inherits it, so the
 * scrollport is the capped box. `overscroll-contain` stops the browser from
 * chaining a wheel into the sidebar on its own; `chainSessionListWheel`
 * forwards that wheel once this viewport is already at the edge, including
 * past a nested list that is also at its edge.
 */
const SESSION_LIST_SCROLL_BEHAVIOR =
  'sidebar-scroll min-h-0 [&_[data-slot=scroll-area-viewport]]:max-h-[inherit] [&_[data-slot=scroll-area-viewport]]:overscroll-contain [&_[data-slot=scroll-area-viewport]>div]:block!'

export const SESSION_LIST_SCROLL_CLASS = `max-h-64 ${SESSION_LIST_SCROLL_BEHAVIOR}`

/** Shorter than the active list, so an expanded parent still fits inside it. */
export const SESSION_CHILD_LIST_SCROLL_CLASS = `max-h-36 ${SESSION_LIST_SCROLL_BEHAVIOR}`

/**
 * jsdom, and the frame before max-height resolves, report a 0px viewport.
 * Mounting the loaded rows keeps that frame from painting an empty list.
 * A laid-out viewport replaces this on the next observation.
 */
const UNMEASURED_VIEWPORT_HEIGHT = 100_000

/**
 * A row with no layout box (jsdom) must keep its estimate. Caching a 0px
 * measure collapses the window and drops the first rows.
 */
export function measureSessionListRow(
  element: HTMLElement,
  entry: ResizeObserverEntry | undefined,
  instance: {
    options: { estimateSize: (index: number) => number; horizontal?: boolean }
    indexFromElement: (node: HTMLElement) => number
  },
): number {
  const box = entry?.borderBoxSize?.[0]
  const measured = box
    ? (instance.options.horizontal ? box.inlineSize : box.blockSize)
    : element[instance.options.horizontal ? 'offsetWidth' : 'offsetHeight']
  if (measured > 0) return measured
  return instance.options.estimateSize(instance.indexFromElement(element))
}

export const observeSessionListRect: typeof observeElementRect = (instance, cb) => {
  return observeElementRect(instance, (rect) => {
    if (rect.height > 0) {
      cb(rect)
      return
    }
    cb({ width: rect.width || 240, height: UNMEASURED_VIEWPORT_HEIGHT })
  })
}

function canScrollY(el: HTMLElement, deltaY: number): boolean {
  const overflow = getComputedStyle(el).overflowY
  if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') return false
  const max = el.scrollHeight - el.clientHeight
  if (max <= 1) return false
  if (deltaY < 0) return el.scrollTop > 0
  return el.scrollTop < max - 1
}

/** The nearest ancestor that can still move in this wheel's direction. */
export function nextVerticalScrollport(start: HTMLElement, deltaY: number): HTMLElement | null {
  let current = start.parentElement
  while (current) {
    if (canScrollY(current, deltaY)) return current
    current = current.parentElement
  }
  return null
}

/**
 * While this list can still scroll, it keeps the wheel. At the top or bottom,
 * the same wheel moves the nearest ancestor that still has room, so a flick
 * continues into the project list instead of stopping dead.
 */
export function chainSessionListWheel(
  viewport: HTMLElement,
  event: { deltaY: number; ctrlKey?: boolean; metaKey?: boolean; stopPropagation: () => void },
): void {
  if (event.deltaY === 0 || event.ctrlKey || event.metaKey) return
  const max = viewport.scrollHeight - viewport.clientHeight
  const atEdge = event.deltaY < 0 ? viewport.scrollTop <= 0 : viewport.scrollTop >= max - 1
  if (!atEdge) {
    event.stopPropagation()
    return
  }
  const parent = nextVerticalScrollport(viewport, event.deltaY)
  if (parent) parent.scrollTop += event.deltaY
  event.stopPropagation()
}
