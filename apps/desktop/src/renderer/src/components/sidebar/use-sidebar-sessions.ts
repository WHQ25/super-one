import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shallow } from 'zustand/shallow'
import { useShallow } from 'zustand/react/shallow'
import type { PinnedSessionEntry, RecentFolder, SessionHistoryEntry } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { removeSession, setSessionFlags, setSessionRead } from '@/lib/session-client'
import { isListedSession } from '@/lib/session-list-ops'
import { noteListedUnread, setUnseenCompleted } from '@/stores/chat-store/helpers/unseen-completed'
import { traceSidebar } from './sidebar-trace'

/** Active-list page. `session.list` allows up to 500; the loop stops on a short page. */
const ACTIVE_PAGE_SIZE = 100
/** Settled rows are numerous. One project page, then the list loads more as it scrolls. */
const SETTLED_PAGE_SIZE = 20
/** Local SQL refuses a larger settled page. A refresh that already revealed more walks in chunks. */
const SETTLED_QUERY_CAP = 200

type LoadReason = 'expand' | 'refresh' | 'current' | 'switch'
interface ListRequest {
  promise: Promise<SessionHistoryEntry[]>
  invalidated: boolean
}

interface SettledFolderPage {
  sessions: PinnedSessionEntry[]
  hasMore: boolean
  /** Every settled session in this project, including pages not loaded yet. */
  total: number
}

function settledListTarget(folderPath: string): { connectionId: string; projectPath: string } {
  const remote = parseRemoteProjectKey(folderPath)
  if (remote) return { connectionId: remote.connectionId, projectPath: remote.path }
  return { connectionId: 'local', projectPath: folderPath }
}

function dedupeSettled(rows: PinnedSessionEntry[]): PinnedSessionEntry[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.sessionId)) return false
    seen.add(row.sessionId)
    return true
  })
}

function visibleRootCount(sessions: SessionHistoryEntry[]): number {
  return sessions.filter((session) => isListedSession(session) && !session.parentSessionId).length
}

function notePinnedUnread(rows: PinnedSessionEntry[]): void {
  const unread = rows.filter((row) => row.unread && row.folderPath)
  if (!unread.length) return
  useChatStore.setState((state) => noteListedUnread(state, unread.map((row) => ({
    folderPath: row.folderPath,
    sessionId: row.sessionId,
  }))))
}

export function useSidebarSessions({ currentFolder, selectedHostConnectionId, hostProjects, pinnedConnectionIds }: {
  currentFolder: string | null
  selectedHostConnectionId: string
  hostProjects: RecentFolder[]
  /** When set, pins are loaded for each of these environments and grouped in the list. */
  pinnedConnectionIds?: string[]
}) {
  const [folderSessions, setFolderSessions] = useState<Record<string, SessionHistoryEntry[]>>({})
  const [loadingFolders, setLoadingFolders] = useState<Record<string, boolean>>({})
  const [pinnedSessions, setPinnedSessions] = useState<PinnedSessionEntry[]>([])
  const [settledByFolder, setSettledByFolder] = useState<Record<string, SettledFolderPage>>({})
  const folderSessionsRef = useRef(folderSessions)
  const settledByFolderRef = useRef(settledByFolder)
  const settledGeneration = useRef(new Map<string, number>())
  const settledAppendFlight = useRef(new Set<string>())
  const replaceSettledRef = useRef<(folderPath: string) => void>(() => {})
  const inFlight = useRef(new Map<string, ListRequest>())
  const resetSession = useChatStore((state) => state.resetSession)
  const removeSessionFromMemory = useChatStore((state) => state.removeSessionFromMemory)
  const { currentActiveSid, currentStatus } = useChatStore(useShallow((s) => {
    const proj = currentFolder ? s.projectSessions[currentFolder] : undefined
    const sid = proj?._activeSessionId
    return { currentActiveSid: sid, currentStatus: sid ? proj?._sessions?.[sid]?.status : undefined }
  }))

  useEffect(() => { folderSessionsRef.current = folderSessions }, [folderSessions])
  useEffect(() => { settledByFolderRef.current = settledByFolder }, [settledByFolder])
  // Read at request time. A catalog write that only moved `lastOpened` must not
  // rebuild `load` and every row callback derived from it.
  const hostProjectsRef = useRef(hostProjects)
  useEffect(() => { hostProjectsRef.current = hostProjects }, [hostProjects])

  const load = useCallback((folderPath: string, reason: LoadReason) => {
    // A text row would change the list height. Only an expand, or a fetch that
    // has no rows yet, spins the folder icon. A refresh of a list already on
    // screen stays quiet so switching sessions does not shove the rows.
    const armFolderSpinner = () => {
      // A local list comes back from this machine. Spinning the folder on expand only flashes.
      if (!parseRemoteProjectKey(folderPath)) return
      if (reason !== 'expand' && folderSessionsRef.current[folderPath]?.length) return
      setLoadingFolders((previous) => previous[folderPath] ? previous : { ...previous, [folderPath]: true })
    }

    const existing = inFlight.current.get(folderPath)
    if (existing) {
      // A change notification invalidates the snapshot already being read. Sharing
      // that request without another read loses changes until the user navigates.
      if (reason === 'refresh') existing.invalidated = true
      armFolderSpinner()
      traceSidebar('sessions_load:reuse', { folderPath, reason, invalidated: existing.invalidated }, folderPath)
      return existing.promise
    }

    armFolderSpinner()
    const request: ListRequest = { promise: Promise.resolve([]), invalidated: false }
    request.promise = (async () => {
      for (;;) {
        request.invalidated = false
        const sessions: SessionHistoryEntry[] = []
        let hasMore = true
        const startedAt = performance.now()
        traceSidebar('sessions_load:start', { folderPath, reason, pageSize: ACTIVE_PAGE_SIZE }, folderPath)
        try {
          const { listSessionsPage } = await import('@/lib/session-list-ops')
          const projectId = hostProjectsRef.current.find((project) => project.path === folderPath)?.id ?? null
          while (hasMore) {
            const offset = sessions.length
            const page = await listSessionsPage(folderPath, { limit: ACTIVE_PAGE_SIZE, offset, projectId })
            sessions.push(...page)
            hasMore = page.length >= ACTIVE_PAGE_SIZE
            traceSidebar('sessions_load:page', {
              folderPath, reason, offset, pageCount: page.length,
              visibleCount: visibleRootCount(sessions),
              elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
              remote: Boolean(parseRemoteProjectKey(folderPath)),
            }, folderPath)
            if (page.length === 0 || request.invalidated) break
          }
          if (request.invalidated) {
            // Restart from the first page. Appending at the old offset can skip
            // or repeat rows when a create or settle changes the order mid-read.
            continue
          }
          folderSessionsRef.current = { ...folderSessionsRef.current, [folderPath]: sessions }
          setFolderSessions((previous) => {
            const cached = previous[folderPath]
            if (cached?.length === sessions.length && cached.every((entry, index) => shallow(entry, sessions[index]))) return previous
            return { ...previous, [folderPath]: sessions }
          })
          replaceSettledRef.current(folderPath)
          const unread: Array<{ folderPath: string; sessionId: string }> = []
          for (const session of sessions) {
            if (session.unread && isListedSession(session)) unread.push({ folderPath, sessionId: session.sessionId })
          }
          if (unread.length) {
            useChatStore.setState((state) => noteListedUnread(state, unread))
          }
          traceSidebar('sessions_load:end', {
            folderPath, reason, fetchedCount: sessions.length, visibleCount: visibleRootCount(sessions),
            elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
          }, folderPath)
          return sessions
        } catch (error) {
          traceSidebar('sessions_load:error', {
            folderPath, reason, error: error instanceof Error ? error.message : String(error),
            elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
          }, folderPath)
          if (!request.invalidated) return []
        }
      }
    })().finally(() => {
      if (inFlight.current.get(folderPath) === request) inFlight.current.delete(folderPath)
      if (inFlight.current.has(folderPath)) return
      setLoadingFolders((previous) => {
        if (!previous[folderPath]) return previous
        const next = { ...previous }
        delete next[folderPath]
        return next
      })
    })
    inFlight.current.set(folderPath, request)
    return request.promise
  }, [])

  const loadFolderSessions = useCallback((folderPath: string, reason: LoadReason) =>
    load(folderPath, reason), [load])

  /**
   * Which host the rows currently in `pinnedSessions` came from. Read only when
   * a request resolves, so a slow node answering after the user switched away
   * cannot paint its rows under another host's label.
   */
  const pinnedKey = (pinnedConnectionIds && pinnedConnectionIds.length > 0
    ? pinnedConnectionIds
    : [selectedHostConnectionId]
  ).join('\n')
  const pinnedHostRef = useRef(pinnedKey)
  const refreshPinned = useCallback(() => {
    const key = pinnedKey
    const targets = key.split('\n').filter((id) => id.length > 0)
    if (targets.length === 1) {
      const connectionId = targets[0]!
      window.environment
        .listPinnedSessions(connectionId)
        .then((rows) => {
          if (pinnedHostRef.current !== key) return
          setPinnedSessions(rows)
          notePinnedUnread(rows)
        })
        .catch(() => {
          if (pinnedHostRef.current === key) setPinnedSessions([])
        })
      return
    }
    void Promise.all(targets.map((connectionId) => (
      window.environment.listPinnedSessions(connectionId).catch(() => [] as PinnedSessionEntry[])
    ))).then((groups) => {
      if (pinnedHostRef.current !== key) return
      const rows = groups.flat()
      setPinnedSessions(rows)
      notePinnedUnread(rows)
    })
  }, [pinnedKey])

  const publishSettled = useCallback((folderPath: string, page: SettledFolderPage) => {
    const current = settledByFolderRef.current[folderPath]
    // Expand re-reads this page. An unchanged result must not build a new list:
    // every project row takes `settledSessions`, so a new array renders them all.
    if (
      current
      && current.hasMore === page.hasMore
      && current.total === page.total
      && current.sessions.length === page.sessions.length
      && current.sessions.every((row, index) => shallow(row, page.sessions[index]))
    ) return
    const next = { ...settledByFolderRef.current, [folderPath]: page }
    settledByFolderRef.current = next
    setSettledByFolder(next)
  }, [])

  // One project's settled page. A refresh asks for at least as many rows as are
  // already on screen, so opening the next page does not collapse on the next
  // session-changed notice. The host key is captured so a late answer cannot
  // paint under a host the user has already left.
  const replaceSettled = useCallback((folderPath: string) => {
    const hostKey = pinnedHostRef.current
    const generation = (settledGeneration.current.get(folderPath) ?? 0) + 1
    settledGeneration.current.set(folderPath, generation)
    const wanted = Math.max(SETTLED_PAGE_SIZE, settledByFolderRef.current[folderPath]?.sessions.length ?? 0)
    void (async () => {
      try {
        const collected: PinnedSessionEntry[] = []
        let offset = 0
        let hasMore = true
        let total = 0
        const { connectionId, projectPath } = settledListTarget(folderPath)
        while (offset < wanted && hasMore) {
          const limit = Math.min(SETTLED_QUERY_CAP, wanted - offset)
          const page = await window.environment.listSettledSessions(connectionId, { projectPath, limit, offset })
          if (pinnedHostRef.current !== hostKey || settledGeneration.current.get(folderPath) !== generation) return
          collected.push(...page.sessions)
          total = page.total
          hasMore = page.sessions.length >= limit
          offset += page.sessions.length
          if (page.sessions.length === 0) break
        }
        if (pinnedHostRef.current !== hostKey || settledGeneration.current.get(folderPath) !== generation) return
        const sessions = dedupeSettled(collected)
        publishSettled(folderPath, { sessions, hasMore, total: Math.max(sessions.length, total) })
      } catch {
        // Keep the page already on screen. A failed refresh must not hide finished work.
      }
    })()
  }, [publishSettled])
  useEffect(() => {
    replaceSettledRef.current = replaceSettled
  }, [replaceSettled])

  const loadMoreSettledSessions = useCallback((folderPath: string) => {
    const current = settledByFolderRef.current[folderPath]
    if (!current?.hasMore || settledAppendFlight.current.has(folderPath)) return Promise.resolve()
    const hostKey = pinnedHostRef.current
    const generation = settledGeneration.current.get(folderPath) ?? 0
    const offset = current.sessions.length
    const { connectionId, projectPath } = settledListTarget(folderPath)
    settledAppendFlight.current.add(folderPath)
    return window.environment.listSettledSessions(connectionId, {
      projectPath, limit: SETTLED_PAGE_SIZE, offset,
    }).then((page) => {
      if (pinnedHostRef.current !== hostKey || (settledGeneration.current.get(folderPath) ?? 0) !== generation) return
      const existingPage = settledByFolderRef.current[folderPath]
      const existing = existingPage?.sessions ?? []
      const sessions = dedupeSettled([...existing, ...page.sessions])
      publishSettled(folderPath, {
        sessions,
        hasMore: page.sessions.length >= SETTLED_PAGE_SIZE,
        total: Math.max(sessions.length, page.total, existingPage?.total ?? 0),
      })
    }).catch(() => {
      // Leave hasMore set so the next scroll can retry.
    }).finally(() => {
      settledAppendFlight.current.delete(folderPath)
    })
  }, [publishSettled])

  const refreshSettled = useCallback((folderPath?: string) => {
    const folders = folderPath
      ? [folderPath]
      : [...new Set([...Object.keys(folderSessionsRef.current), ...Object.keys(settledByFolderRef.current)])]
    for (const folder of folders) replaceSettled(folder)
  }, [replaceSettled])

  const refreshFolderSessions = useCallback((folderPath: string) => {
    loadFolderSessions(folderPath, 'refresh')
  }, [loadFolderSessions])

  const settledSessions = useMemo(
    () => Object.values(settledByFolder).flatMap((page) => page.sessions),
    [settledByFolder],
  )
  const settledHasMore = useMemo(() => {
    const hasMore: Record<string, boolean> = {}
    for (const [folderPath, page] of Object.entries(settledByFolder)) {
      if (page.hasMore) hasMore[folderPath] = true
    }
    return hasMore
  }, [settledByFolder])
  const settledCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const [folderPath, page] of Object.entries(settledByFolder)) {
      counts[folderPath] = Math.max(page.sessions.length, page.total)
    }
    return counts
  }, [settledByFolder])

  // Pins follow the host switcher. Drop settled rows from the previous host,
  // then reload only projects whose session list is already on screen.
  useEffect(() => {
    pinnedHostRef.current = pinnedKey
    setPinnedSessions([])
    settledByFolderRef.current = {}
    setSettledByFolder({})
    refreshPinned()
    for (const folderPath of Object.keys(folderSessionsRef.current)) replaceSettledRef.current(folderPath)
  }, [pinnedKey, refreshPinned])

  const pinnedStatuses = useChatStore(useShallow((s) => {
    const map: Record<string, string> = {}
    for (const p of pinnedSessions) {
      const proj = s.projectSessions[p.folderPath]
      const status = proj?._sessions?.[p.sessionId]?.status ?? ''
      const unseen = proj?.unseenCompletedSessions?.has(p.sessionId) ? '1' : '0'
      map[p.sessionId] = `${status}:${unseen}`
    }
    return map
  }))
  // A session becoming live can insert or reorder a row, so the open folder is
  // re-read. Leaving live does not change list order (that follows the last user
  // message) and re-reading here flashes the sidebar when a turn ends. Folder
  // and session changes still load. Collaboration inserts arrive through
  // `onSessionChanged`, which invalidates an in-flight read. The applied key
  // survives a StrictMode double invoke so the second pass does not load again,
  // and a session switch in the same render as idle still does.
  const sessionLive = currentStatus === 'streaming' || currentStatus === 'background'
  const appliedListKey = useRef<string | null>(null)
  useEffect(() => {
    if (!currentFolder) {
      appliedListKey.current = null
      return
    }
    const sid = currentActiveSid ?? ''
    const key = `${currentFolder}\0${sid}\0${sessionLive ? '1' : '0'}`
    if (appliedListKey.current === key) return
    const previous = appliedListKey.current
    appliedListKey.current = key
    if (previous) {
      const [prevFolder, prevSid, prevLive] = previous.split('\0')
      if (prevFolder === currentFolder && prevSid === sid && prevLive === '1' && !sessionLive) return
    }
    void loadFolderSessions(currentFolder, 'current')
  }, [currentFolder, currentActiveSid, sessionLive, loadFolderSessions])
  useEffect(() => {
    return window.app.onSessionChanged((projectPath) => {
      // A phone can create voice in another expanded project while desktop stays
      // in its current chat. Refresh that cached list without switching chats.
      if (projectPath) {
        if (projectPath === currentFolder || folderSessionsRef.current[projectPath]) refreshFolderSessions(projectPath)
      } else {
        for (const folder of new Set([...Object.keys(folderSessionsRef.current), ...(currentFolder ? [currentFolder] : [])])) refreshFolderSessions(folder)
      }
      refreshPinned()
      refreshSettled()
      // A collaboration child pointed outside every open project registers its
      // own — without this the new project row only appears after a restart.
      void useAppStore.getState().fetchRecentFolders()
    })
  }, [currentFolder, refreshFolderSessions, refreshPinned, refreshSettled])
  const sessionListNonce = useAppStore((s) => s.sessionListNonce)
  useEffect(() => {
    if (!currentFolder || sessionListNonce === 0) return
    refreshFolderSessions(currentFolder)
    refreshPinned()
    refreshSettled()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionListNonce])

  const handlePinSession = useCallback(async (sessionId: string, pinned: boolean, folderPath: string) => {
    await setSessionFlags(folderPath, sessionId, { isPinned: pinned })
    refreshPinned()
    refreshFolderSessions(folderPath)
  }, [refreshPinned, refreshFolderSessions])

  const handleSettleSession = useCallback(async (sessionId: string, settled: boolean, folderPath: string) => {
    await setSessionFlags(folderPath, sessionId, { isSettled: settled })
    if (settled) {
      useChatStore.setState((state) => setUnseenCompleted(state, folderPath, sessionId, false))
      try {
        await setSessionRead(folderPath, sessionId, true)
      } catch (err) {
        console.warn('[sidebar] setSessionRead failed:', err)
      }
    }
    refreshFolderSessions(folderPath)
    refreshPinned()
    refreshSettled()
  }, [refreshFolderSessions, refreshPinned, refreshSettled])

  const executeDeleteSession = useCallback(async (target: { sessionId: string; folderPath: string }) => {
    const remote = parseRemoteProjectKey(target.folderPath)
    await removeSession(target.folderPath, target.sessionId)

    const current = useChatStore.getState().projectSessions[target.folderPath]
    if (current?._activeSessionId === target.sessionId) {
      if (remote) {
        // Avoid local resetSession minting a desktop SessionManager session.
        useChatStore.setState((s) => {
          const proj = s.projectSessions[target.folderPath]
          if (!proj) return s
          return {
            projectSessions: {
              ...s.projectSessions,
              [target.folderPath]: { ...proj, _activeSessionId: null },
            },
          }
        })
      } else {
        await resetSession()
      }
    }
    // Every delete must also drop the session from renderer memory, not just from the
    // database. The sidebar synthesises rows out of `_sessions` for anything the DB has
    // no row for yet — a voice session has no chat messages and often lives only there —
    // so a row left in memory survives its own deletion and can never be removed.
    removeSessionFromMemory(target.folderPath, target.sessionId)

    setFolderSessions((prev) => ({
      ...prev,
      [target.folderPath]: (prev[target.folderPath] ?? []).filter(
        (s) => s.sessionId !== target.sessionId
      ),
    }))
    setPinnedSessions((prev) => prev.filter((s) => s.sessionId !== target.sessionId))
    const settledPage = settledByFolderRef.current[target.folderPath]
    if (settledPage) {
      const sessions = settledPage.sessions.filter((session) => session.sessionId !== target.sessionId)
      const removed = sessions.length < settledPage.sessions.length
      const nextSettled = {
        ...settledByFolderRef.current,
        [target.folderPath]: {
          ...settledPage,
          sessions,
          total: removed ? Math.max(sessions.length, settledPage.total - 1) : settledPage.total,
        },
      }
      settledByFolderRef.current = nextSettled
      setSettledByFolder(nextSettled)
    }
    refreshFolderSessions(target.folderPath)
    if (!remote) {
      refreshPinned()
      refreshSettled()
    }
  }, [refreshFolderSessions, refreshPinned, refreshSettled, resetSession, removeSessionFromMemory])


  return {
    currentActiveSid, folderSessions, loadingFolders, folderSessionsRef,
    pinnedSessions, pinnedStatuses, settledSessions, settledHasMore, settledCounts, loadFolderSessions,
    loadMoreSettledSessions, refreshFolderSessions, refreshPinned, handlePinSession,
    handleSettleSession, executeDeleteSession,
  }
}
