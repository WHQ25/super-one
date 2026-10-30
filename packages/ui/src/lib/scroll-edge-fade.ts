/**
 * Scroll-edge fade (`scroll-edge-fade-x` / `scroll-edge-fade-y` in
 * animations.css).
 *
 * At the end of the scroll range the timeline finishes on the 100% keyframe,
 * which is the leading-edge fade. Chromium then keeps that finished time after
 * the range collapses to zero, so the leading fade stays painted when nothing
 * is hidden (https://issues.chromium.org/issues/40947711). Restarting the
 * animation drops the finished time. An inactive timeline leaves both fades at
 * their 0px initial value, and a later overflow drives the timeline again.
 *
 * `inline` is the horizontal fade. `block` is the vertical one. A fitting
 * cross-axis must not clear the fade that still has something to hide.
 */
export type ScrollEdgeAxis = 'inline' | 'block'

function scrollAxisOverflows(scroller: HTMLElement, axis: ScrollEdgeAxis): boolean {
  return axis === 'block'
    ? scroller.scrollHeight > scroller.clientHeight
    : scroller.scrollWidth > scroller.clientWidth
}

export function releaseFinishedScrollEdgeFade(
  scroller: HTMLElement,
  axis: ScrollEdgeAxis = 'inline',
): void {
  if (scrollAxisOverflows(scroller, axis)) return
  if (typeof scroller.getAnimations !== 'function') return
  if (!scroller.getAnimations().some((animation) => animation.playState === 'finished')) return
  const previous = scroller.style.animationName
  scroller.style.animationName = 'none'
  // Flush style so the finished scroll timeline is discarded before the
  // stylesheet animation is attached again. Without this read, Chromium
  // restores the same finished time.
  void scroller.offsetWidth
  scroller.style.animationName = previous
}

/** The scroll box around a chat markdown table. Matches the mask in chat-md.css. */
export const TABLE_SCROLL_EDGE_SELECTOR =
  '[data-streamdown="table-wrapper"] > div:has(> [data-streamdown="table"])'

/** Watches one scroll box for its overflow range collapsing. */
export function watchScrollEdgeFade(
  scroller: HTMLElement,
  axis: ScrollEdgeAxis = 'inline',
): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  const release = () => releaseFinishedScrollEdgeFade(scroller, axis)
  const resizeObserver = new ResizeObserver(release)
  resizeObserver.observe(scroller)
  const observeChildren = () => {
    for (const child of scroller.children) {
      if (child instanceof HTMLElement) resizeObserver.observe(child)
    }
  }
  observeChildren()
  const mutations = new MutationObserver(() => {
    observeChildren()
    release()
  })
  mutations.observe(scroller, { childList: true })
  release()
  return () => {
    mutations.disconnect()
    resizeObserver.disconnect()
  }
}

/** Finds every matching scroll box under `root` and drops ones that have left the document. */
export function watchScrollEdgeFades(root: ParentNode, selector: string): { scan: () => void; stop: () => void } {
  const watched = new Map<HTMLElement, () => void>()
  const scan = () => {
    for (const node of root.querySelectorAll<HTMLElement>(selector)) {
      if (!watched.has(node)) watched.set(node, watchScrollEdgeFade(node))
    }
    for (const [scroller, stop] of watched) {
      if (!scroller.isConnected) {
        stop()
        watched.delete(scroller)
      }
    }
  }
  return {
    scan,
    stop: () => {
      for (const stop of watched.values()) stop()
      watched.clear()
    },
  }
}

function addedScroller(records: MutationRecord[], selector: string): boolean {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue
      if (node.matches(selector) || node.querySelector(selector)) return true
    }
  }
  return false
}

function removedElement(records: MutationRecord[]): boolean {
  for (const record of records) {
    for (const node of record.removedNodes) {
      if (node instanceof Element) return true
    }
  }
  return false
}

/**
 * Keeps the fade repair attached as matching scroll boxes appear and leave.
 * Text-only streaming does not scan; a new table, or an element leaving, does.
 */
export function bindScrollEdgeFades(root: HTMLElement, selector: string): () => void {
  const fades = watchScrollEdgeFades(root, selector)
  const mutations = new MutationObserver((records) => {
    if (removedElement(records) || addedScroller(records, selector)) fades.scan()
  })
  mutations.observe(root, { childList: true, subtree: true })
  fades.scan()
  return () => {
    mutations.disconnect()
    fades.stop()
  }
}
