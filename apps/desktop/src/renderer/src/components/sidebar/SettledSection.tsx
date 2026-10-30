import { memo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import type { SessionHoverModel } from '@/lib/multi-host/session-hover'
import { SessionRow } from './SessionRow'
import { SidebarSectionLabel } from './SidebarSectionLabel'
import { settledPanelId, useProjectSettledCollapsed } from './sidebar-section-collapse'
import type { SessionMenuCallbacks } from './useSessionMenuItems'

/** Same near-bottom prefetch as project history. The settled list is shorter, so a full page still overflows it. */
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

/**
 * Finished sessions inside one project. Folded until opened, and absent when
 * this project has nothing settled, so the group does not ask for attention.
 */
export const SettledSection = memo(function SettledSection({
  folderPath,
  sessions,
  openingSessionId = null,
  hasMore = false,
  count,
  onLoadMore,
  presentation,
  ...callbacks
}: SettledSectionProps) {
  const { t } = useTranslation()
  const [collapsed, toggleCollapsed] = useProjectSettledCollapsed(folderPath)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const handleScroll = useCallback(() => {
    if (collapsed || !hasMore || !onLoadMore || loadingMoreRef.current) return
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight < el.scrollHeight - SETTLED_SCROLL_PREFETCH) return
    loadingMoreRef.current = true
    Promise.resolve(onLoadMore()).finally(() => {
      loadingMoreRef.current = false
    })
  }, [collapsed, hasMore, onLoadMore])
  if (sessions.length === 0) return null
  const panelId = settledPanelId(folderPath)
  return (
    <div className="flex flex-col pb-0.5">
      {/* pl-1 lines the heading glyph up with a session icon. Rows keep SessionRow's own padding. */}
      <div className="pl-1">
        <SidebarSectionLabel
          section="settled"
          count={count ?? sessions.length}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          controlsId={panelId}
          countTone="plain"
          divider={!collapsed}
        >
          {t('sidebar.settled')}
        </SidebarSectionLabel>
      </div>
      <div
        id={panelId}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
        )}
        inert={collapsed ? true : undefined}
        aria-hidden={collapsed || undefined}
      >
        <div className="overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            data-settled-list=""
            className="max-h-64 overflow-y-auto overscroll-contain"
          >
            {sessions.map((session) => {
              const row = presentation?.(session)
              return (
                <SessionRow
                  key={session.sessionId}
                  session={session}
                  folderPath={folderPath}
                  opening={openingSessionId === session.sessionId}
                  hover={row?.hover}
                  environmentOffline={row?.environmentOffline}
                  {...callbacks}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
})
