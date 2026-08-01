import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, X } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { SessionRow, type SessionRowCallbacks } from './SessionRow'

const HISTORY_PAGE_SIZE = 30
const ROW_ESTIMATE = 32
const HISTORY_VIEWPORT_MAX = ROW_ESTIMATE * 12

function dedupeById(sessions: SessionHistoryEntry[]): SessionHistoryEntry[] {
  const seen = new Set<string>()
  return sessions.filter((s) => (seen.has(s.sessionId) ? false : (seen.add(s.sessionId), true)))
}

interface ProjectHistoryListProps extends SessionRowCallbacks {
  folderPath: string
  initialSessions?: SessionHistoryEntry[]
  onClose: () => void
}

export function ProjectHistoryList({
  folderPath,
  initialSessions,
  onClose,
  onSwitchSession,
  onPinSession,
  onHideSession,
  onRenameSession,
  onDeleteSession,
}: ProjectHistoryListProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [browseSessions, setBrowseSessions] = useState<SessionHistoryEntry[]>(initialSessions ?? [])
  const [browseHasMore, setBrowseHasMore] = useState(false)
  const [allSessions, setAllSessions] = useState<SessionHistoryEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadNonce, setReloadNonce] = useState(0)
  const pageRef = useRef(1)
  const loadingMoreRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const trimmedQuery = query.trim().toLowerCase()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
        const remote = parseRemoteProjectKey(folderPath)
        if (remote) {
          const { useAppStore } = await import('@/stores/app')
          const projectId =
            useAppStore.getState().currentProjectId ??
            // Fallback: host projects list keys path as remote:... and id is projectId
            null
          // Prefer id from folderPath parent: AppSidebar stores id on RecentFolder; history may not have it.
          // listSessions needs projectId — resolve via listProjects if needed.
          let pid = projectId
          if (!pid) {
            const projects = await window.environment.listProjects(remote.connectionId)
            const match = projects.find(
              (p) => `remote:${remote.connectionId}:${p.path}` === folderPath || p.path === remote.path,
            )
            pid = match?.projectId ?? null
          }
          if (!pid) {
            if (!cancelled) {
              setBrowseSessions([])
              setBrowseHasMore(false)
            }
            return
          }
          const { listRemoteSessionsForProject } = await import('@/lib/remote-session-ops')
          const page = await listRemoteSessionsForProject(folderPath, pid)
          if (cancelled) return
          setBrowseSessions(page)
          setBrowseHasMore(false)
          pageRef.current = 1
          return
        }
        const page = await window.app.listSessionsForFolderPage(folderPath, HISTORY_PAGE_SIZE, 0)
        if (cancelled) return
        setBrowseSessions(page)
        setBrowseHasMore(page.length >= HISTORY_PAGE_SIZE)
        pageRef.current = 1
      } catch {
        if (!cancelled) setBrowseSessions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [folderPath, reloadNonce])

  useEffect(() => {
    if (!trimmedQuery || allSessions !== null) return
    let cancelled = false
    void (async () => {
      try {
        const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
        if (parseRemoteProjectKey(folderPath)) {
          // Full remote list already in browseSessions.
          if (!cancelled) setAllSessions(browseSessions)
          return
        }
        const all = await window.app.listSessionsForFolder(folderPath)
        if (!cancelled) setAllSessions(all)
      } catch {
        if (!cancelled) setAllSessions([])
      }
    })()
    return () => { cancelled = true }
  }, [trimmedQuery, allSessions, folderPath, browseSessions])

  useEffect(() => {
    return window.app.onSessionChanged(() => {
      setAllSessions(null)
      setReloadNonce((n) => n + 1)
    })
  }, [])

  const fetchMore = useCallback(async () => {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    try {
      const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
      if (parseRemoteProjectKey(folderPath)) {
        setBrowseHasMore(false)
        return
      }
      const page = await window.app.listSessionsForFolderPage(folderPath, HISTORY_PAGE_SIZE, pageRef.current * HISTORY_PAGE_SIZE)
      setBrowseSessions((prev) => dedupeById([...prev, ...page]))
      setBrowseHasMore(page.length >= HISTORY_PAGE_SIZE)
      pageRef.current += 1
    } catch (err) {
      console.warn('[history] fetchMore failed:', err)
    } finally {
      loadingMoreRef.current = false
    }
  }, [folderPath])

  const sessions = trimmedQuery
    ? (allSessions ?? []).filter((s) => s.title.toLowerCase().includes(trimmedQuery))
    : browseSessions

  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 12,
    getItemKey: (index) => sessions[index]?.sessionId ?? index,
  })

  const handleScroll = useCallback(() => {
    if (trimmedQuery || !browseHasMore) return
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) void fetchMore()
  }, [trimmedQuery, browseHasMore, fetchMore])

  const emptyText = loading && !trimmedQuery
    ? ''
    : trimmedQuery
      ? t('sidebar.search.noResults')
      : t('sidebar.contextMenu.noSessions')

  return (
    <div className="flex flex-col overflow-hidden pl-2.5">
      <div className="flex items-center gap-1.5 px-2.5 py-1">
        <Search className="size-3.5 shrink-0 text-sidebar-foreground/50" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Escape') {
              e.preventDefault()
              if (query) setQuery('')
              else onClose()
            }
          }}
          placeholder={t('sidebar.contextMenu.searchSessions')}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/40"
        />
        <IconButton size="sm" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="hide-scrollbar overflow-y-auto overscroll-contain"
        style={{ maxHeight: HISTORY_VIEWPORT_MAX }}
      >
        {sessions.length === 0 ? (
          <div className="px-2.5 py-3 text-[11px] text-sidebar-foreground/50">{emptyText}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }} className="w-full">
            {virtualizer.getVirtualItems().map((item) => {
              const session = sessions[item.index]
              if (!session) return null
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
                >
                  <SessionRow
                    session={session}
                    folderPath={folderPath}
                    animateTitle={false}
                    onSwitchSession={onSwitchSession}
                    onPinSession={onPinSession}
                    onHideSession={onHideSession}
                    onRenameSession={onRenameSession}
                    onDeleteSession={onDeleteSession}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
