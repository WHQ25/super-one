import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react'
import { TranscriptStateProvider } from '@superone/ui/lib/transcript-state'
import { retainMcpAppTranscript } from '../mcp-apps/layout-store'
import { McpAppTranscriptRetention } from '../mcp-apps/transcript-retention'
import { VirtualTranscriptContext } from './virtual-transcript-context'
import { transcriptInteractionSnapshot } from './transcript-interaction'

export interface VirtualTranscriptItem {
  id: string
  sourceId?: string
  content: ReactNode
  estimate?: number
}
export interface VirtualTranscriptHandle {
  jumpTo: (id: string) => void
  topOf: (id: string) => number | null
}

const ROW_GAP = 6
const SMALL_LIST = 8

/** All rows share the existing chat viewport; the list owns only mounted content and geometry. */
export function VirtualTranscriptList({ items, viewportRef, apiRef }: {
  items: readonly VirtualTranscriptItem[]
  viewportRef: RefObject<HTMLDivElement | null>
  apiRef: Ref<VirtualTranscriptHandle>
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const states = useRef(new Map<string, unknown>()).current
  const retention = useRef(Symbol('virtual-transcript')).current
  useLayoutEffect(() => retainMcpAppTranscript(retention), [retention])
  const indexById = useMemo(() => {
    const indices = new Map(items.map((item, index) => [item.id, index]))
    items.forEach((item, index) => { if (item.sourceId && !indices.has(item.sourceId)) indices.set(item.sourceId, index) })
    return indices
  }, [items])
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const [scrollMargin, setScrollMargin] = useState(0)
  const small = items.length <= SMALL_LIST
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    getItemKey: index => items[index].id,
    estimateSize: index => (items[index].estimate ?? 200) + ROW_GAP,
    overscan: 2,
    scrollMargin,
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...pinnedIds.flatMap(id => {
      const index = indexById.get(id)
      return index === undefined ? [] : [index]
    })])].sort((a, b) => a - b),
    enabled: !small,
    anchorTo: 'end',
    initialOffset: 1e12,
  })
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer
  // Measuring overscan rows above the fold must preserve the reading anchor,
  // including after a backward jump. Growth inside the visible row stays put.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    (instance.itemSizeCache.has(item.key) ? item.end : item.start) < (instance.scrollOffset ?? 0)

  // Keep paragraph callbacks session-owned, not captured by an unmounted message.
  const blockCallbacks = useRef(new Map<Element, (visible: boolean) => void>()).current
  const intersections = useRef(new Map<Element, boolean>()).current
  const observer = useRef<IntersectionObserver | null>(null)
  const observeBlock = useCallback((element: HTMLElement, callback: (visible: boolean) => void) => {
    blockCallbacks.set(element, callback)
    observer.current?.observe(element)
    return () => { observer.current?.unobserve(element); blockCallbacks.delete(element); intersections.delete(element) }
  }, [blockCallbacks, intersections])
  useEffect(() => {
    const root = viewportRef.current
    if (!root) return
    const io = new IntersectionObserver(entries => {
      // Selection reads can flush layout. Snapshot once for a whole observer
      // batch instead of querying the browser for each of thousands of blocks.
      const hasInteraction = transcriptInteractionSnapshot(root.ownerDocument)
      for (const entry of entries) {
        intersections.set(entry.target, entry.isIntersecting)
        blockCallbacks.get(entry.target)?.(entry.isIntersecting || hasInteraction(entry.target))
      }
    }, { root, rootMargin: '300px 0px' })
    observer.current = io
    for (const element of blockCallbacks.keys()) io.observe(element)
    return () => { io.disconnect(); observer.current = null }
  }, [viewportRef, blockCallbacks, intersections])
  const context = useMemo(() => ({ viewportRef, observeBlock }), [viewportRef, observeBlock])

  useEffect(() => {
    const doc = listRef.current?.ownerDocument
    if (!doc) return
    const refresh = () => {
      const hasInteraction = transcriptInteractionSnapshot(doc)
      const ids = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-virtual-message]') ?? [])]
        .filter(hasInteraction).map(row => row.dataset.virtualMessage!)
      setPinnedIds(previous => previous.length === ids.length && previous.every((id, index) => id === ids[index]) ? previous : ids)
      for (const [element, intersecting] of intersections) {
        if (!intersecting) blockCallbacks.get(element)?.(hasInteraction(element))
      }
    }
    const afterFocus = () => queueMicrotask(refresh)
    const events = ['selectionchange', 'focusin', 'play', 'pause', 'ended']
    for (const event of events) doc.addEventListener(event, refresh, true)
    doc.addEventListener('focusout', afterFocus, true)
    return () => {
      for (const event of events) doc.removeEventListener(event, refresh, true)
      doc.removeEventListener('focusout', afterFocus, true)
    }
  }, [blockCallbacks, intersections])

  useEffect(() => {
    const list = listRef.current
    const viewport = viewportRef.current
    if (!list || !viewport) return
    const measure = () => setScrollMargin(list.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop)
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(viewport)
    return () => resize.disconnect()
  }, [viewportRef])

  // The keyed transcript releases session-owned state on session switch.

  // A new session initially opens at the end, even when no useChatScroll host is mounted (stories).
  useLayoutEffect(() => {
    if (!small) virtualizer.scrollToEnd()
  }, [small])

  useImperativeHandle(apiRef, () => ({
    jumpTo(id) {
      const index = indexById.get(id)
      if (index === undefined) return
      if (small) listRef.current?.querySelector(`[data-message-id="${CSS.escape(items[index].id)}"]`)?.scrollIntoView({ block: 'start' })
      else virtualizerRef.current.scrollToIndex(index, { align: 'start' })
    },
    topOf(id) {
      const viewport = viewportRef.current
      if (!viewport) return null
      const index = indexById.get(id)
      const element = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(index === undefined ? id : items[index].id)}"]`)
      if (element) return element.getBoundingClientRect().top
      if (index === undefined) return null
      // Unmounted suffix rows still have real logical positions. The scroll-to
      // API clamps to the maximum offset and cannot be used for the outline.
      const offset = virtualizerRef.current.measurementsCache[index]?.start
      return offset === undefined ? null : viewport.getBoundingClientRect().top + offset - viewport.scrollTop
    },
  }), [indexById, small, viewportRef])

  const renderItem = (index: number) => <TranscriptStateProvider values={states} scope={items[index].id}>{items[index].content}</TranscriptStateProvider>
  const visible = virtualizer.getVirtualItems()
  return (
    <McpAppTranscriptRetention.Provider value={retention}>
      <VirtualTranscriptContext.Provider value={context}>
        <div ref={listRef} data-virtual-transcript className="relative w-full" style={small ? undefined : { height: virtualizer.getTotalSize(), overflowAnchor: 'none' }}>
          {small ? items.map((item, index) => (
            <div key={item.id} data-virtual-message={item.id} style={{ paddingBottom: ROW_GAP }}>
              {renderItem(index)}
            </div>
          )) : visible.map(row => (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={row.index}
              data-virtual-row
              data-virtual-message={items[row.index].id}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${row.start - scrollMargin}px)`, paddingBottom: ROW_GAP }}
            >
              {renderItem(row.index)}
            </div>
          ))}
        </div>
      </VirtualTranscriptContext.Provider>
    </McpAppTranscriptRetention.Provider>
  )
}
