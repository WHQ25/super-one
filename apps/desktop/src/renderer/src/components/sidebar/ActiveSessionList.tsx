import { Children, isValidElement, useCallback, useRef, type ReactNode, type WheelEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { chainSessionListWheel, measureSessionListRow, observeSessionListRect, SESSION_CHILD_LIST_SCROLL_CLASS, SESSION_LIST_SCROLL_CLASS, SESSION_ROW_ESTIMATE } from './session-list-scroll'

/** Same near-bottom prefetch as project history and the settled list. */
const ACTIVE_SCROLL_PREFETCH = 300

export interface ActiveSessionListProps {
  /** Another page exists below the rows already shown. */
  hasMore?: boolean
  /** Scroll near the bottom loads the next page. There is no Show more button. */
  onLoadMore?: () => void | Promise<void>
  /** `child` is the list under one expanded parent. It scrolls on its own. */
  kind?: 'active' | 'child'
  children: ReactNode
}

/**
 * Non-settled sessions for one open project. The list is capped at the same
 * height as Settled, so a project someone never settles cannot grow the
 * sidebar without bound. A short list stays at its content height. Rows are
 * virtualized; an expanded parent's child list is one measured item and uses
 * a shorter cap so it fits inside this list.
 * Scrolling near the bottom asks for the next page.
 */
export function ActiveSessionList({ hasMore = false, onLoadMore, kind = 'active', children }: ActiveSessionListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const items = Children.toArray(children)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SESSION_ROW_ESTIMATE,
    overscan: 8,
    getItemKey: (index) => {
      const item = items[index]
      return isValidElement(item) && item.key != null ? String(item.key) : index
    },
    observeElementRect: observeSessionListRect,
    measureElement: measureSessionListRow,
  })
  const handleScroll = useCallback(() => {
    if (!hasMore || !onLoadMore || loadingMoreRef.current) return
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight < el.scrollHeight - ACTIVE_SCROLL_PREFETCH) return
    loadingMoreRef.current = true
    Promise.resolve(onLoadMore()).finally(() => {
      loadingMoreRef.current = false
    })
  }, [hasMore, onLoadMore])
  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (el) chainSessionListWheel(el, event)
  }, [])

  return (
    <ScrollArea
      type="scroll"
      edgeFade
      viewportRef={scrollRef}
      onScroll={handleScroll}
      onWheel={handleWheel}
      {...(kind === 'child' ? { 'data-child-session-list': '' } : { 'data-active-session-list': '' })}
      className={kind === 'child' ? SESSION_CHILD_LIST_SCROLL_CLASS : SESSION_LIST_SCROLL_CLASS}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }} className="w-full">
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
          >
            {items[item.index]}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
