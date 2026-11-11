import { observeElementRect } from '@tanstack/react-virtual'

/** One line plus the row's vertical padding. `measureElement` corrects a wrap or an open child list. */
export const SESSION_ROW_ESTIMATE = 32

/**
 * Active and settled lists share this cap. The viewport inherits it, so the
 * scrollport is the capped box. `overscroll-contain` stops the browser from
 * chaining a wheel into the sidebar on its own; `chainSessionListWheel`
 * forwards that wheel once this viewport is already at the edge, including
 * past a nested list that is also at its edge. A new max height eases in with
 * the same 120ms as `SidebarCollapse`.
 */
const SESSION_LIST_SCROLL_BEHAVIOR =
  'sidebar-scroll min-h-0 min-w-0 transition-[max-height] duration-[120ms] ease-out motion-reduce:transition-none [&_[data-slot=scroll-area-viewport]]:max-h-[inherit] [&_[data-slot=scroll-area-viewport]]:overscroll-contain [&_[data-slot=scroll-area-viewport]>div]:block!'

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
 * The only checkout list is the pane.
 */
export function projectFocusSessionListMaxHeights(
  lists: readonly ProjectFocusListSize[],
  availablePx: number,
): ProjectFocusListMax[] {
  if (lists.length === 0) return []
  if (lists.length === 1) return [{ kind: 'fill' }]

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

  const headingPx = environments.size > 1 ? environments.size * ENVIRONMENT_HEADING_PX : 0
  const shortPx = lists.reduce((sum, list, index) => (
    overflows[index] ? sum : sum + list.sessionCount * SESSION_ROW_ESTIMATE
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

export interface MultiHostSectionMeasure {
  /** Device content outside its active session lists: project rows, attention rows, Settled. */
  fixedPx: number
  /** Full content height of each mounted active session list, keyed by project path. */
  sessions: readonly { key: string; contentPx: number }[]
}

export interface MultiHostSectionSize extends MultiHostSectionMeasure {
  environmentId: string
  /** False when the device is collapsed or offline: only its header remains. */
  open: boolean
}

function shareRoom(demands: readonly number[], room: number): number[] {
  const shares = demands.map((demand) => Math.min(demand, SESSION_LIST_CAP_PX))
  let left = Math.max(0, room - shares.reduce((sum, share) => sum + share, 0))
  const need = (index: number) => demands[index]! - shares[index]!
  const order = demands.map((_, index) => index).sort((a, b) => need(a) - need(b))
  order.forEach((index, rank) => {
    const even = rank === order.length - 1 ? left : Math.floor(left / (order.length - rank))
    const given = Math.min(need(index), even)
    shares[index] = shares[index]! + given
    left -= given
  })
  const cut = demands.map((demand, index) => shares[index]! < demand)
  const level = Math.max(0, ...shares.filter((_, index) => cut[index]))
  return shares.map((share, index) => (cut[index] ? share : Math.max(level, share + left)))
}

function sectionDemand(section: MultiHostSectionMeasure): number {
  return section.sessions.reduce((sum, list) => sum + list.contentPx, section.fixedPx)
}

/**
 * Unfocused multi-host: one project scroll per device, sized from measured
 * content. Every device first takes what it needs up to the shared cap. Any
 * room left goes to the devices that still overflow: each round fills the
 * smallest remaining need evenly, or splits the rest evenly when it cannot.
 * Session lists inside a device share that device's height the same way, so
 * none shrinks below the cap to fit sibling projects; the device scroll still
 * reaches those projects.
 */
export function multiHostProjectListMaxHeights(
  sections: readonly MultiHostSectionSize[],
  paneHeight: number,
): { projects: Map<string, ProjectFocusListMax>; sessions: Map<string, number> } {
  const projects = new Map<string, ProjectFocusListMax>(sections.map((section) => [section.environmentId, { kind: 'cap' }]))
  const sessions = new Map<string, number>()
  if (!(paneHeight > 0)) return { projects, sessions }
  const open = sections.filter((section) => section.open)
  const devices = shareRoom(open.map(sectionDemand), paneHeight - sections.length * MULTI_HOST_CHROME_ROW_PX)
  open.forEach((section, index) => {
    const device = devices[index]!
    projects.set(section.environmentId, pixelCap(device))
    const lists = shareRoom(section.sessions.map((list) => list.contentPx), device - section.fixedPx)
    section.sessions.forEach((list, listIndex) => {
      const maxHeight = lists[listIndex]!
      if (maxHeight > SESSION_LIST_CAP_PX) sessions.set(list.key, maxHeight)
    })
  })
  return { projects, sessions }
}

function scrollContent(scrollArea: Element): HTMLElement | null {
  return scrollArea.querySelector<HTMLElement>(':scope > [data-slot="scroll-area-viewport"] > *')
}

export function measureMultiHostSections(
  root: HTMLElement,
  track: (element: Element) => void,
): Map<string, MultiHostSectionMeasure> {
  const sizes = new Map<string, MultiHostSectionMeasure>()
  for (const list of root.querySelectorAll('[data-environment-id] [data-environment-project-list]')) {
    const environmentId = list.closest('[data-environment-id]')?.getAttribute('data-environment-id')
    const content = scrollContent(list)
    if (!environmentId || !content) continue
    track(content)
    let boxesPx = 0
    const sessions: { key: string; contentPx: number }[] = []
    for (const active of content.querySelectorAll('[data-active-session-list]')) {
      const key = active.closest('[data-project-key]')?.getAttribute('data-project-key')
      const inner = scrollContent(active)
      if (!key || !inner) continue
      track(inner)
      boxesPx += active.getBoundingClientRect().height
      sessions.push({ key, contentPx: Math.ceil(inner.getBoundingClientRect().height) })
    }
    sizes.set(environmentId, { fixedPx: Math.ceil(content.getBoundingClientRect().height - boxesPx), sessions })
  }
  return sizes
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
