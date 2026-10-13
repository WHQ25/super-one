import type { Virtualizer } from '@tanstack/react-virtual'
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useTranscriptState } from '@superone/ui/lib/transcript-state'
import { useVirtualTranscript } from './virtual-transcript-context'

export interface EdgeMargins { top: number; bottom: number }

/** Adjoining margins combine as CSS collapses them: the largest positive plus the most negative. */
const collapse = (margins: number[]) => Math.max(0, ...margins) + Math.min(0, ...margins)

function edgeMargin(element: Element, edge: 'top' | 'bottom'): number {
  const margins: number[] = []
  for (let node: Element | null = element; node; node = edge === 'top' ? node.firstElementChild : node.lastElementChild) {
    const style = getComputedStyle(node)
    margins.push(parseFloat(edge === 'top' ? style.marginTop : style.marginBottom) || 0)
    // A child's margin passes through a plain block edge without padding or border.
    const plain = (style.display === 'block' || style.display === 'list-item')
      && style.overflow === 'visible' && style.float === 'none'
      && style.position !== 'absolute' && style.position !== 'fixed'
      && !parseFloat(edge === 'top' ? style.paddingTop : style.paddingBottom)
      && !parseFloat(edge === 'top' ? style.borderTopWidth : style.borderBottomWidth)
    if (!plain) break
  }
  return collapse(margins)
}

/**
 * The margins a block hands its neighbours: its own and those its content collapses
 * through its edges. A placeholder carrying them lays out like the mounted content,
 * so a virtual block keeps the spacing its content has outside a transcript.
 */
export function collapsedMargins(element: HTMLElement): EdgeMargins {
  return { top: edgeMargin(element, 'top'), bottom: edgeMargin(element, 'bottom') }
}

/**
 * A virtual block's wrapper stays out of margin collapsing while mounted, so its
 * content spaces like unwrapped content. The placeholder that replaces it carries
 * the margins the content gave away; `capture` reads them before eviction.
 */
export function usePlaceholderMargins(name: string, visible: boolean) {
  const [margins, setMargins] = useTranscriptState<EdgeMargins | null>(name, null)
  const measured = useRef(margins)
  const capture = useCallback((node: HTMLElement) => {
    if (node.firstElementChild) measured.current = collapsedMargins(node)
  }, [])
  useLayoutEffect(() => {
    if (visible) return
    setMargins(previous => previous?.top === measured.current?.top && previous?.bottom === measured.current?.bottom ? previous : measured.current)
  }, [visible, setMargins])
  return { capture, style: visible || !margins ? undefined : { marginTop: margins.top, marginBottom: margins.bottom } }
}

/**
 * Where the content after a block starts, relative to its row. A reveal moves it by
 * the block's height change and by any change in margins the block collapses with.
 */
function followerTop(element: HTMLElement, row: HTMLElement): number {
  const top = row.getBoundingClientRect().top
  for (let node: Element | null = element; node && node !== row; node = node.parentElement) {
    for (let next = node.nextElementSibling; next; next = next.nextElementSibling) {
      const { display, position } = getComputedStyle(next)
      if (display === 'none' || position === 'absolute' || position === 'fixed') continue
      return next.getBoundingClientRect().top - top
    }
  }
  return row.getBoundingClientRect().height
}

/** Reveal geometry belongs to the transcript, so sibling/nested blocks share one correction. */
export function createVirtualBlockAnchor(
  viewportRef: RefObject<HTMLDivElement | null>,
  virtualizerRef: RefObject<Virtualizer<HTMLDivElement, Element>>,
) {
  const pending = new Map<HTMLElement, { height: number; row: HTMLElement; end?: number; follower?: number }>()
  let prepared = new WeakMap<HTMLElement, { height: number; end: number; follower: number }>()
  let generation = 0

  const flush = () => {
    const changes = new Map(pending)
    pending.clear()
    const viewport = viewportRef.current
    if (!viewport) return
    const rows = new Set<HTMLElement>()
    // The lowest snapshotted reveal per row: what follows it has moved by every reveal above.
    const lowest = new Map<HTMLElement, [HTMLElement, number, number]>()
    let delta = 0
    for (const [element, previous] of changes) {
      if (!element.isConnected || !viewport.contains(element)) continue
      // An ancestor's measurement already includes its children's size changes.
      let ancestor = element.parentElement
      while (ancestor && !changes.has(ancestor)) ancestor = ancestor.parentElement
      if (ancestor) continue
      rows.add(previous.row)
      if (previous.follower === undefined || previous.end === undefined) {
        delta += element.getBoundingClientRect().height - previous.height
        continue
      }
      const current = lowest.get(previous.row)
      if (!current || previous.end > current[1]) lowest.set(previous.row, [element, previous.end, previous.follower])
    }
    for (const [row, [element, , follower]] of lowest) delta += followerTop(element, row) - follower
    if (Math.abs(delta) < 0.01) return

    const instance = virtualizerRef.current
    const scrollTop = viewport.scrollTop
    const offset = instance.scrollOffset ?? scrollTop
    // Grow/shrink the list's sizer before writing scrollTop, or the browser can
    // clamp to the old scrollHeight. Commit both in this pre-paint microtask.
    flushSync(() => {
      for (const row of rows) instance.measureElement(row)
    })
    // Measuring newly mounted rows can also invoke the list's own compensation.
    const rowAdjustment = (instance.scrollOffset ?? offset) - offset
    viewport.scrollTop = scrollTop + delta + rowAdjustment
  }

  return {
    prepare(element: HTMLElement) {
      const row = element.closest<HTMLElement>('[data-virtual-row]')
      if (!row || element.firstElementChild) return
      const box = element.getBoundingClientRect()
      // Snapshot before any sibling reveals. A large preceding block can push
      // this block below the fold during the same commit; its old end still
      // determines which height changes displaced the reading anchor.
      prepared.set(element, { height: box.height, end: box.bottom - row.getBoundingClientRect().top, follower: followerTop(element, row) })
    },
    preserve(element: HTMLElement, height: number) {
      const previous = prepared.get(element)
      prepared.delete(element)
      const viewport = viewportRef.current
      const row = element.closest<HTMLElement>('[data-virtual-row]')
      // Small lists keep native browser anchoring; virtual rows opt out of it.
      if (!viewport || !row) return
      const instance = virtualizerRef.current
      const index = Number(row.dataset.index)
      const item = instance.measurementsCache[index]
      const offset = instance.scrollOffset ?? viewport.scrollTop
      // First/fully-above-row measurements and bottom following belong to the
      // outer virtualizer. Only a measured row spanning the fold needs help.
      if (!item || !instance.itemSizeCache.has(item.key) || item.end < offset
        || viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= instance.options.scrollEndThreshold) return
      const box = element.getBoundingClientRect()
      const above = previous ? item.start + previous.end <= offset : box.top + height <= viewport.getBoundingClientRect().top
      if (!above) return
      const moved = previous ? followerTop(element, row) - previous.follower : box.height - height
      if (Math.abs(moved) < 0.01) return
      const schedule = pending.size === 0
      pending.set(element, previous ? { ...previous, row } : { height, row })
      if (schedule) {
        const queuedGeneration = generation
        queueMicrotask(() => { if (queuedGeneration === generation) flush() })
      }
    },
    cancel() {
      generation++
      pending.clear()
      prepared = new WeakMap()
    },
  }
}

/** Compare the last placeholder with the real block during its reveal commit. */
export function useVirtualBlockAnchor(element: RefObject<HTMLDivElement | null>, visible: boolean, height: number) {
  const transcript = useVirtualTranscript()
  const placeholder = useRef(height)
  const wasVisible = useRef(false)
  useLayoutEffect(() => {
    if (!visible) placeholder.current = height
    else if (!wasVisible.current && element.current) transcript?.preserveBlockAnchor(element.current, placeholder.current)
    wasVisible.current = visible
  }, [element, visible, height, transcript])
}
