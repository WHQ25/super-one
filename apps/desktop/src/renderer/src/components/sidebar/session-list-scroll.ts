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
  'sidebar-scroll min-h-0 min-w-0 [&_[data-slot=scroll-area-viewport]]:max-h-[inherit] [&_[data-slot=scroll-area-viewport]]:overscroll-contain [&_[data-slot=scroll-area-viewport]>div]:block!'

/** Tailwind `max-h-64` at the default 16px root. Keep this aligned with that class. */
export const SESSION_LIST_CAP_PX = 256

/** Root rows that fill the cap. A longer loaded list can take leftover pane height. */
export const SESSION_LIST_CAP_ROWS = SESSION_LIST_CAP_PX / SESSION_ROW_ESTIMATE

/** Environment headers and project rows are `h-9`. Session rows stay {@link SESSION_ROW_ESTIMATE}. */
export const MULTI_HOST_CHROME_ROW_PX = 36

export const SESSION_LIST_SCROLL_CLASS = `max-h-64 ${SESSION_LIST_SCROLL_BEHAVIOR}`

/** Shorter than the active list, so an expanded parent still fits inside it. */
export const SESSION_CHILD_LIST_SCROLL_CLASS = `max-h-36 ${SESSION_LIST_SCROLL_BEHAVIOR}`

/** Focus mode: the list is the pane, so it takes the parent's height instead of a cap. */
export const SESSION_LIST_FILL_CLASS = `h-full min-h-0 flex-1 ${SESSION_LIST_SCROLL_BEHAVIOR}`

export interface ProjectFocusListSize {
  environmentId: string
  /** Loaded root rows. `hasMore` means another page already exists past the cap. */
  sessionCount: number
  hasMore?: boolean
}

/**
 * `fill` — the only list, so it is the pane.
 * `cap` — shared `max-h-64`. Every environment already overflows it, or this list is shorter than it.
 * `px` — a long list growing into space the short lists leave, or shrinking so those lists stay on screen.
 */
export type ProjectFocusListMax =
  | { kind: 'fill' }
  | { kind: 'cap' }
  | { kind: 'px'; maxHeight: number }

export interface SessionListMaxOptions {
  /**
   * `fill` (default): one list is the pane, even before it is measured.
   * `stretch`: one long list takes the measured leftover after its heading.
   * An unmeasured or short list stays on the cap.
   */
  loneList?: 'fill' | 'stretch'
  /** One environment heading. The default is one session row. */
  headingPx?: number
  /** Height reserved for each row of a short list. The default is one session row. */
  rowPx?: number
}

const ENVIRONMENT_HEADING_PX = SESSION_ROW_ESTIMATE

function listIsLong(list: ProjectFocusListSize): boolean {
  return list.hasMore === true || list.sessionCount >= SESSION_LIST_CAP_ROWS
}

function pixelCap(maxHeight: number): ProjectFocusListMax {
  if (maxHeight <= 0 || maxHeight === SESSION_LIST_CAP_PX) return { kind: 'cap' }
  return { kind: 'px', maxHeight }
}

/**
 * Max height of each list that shares a pane.
 * The fixed cap stays only when more than one environment already has more
 * rows than that cap. Otherwise a short list keeps the cap (it does not
 * fill it) and a long list takes the pane that remains.
 * Project focus uses the default so the only checkout list is the pane.
 * The unfocused multi-host list stretches that one list under its device header.
 */
export function projectFocusSessionListMaxHeights(
  lists: readonly ProjectFocusListSize[],
  availablePx: number,
  options?: SessionListMaxOptions,
): ProjectFocusListMax[] {
  if (lists.length === 0) return []
  const headingUnit = options?.headingPx ?? ENVIRONMENT_HEADING_PX
  if (lists.length === 1) {
    if (options?.loneList !== 'stretch') return [{ kind: 'fill' }]
    const list = lists[0]!
    if (!listIsLong(list) || !(availablePx > 0)) return [{ kind: 'cap' }]
    return [pixelCap(availablePx - headingUnit)]
  }

  const environments = new Map<string, ProjectFocusListSize[]>()
  for (const list of lists) {
    const group = environments.get(list.environmentId) ?? []
    group.push(list)
    environments.set(list.environmentId, group)
  }
  const overflows = lists.map(listIsLong)
  const everyEnvironmentIsLong = [...environments.values()].every((group) => group.some(listIsLong))
  if (environments.size > 1 && everyEnvironmentIsLong) return lists.map(() => ({ kind: 'cap' }))
  if (!(availablePx > 0)) return lists.map(() => ({ kind: 'cap' }))

  const headingPx = environments.size > 1 ? environments.size * headingUnit : 0
  const rowPx = options?.rowPx ?? SESSION_ROW_ESTIMATE
  const shortPx = lists.reduce((sum, list, index) => (
    overflows[index] ? sum : sum + list.sessionCount * rowPx
  ), 0)
  const longIndexes = overflows.flatMap((overflowsAt, index) => (overflowsAt ? [index] : []))
  const room = Math.max(0, availablePx - headingPx - shortPx)
  if (longIndexes.length === 0 || room <= 0) return lists.map(() => ({ kind: 'cap' }))

  const base = Math.floor(room / longIndexes.length)
  const lastLong = longIndexes[longIndexes.length - 1]
  let used = 0
  return lists.map((_, index) => {
    if (!overflows[index]) return { kind: 'cap' }
    const maxHeight = index === lastLong ? room - used : base
    if (index !== lastLong) used += base
    return pixelCap(maxHeight)
  })
}

export interface MultiHostSectionSize {
  environmentId: string
  /** False when the device is collapsed or offline: only its header remains. */
  open: boolean
  projectCount: number
  /** Expanded projects whose session rows are inside this device's project scroll. */
  sessions: readonly { key: string; sessionCount: number; hasMore?: boolean }[]
}

/**
 * Unfocused multi-host: one project scroll per device, sized like a focused
 * checkout list. Session lists inside a device grow into that device's share.
 * They stay on the shared cap when fitting sibling projects would shrink them
 * below it; the device scroll still reaches those projects, and the other
 * device stays on screen because the device scroll itself is capped.
 */
export function multiHostProjectListMaxHeights(
  sections: readonly MultiHostSectionSize[],
  paneHeight: number,
): { projects: Map<string, ProjectFocusListMax>; sessions: Map<string, number> } {
  const lists = sections.map((section) => {
    if (!section.open) return { environmentId: section.environmentId, sessionCount: 0 }
    const sessionRows = section.sessions.reduce((sum, list) => sum + list.sessionCount, 0)
    const hasMore = section.sessions.some((list) => list.hasMore === true)
    const sessionCount = section.projectCount === 0 ? 1 : section.projectCount + sessionRows
    return { environmentId: section.environmentId, sessionCount, hasMore }
  })
  const heights = projectFocusSessionListMaxHeights(lists, paneHeight, {
    loneList: 'stretch',
    headingPx: MULTI_HOST_CHROME_ROW_PX,
    rowPx: MULTI_HOST_CHROME_ROW_PX,
  })
  const projects = new Map(sections.map((section, index) => [section.environmentId, heights[index]!]))
  const sessions = new Map<string, number>()
  sections.forEach((section, index) => {
    const max = heights[index]
    if (!max || max.kind !== 'px' || section.sessions.length === 0) return
    const room = max.maxHeight - section.projectCount * MULTI_HOST_CHROME_ROW_PX
    if (room <= 0) return
    const sessionHeights = projectFocusSessionListMaxHeights(
      section.sessions.map((list) => ({
        environmentId: section.environmentId,
        sessionCount: list.sessionCount,
        hasMore: list.hasMore,
      })),
      room,
      { loneList: 'stretch', headingPx: 0 },
    )
    section.sessions.forEach((list, sessionIndex) => {
      const height = sessionHeights[sessionIndex]
      if (height?.kind !== 'px') return
      const growing = height.maxHeight > SESSION_LIST_CAP_PX
      const shrinkingWithDevice = max.maxHeight < SESSION_LIST_CAP_PX
      if (growing || shrinkingWithDevice) sessions.set(list.key, height.maxHeight)
    })
  })
  return { projects, sessions }
}

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
