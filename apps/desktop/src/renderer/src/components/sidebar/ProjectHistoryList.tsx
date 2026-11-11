import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, X } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { SessionRow, type SessionRowCallbacks } from './SessionRow'

const HISTORY_PAGE_SIZE = 30
const ROW_ESTIMATE = 32
const HISTORY_VIEWPORT_MAX = ROW_ESTIMATE * 12
interface LocatedSession { folderPath: string; session: SessionHistoryEntry }
function mergeSessions(rows: LocatedSession[]): LocatedSession[] {
  const seen = new Set<string>()
  return rows.filter(({ folderPath, session }) => {
    const key = `${folderPath}\0${session.sessionId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => (Date.parse(b.session.lastActiveAt) || 0) - (Date.parse(a.session.lastActiveAt) || 0))
}

/** Search can sit above the environment list or inside one environment. */
export function ProjectHistorySearch({ query, onQueryChange, onClose, label }: {
  query: string
  onQueryChange: (query: string) => void
  onClose: () => void
  label?: string
}) {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-1">
      <Search className="size-3.5 shrink-0 text-sidebar-foreground/50" />
      <input
        autoFocus
        aria-label={label ?? t('sidebar.contextMenu.searchSessions')}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key !== 'Escape') return
          event.preventDefault()
          if (query) onQueryChange('')
          else onClose()
        }}
        placeholder={t('sidebar.contextMenu.searchSessions')}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/40"
      />
      <IconButton size="sm" tooltip={t('common.close')} onClick={onClose}><X /></IconButton>
    </div>
  )
}

interface ProjectHistoryListProps extends SessionRowCallbacks {
  folderPath: string
  /** Focus search can cover all checkouts, or just one environment's checkouts. */
  folderPaths?: readonly string[]
  projectIds?: Readonly<Record<string, string>>
  /** One project-wide input can drive separate result lists under each host. */
  searchQuery?: string
  onSearchQueryChange?: (query: string) => void
  showSearch?: boolean
  initialSessions?: SessionHistoryEntry[]
  openingSessionId?: string | null
  openingFolderPath?: string
  presentation?: (folderPath: string, session: SessionHistoryEntry) => Pick<React.ComponentProps<typeof SessionRow>, 'hover' | 'environmentOffline'>
  onClose: () => void
}

export function ProjectHistoryList(props: ProjectHistoryListProps) {
  const paths = props.folderPaths ?? [props.folderPath]
  return <HistoryList key={paths.join('\0')} {...props} paths={paths} />
}

function HistoryList({
  folderPath, paths: inputPaths, projectIds, initialSessions, openingSessionId = null, openingFolderPath,
  presentation, searchQuery, onSearchQueryChange, showSearch = true, onClose, onSwitchSession, onPinSession, onSettleSession, onRenameSession, onDeleteSession,
}: ProjectHistoryListProps & { paths: readonly string[] }) {
  const { t } = useTranslation()
  const pathsKey = inputPaths.join('\0')
  const paths = useMemo(() => inputPaths, [pathsKey])
  const [localQuery, setLocalQuery] = useState('')
  const query = searchQuery ?? localQuery
  const setQuery = onSearchQueryChange ?? setLocalQuery
  const [browseSessions, setBrowseSessions] = useState<LocatedSession[]>(() => (initialSessions ?? []).map((session) => ({ folderPath, session })))
  const [hasMore, setHasMore] = useState<string[]>([])
  const [allSessions, setAllSessions] = useState<LocatedSession[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [failedPaths, setFailedPaths] = useState<string[]>([])
  const [reloadNonce, setReloadNonce] = useState(0)
  const offsets = useRef(new Map<string, number>())
  const loadingMoreRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trimmedQuery = query.trim().toLowerCase()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailedPaths([])
    void (async () => {
      const { listSessionsPage, sessionsPageHasMore } = await import('@/lib/session-list-ops')
      const results = await Promise.allSettled(paths.map(async (path) => ({ path, sessions: await listSessionsPage(path, { limit: HISTORY_PAGE_SIZE, offset: 0, includeSettled: true, projectId: projectIds?.[path] }) })))
      if (cancelled) return
      const rows: LocatedSession[] = []
      const more: string[] = []
      const failed: string[] = []
      offsets.current.clear()
      results.forEach((result, index) => {
        if (result.status === 'rejected') { failed.push(paths[index]!); return }
        const { path, sessions } = result.value
        rows.push(...sessions.map((session) => ({ folderPath: path, session })))
        offsets.current.set(path, sessions.length)
        if (sessionsPageHasMore(sessions, HISTORY_PAGE_SIZE)) more.push(path)
      })
      setBrowseSessions(mergeSessions(rows))
      setHasMore(more)
      setFailedPaths(failed)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [paths, projectIds, reloadNonce])

  useEffect(() => {
    if (!trimmedQuery || allSessions !== null) return
    let cancelled = false
    void (async () => {
      const { listAllSessions } = await import('@/lib/session-list-ops')
      const results = await Promise.allSettled(paths.map(async (path) => (await listAllSessions(path, { pageSize: HISTORY_PAGE_SIZE, includeSettled: true, projectId: projectIds?.[path] })).map((session) => ({ folderPath: path, session }))))
      if (cancelled) return
      setAllSessions(mergeSessions(results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])))
      setFailedPaths(results.flatMap((result, index) => result.status === 'rejected' ? [paths[index]!] : []))
    })()
    return () => { cancelled = true }
  }, [Boolean(trimmedQuery), allSessions, paths, projectIds, reloadNonce])

  useEffect(() => window.app.onSessionChanged(() => {
    setAllSessions(null)
    setReloadNonce((n) => n + 1)
  }), [])

  const fetchMore = useCallback(async () => {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    try {
      const { listSessionsPage, sessionsPageHasMore } = await import('@/lib/session-list-ops')
      const results = await Promise.allSettled(hasMore.map(async (path) => ({ path, sessions: await listSessionsPage(path, {
        limit: HISTORY_PAGE_SIZE, offset: offsets.current.get(path) ?? 0, includeSettled: true, projectId: projectIds?.[path],
      }) })))
      const rows: LocatedSession[] = []
      const finished: string[] = []
      results.forEach((result) => {
        if (result.status !== 'fulfilled') return
        const { path, sessions } = result.value
        offsets.current.set(path, (offsets.current.get(path) ?? 0) + sessions.length)
        rows.push(...sessions.map((session) => ({ folderPath: path, session })))
        if (!sessionsPageHasMore(sessions, HISTORY_PAGE_SIZE)) finished.push(path)
      })
      setBrowseSessions((prev) => mergeSessions([...prev, ...rows]))
      setHasMore((prev) => prev.filter((path) => !finished.includes(path)))
      setFailedPaths(results.flatMap((result, index) => result.status === 'rejected' ? [hasMore[index]!] : []))
    } finally { loadingMoreRef.current = false }
  }, [hasMore, projectIds])

  const sessions = trimmedQuery ? (allSessions ?? []).filter(({ session }) => session.title.toLowerCase().includes(trimmedQuery)) : browseSessions
  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 12,
    getItemKey: (index) => sessions[index] ? `${sessions[index]!.folderPath}\0${sessions[index]!.session.sessionId}` : index,
  })
  const handleScroll = () => {
    if (trimmedQuery || !hasMore.length) return
    const el = scrollRef.current
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 300) void fetchMore()
  }
  const emptyText = (trimmedQuery ? allSessions === null : loading)
    ? t('common.loading') : trimmedQuery ? t('sidebar.search.noSessions') : t('sidebar.contextMenu.noSessions')

  return (
    <div data-project-history className="flex min-w-0 flex-col overflow-hidden">
      {showSearch && <ProjectHistorySearch query={query} onQueryChange={setQuery} onClose={onClose} />}
      {failedPaths.length > 0 && <div role="alert" className="px-2.5 py-1 text-xs text-sidebar-foreground/70">
        {t('sidebar.search.loadFailed')}{' '}
        <button type="button" className="underline" onClick={() => { setAllSessions(null); setReloadNonce((n) => n + 1) }}>{t('common.retry')}</button>
      </div>}
      <ScrollArea type="scroll" edgeFade viewportRef={scrollRef} onScroll={handleScroll}
        className="sidebar-scroll min-h-0 min-w-0 [&_[data-slot=scroll-area-viewport]]:max-h-[inherit] [&_[data-slot=scroll-area-viewport]]:overscroll-contain [&_[data-slot=scroll-area-viewport]>div]:block!"
        style={{ maxHeight: HISTORY_VIEWPORT_MAX }}>
        {sessions.length === 0 ? <div className="px-2.5 py-3 text-[11px] text-sidebar-foreground/50">{emptyText}</div> : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }} className="w-full">
            {virtualizer.getVirtualItems().map((item) => {
              const row = sessions[item.index]
              if (!row) return null
              return <div key={item.key} data-index={item.index} ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}>
                <SessionRow session={row.session} folderPath={row.folderPath} animateTitle={false}
                  opening={openingSessionId === row.session.sessionId && (!openingFolderPath || openingFolderPath === row.folderPath)}
                  {...presentation?.(row.folderPath, row.session)}
                  onSwitchSession={onSwitchSession} onPinSession={onPinSession} onSettleSession={onSettleSession}
                  onRenameSession={onRenameSession} onDeleteSession={onDeleteSession} />
              </div>
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
