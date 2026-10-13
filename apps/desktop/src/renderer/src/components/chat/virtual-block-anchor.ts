import type { Virtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useVirtualTranscript } from './virtual-transcript-context'

/** Reveal geometry belongs to the transcript, so sibling/nested blocks share one correction. */
export function createVirtualBlockAnchor(
  viewportRef: RefObject<HTMLDivElement | null>,
  virtualizerRef: RefObject<Virtualizer<HTMLDivElement, Element>>,
) {
  const pending = new Map<HTMLElement, { height: number; row: HTMLElement }>()
  let prepared = new WeakMap<HTMLElement, { height: number; end: number }>()
  let generation = 0

  const flush = () => {
    const changes = new Map(pending)
    pending.clear()
    const viewport = viewportRef.current
    if (!viewport) return
    const rows = new Set<HTMLElement>()
    let delta = 0
    for (const [element, previous] of changes) {
      if (!element.isConnected || !viewport.contains(element)) continue
      // An ancestor's measurement already includes its children's size changes.
      let ancestor = element.parentElement
      while (ancestor && !changes.has(ancestor)) ancestor = ancestor.parentElement
      if (ancestor) continue
      delta += element.getBoundingClientRect().height - previous.height
      rows.add(previous.row)
    }
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
      prepared.set(element, { height: box.height, end: box.bottom - row.getBoundingClientRect().top })
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
      height = previous?.height ?? height
      if (!above || Math.abs(box.height - height) < 0.01) return
      const schedule = pending.size === 0
      pending.set(element, { height, row })
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
