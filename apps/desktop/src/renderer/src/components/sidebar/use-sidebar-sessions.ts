import { useCallback, useEffect, useRef, useState } from 'react'
import { shallow } from 'zustand/shallow'
import { useShallow } from 'zustand/react/shallow'
import type { PinnedSessionEntry, RecentFolder, SessionHistoryEntry } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { traceSidebar } from './sidebar-trace'

const PAGE_SIZE = 13
// Read through the next root to keep the last visible parent's children together.
const INITIAL_ROOT_TARGET = 14

type LoadReason = 'expand' | 'refresh' | 'current' | 'switch' | 'show_more'
interface ListRequest {
  promise: Promise<SessionHistoryEntry[]>
  invalidated: boolean
}

function visibleRootCount(sessions: SessionHistoryEntry[]): number {
  return sessions.filter((session) => !session.isHidden && !session.parentSessionId).length
}

export function useSidebarSessions({ currentFolder, selectedHostConnectionId, hostProjects }: {
  currentFolder: string | null
  selectedHostConnectionId: string
  hostProjects: RecentFolder[]
}) {
  const [folderSessions, setFolderSessions] = useState<Record<string, SessionHistoryEntry[]>>({})
  const [folderSessionsHaveMore, setFolderSessionsHaveMore] = useState<Record<string, boolean>>({})
  const [pinnedSessions, setPinnedSessions] = useState<PinnedSessionEntry[]>([])
  const folderSessionsRef = useRef(folderSessions)
  const folderSessionsHaveMoreRef = useRef(folderSessionsHaveMore)
  const inFlight = useRef(new Map<string, ListRequest>())
  const resetSession = useChatStore((state) => state.resetSession)
  const removeSessionFromMemory = useChatStore((state) => state.removeSessionFromMemory)
  const { currentActiveSid, currentStatus } = useChatStore(useShallow((s) => {
    const proj = currentFolder ? s.projectSessions[currentFolder] : undefined
    const sid = proj?._activeSessionId
    return { currentActiveSid: sid, currentStatus: sid ? proj?._sessions?.[sid]?.status : undefined }
  }))

  useEffect(() => { folderSessionsRef.current = folderSessions }, [folderSessions])
  useEffect(() => { folderSessionsHaveMoreRef.current = folderSessionsHaveMore }, [folderSessionsHaveMore])

  const load = useCallback((folderPath: string, reason: LoadReason, rootTarget: number, initial: SessionHistoryEntry[] = []) => {
    const existing = inFlight.current.get(folderPath)
    if (existing) {
      // A change notification invalidates the snapshot already being read. Sharing
      // that request without another read loses changes until the user navigates.
      if (reason === 'refresh') existing.invalidated = true
      traceSidebar('sessions_load:reuse', { folderPath, reason, invalidated: existing.invalidated }, folderPath)
      return existing.promise
    }

    const request: ListRequest = { promise: Promise.resolve([]), invalidated: false }
    request.promise = (async () => {
      let seed = initial
      for (;;) {
        request.invalidated = false
        const sessions = [...seed]
        let hasMore = true
        const startedAt = performance.now()
        traceSidebar('sessions_load:start', { folderPath, reason, pageSize: PAGE_SIZE }, folderPath)
        try {
          const { listSessionsPage } = await import('@/lib/session-list-ops')
          const projectId = hostProjects.find((project) => project.path === folderPath)?.id ?? null
          while (visibleRootCount(sessions) < rootTarget && hasMore) {
            const offset = sessions.length
            const page = await listSessionsPage(folderPath, { limit: PAGE_SIZE, offset, projectId })
            sessions.push(...page)
            hasMore = page.length >= PAGE_SIZE
            traceSidebar('sessions_load:page', {
              folderPath, reason, offset, pageCount: page.length,
              visibleCount: visibleRootCount(sessions),
              elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
              remote: Boolean(parseRemoteProjectKey(folderPath)),
            }, folderPath)
            if (request.invalidated) break
          }
          if (request.invalidated) {
            // Also restart pagination: appending to old offsets can skip or repeat
            // rows when creation changes the ordering while "show more" is loading.
            seed = []
            continue
          }
          folderSessionsRef.current = { ...folderSessionsRef.current, [folderPath]: sessions }
          setFolderSessions((previous) => {
            const cached = previous[folderPath]
            if (cached?.length === sessions.length && cached.every((entry, index) => shallow(entry, sessions[index]))) return previous
            return { ...previous, [folderPath]: sessions }
          })
          folderSessionsHaveMoreRef.current = { ...folderSessionsHaveMoreRef.current, [folderPath]: hasMore }
          setFolderSessionsHaveMore((previous) => previous[folderPath] === hasMore ? previous : { ...previous, [folderPath]: hasMore })
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
          if (!request.invalidated) return seed
          seed = []
        }
      }
    })().finally(() => {
      if (inFlight.current.get(folderPath) === request) inFlight.current.delete(folderPath)
    })
    inFlight.current.set(folderPath, request)
    return request.promise
  }, [hostProjects])

  const loadFolderSessions = useCallback((folderPath: string, reason: Exclude<LoadReason, 'show_more'>) =>
    load(folderPath, reason, INITIAL_ROOT_TARGET), [load])

  const loadMoreFolderSessions = useCallback(async (folderPath: string, minimumRootCount: number) => {
    const pending = inFlight.current.get(folderPath)
    if (pending) await pending.promise
    const cached = folderSessionsRef.current[folderPath] ?? []
    if (!folderSessionsHaveMoreRef.current[folderPath] || visibleRootCount(cached) >= minimumRootCount) return cached
    return load(folderPath, 'show_more', minimumRootCount, cached)
  }, [load])

  /**
   * Which host the rows currently in `pinnedSessions` came from. Read only when
   * a request resolves, so a slow node answering after the user switched away
   * cannot paint its rows under another host's label.
   */
  const pinnedHostRef = useRef(selectedHostConnectionId)
  const refreshPinned = useCallback(() => {
    const connectionId = selectedHostConnectionId
    window.environment
      .listPinnedSessions(connectionId)
      .then((rows) => {
        if (pinnedHostRef.current !== connectionId) return
        setPinnedSessions(rows)
      })
      .catch(() => {
        if (pinnedHostRef.current === connectionId) setPinnedSessions([])
      })
  }, [selectedHostConnectionId])

  const refreshFolderSessions = useCallback((folderPath: string) => {
    loadFolderSessions(folderPath, 'refresh')
  }, [loadFolderSessions])

  // Pinned follows the host switcher. Clear first: the previous host's pins
  // point at projects on a different machine, so leaving them up while the new
  // list loads would offer rows the selected host does not have.
  useEffect(() => {
    pinnedHostRef.current = selectedHostConnectionId
    setPinnedSessions([])
    refreshPinned()
  }, [selectedHostConnectionId, refreshPinned])

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
  useEffect(() => {
    if (!currentFolder) return
    void loadFolderSessions(currentFolder, 'current')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolder, currentStatus, currentActiveSid])
  useEffect(() => {
    if (!currentFolder) return
    return window.app.onSessionChanged(() => {
      refreshFolderSessions(currentFolder)
      refreshPinned()
      // A collaboration child pointed outside every open project registers its
      // own — without this the new project row only appears after a restart.
      void useAppStore.getState().fetchRecentFolders()
    })
  }, [currentFolder, refreshFolderSessions, refreshPinned])
  const sessionListNonce = useAppStore((s) => s.sessionListNonce)
  useEffect(() => {
    if (!currentFolder || sessionListNonce === 0) return
    refreshFolderSessions(currentFolder)
    refreshPinned()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionListNonce])

  const handlePinSession = useCallback(async (sessionId: string, pinned: boolean, folderPath: string) => {
    const remote = parseRemoteProjectKey(folderPath)
    if (remote) {
      await window.environment.setSessionUiFlags(remote.connectionId, sessionId, { isPinned: pinned })
      refreshPinned()
      refreshFolderSessions(folderPath)
      return
    }
    await window.app.pinSession(sessionId, pinned)
    refreshPinned()
    refreshFolderSessions(folderPath)
  }, [refreshPinned, refreshFolderSessions])

  const handleHideSession = useCallback(async (sessionId: string, hidden: boolean, folderPath: string) => {
    const remote = parseRemoteProjectKey(folderPath)
    if (remote) {
      await window.environment.setSessionUiFlags(remote.connectionId, sessionId, { isHidden: hidden })
      refreshFolderSessions(folderPath)
      return
    }
    await window.app.hideSession(sessionId, hidden)
    refreshFolderSessions(folderPath)
  }, [refreshFolderSessions])

  const executeDeleteSession = useCallback(async (target: { sessionId: string; folderPath: string }) => {
    const remote = parseRemoteProjectKey(target.folderPath)
    if (remote) {
      await window.environment.removeSession(remote.connectionId, target.sessionId)
    } else {
      await window.app.deleteSession(target.sessionId)
    }

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
    refreshFolderSessions(target.folderPath)
    if (!remote) refreshPinned()
  }, [refreshFolderSessions, refreshPinned, resetSession, removeSessionFromMemory])


  return {
    currentActiveSid, folderSessions, folderSessionsHaveMore, folderSessionsRef,
    pinnedSessions, pinnedStatuses, loadFolderSessions, loadMoreFolderSessions,
    refreshFolderSessions, refreshPinned, handlePinSession, handleHideSession,
    executeDeleteSession,
  }
}
