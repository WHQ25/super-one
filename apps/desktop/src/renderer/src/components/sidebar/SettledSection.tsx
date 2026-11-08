import { memo, useCallback, useRef, type WheelEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { useTranslation } from 'react-i18next'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import type { SessionHoverModel } from '@/lib/multi-host/session-hover'
import { SessionRow } from './SessionRow'
import { SidebarCollapse } from './SidebarCollapse'
import { SidebarSectionLabel } from './SidebarSectionLabel'
import { settledPanelId, useProjectSettledCollapsed } from './sidebar-section-collapse'
import { chainSessionListWheel, measureSessionListRow, observeSessionListRect, SESSION_LIST_SCROLL_CLASS, SESSION_ROW_ESTIMATE } from './session-list-scroll'
import type { SessionMenuCallbacks } from './useSessionMenuItems'

/** Same near-bottom prefetch as project history. The settled list is short, so a full page still overflows it. */
const SETTLED_SCROLL_PREFETCH = 300

export interface SettledSectionProps extends SessionMenuCallbacks {
  folderPath: string
  sessions: PinnedSessionEntry[]
  /** Session whose open is in flight. Spins the icon in front of its title. */
  openingSessionId?: string | null
  /** Another page exists below the rows already shown. */
  hasMore?: boolean
  /**
   * Settled sessions in this project, including pages not loaded yet.
   * Omitted means the rows already shown.
   */
  count?: number
  /** Scroll near the bottom loads the next page. There is no Show more button. */
  onLoadMore?: () => void | Promise<void>
  presentation?: (session: PinnedSessionEntry) => {
    hover?: SessionHoverModel | null
    environmentOffline?: boolean
  } | null | undefined
}

/** Virtualized rows without a heading, also used under focus → Settled → environment. */
export const SettledSessionList = memo(function SettledSessionList({
  sessions,
  openingSessionId = null,
  hasMore = false,
  onLoadMore,
  presentation,
  ...callbacks
}: Omit<SettledSectionProps, 'count' | 'folderPath'>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const handleScroll = useCallback(() => {
    if (!hasMore || !onLoadMore || loadingMoreRef.current) return
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight < el.scrollHeight - SETTLED_SCROLL_PREFETCH) return
    loadingMoreRef.current = true
    Promise.resolve(onLoadMore()).finally(() => {
      loadingMoreRef.current = false
    })
  }, [hasMore, onLoadMore])
  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SESSION_ROW_ESTIMATE,
    overscan: 8,
    getItemKey: (index) => sessions[index]?.sessionId ?? index,
    observeElementRect: observeSessionListRect,
    measureElement: measureSessionListRow,
  })
  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (el) chainSessionListWheel(el, event)
  }, [])
  if (sessions.length === 0) return null
  return (
    <ScrollArea
      type="scroll"
      edgeFade
      viewportRef={scrollRef}
      onScroll={handleScroll}
      onWheel={handleWheel}
      data-settled-list=""
      className={SESSION_LIST_SCROLL_CLASS}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }} className="w-full">
        {virtualizer.getVirtualItems().map((item) => {
          const session = sessions[item.index]
          if (!session) return null
          const row = presentation?.(session)
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
            >
              <SessionRow
                session={session}
                folderPath={session.folderPath}
                opening={openingSessionId === session.sessionId}
                hover={row?.hover}
                environmentOffline={row?.environmentOffline}
                {...callbacks}
              />
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
})

/** Finished work stays folded until its project heading is opened. */
export const SettledSection = memo(function SettledSection(props: SettledSectionProps) {
  const { count, folderPath, ...listProps } = props
  const { t } = useTranslation()
  const [collapsed, toggleCollapsed] = useProjectSettledCollapsed(folderPath)
  if (props.sessions.length === 0) return null
  const panelId = settledPanelId(folderPath)
  return (
    <div className="flex flex-col pb-0.5">
      <div className="pl-1">
        <SidebarSectionLabel
          section="settled"
          count={count ?? props.sessions.length}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          controlsId={panelId}
          countTone="plain"
          chevronWhenExpanded
        >
          {t('sidebar.settled')}
        </SidebarSectionLabel>
      </div>
      <SidebarCollapse id={panelId} open={!collapsed} unmountClosed>
        <SettledSessionList {...listProps} />
      </SidebarCollapse>
    </div>
  )
})
