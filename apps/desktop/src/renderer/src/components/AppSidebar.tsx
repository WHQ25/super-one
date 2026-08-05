import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { Plus, Settings, FolderClosed, ArrowDownUp, SquarePen, MessageSquare, Copy, Check, Smartphone, Wifi, Cloud, Monitor, ChevronDown, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { useChatStore } from '@/stores/chat'
import { useAppStore, type SidebarTab } from '@/stores/app'
import { parseRemoteProjectKey, remoteProjectKey } from '@/lib/remote-project-key'
import { useShallow } from 'zustand/react/shallow'
import { shallow } from 'zustand/shallow'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useRemoteStatus } from '@/hooks/useRemoteStatus'

import { cn } from '@superone/ui/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { FileTree } from '@/components/sidebar/FileTree'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { ProjectSidebarRow } from '@/components/sidebar/ProjectSidebarRow'
import { PinnedSessionRow } from '@/components/sidebar/PinnedSessionRow'
import { RenameSessionDialog } from '@/components/sidebar/RenameSessionDialog'
import { AddProjectDialog } from '@/components/sidebar/add-project/AddProjectDialog'
import { traceSidebar, useSidebarRenderTrace } from '@/components/sidebar/sidebar-trace'
import type { RecentFolder, SessionHistoryEntry, PinnedSessionEntry } from '@superone/shared/agent-types'
import type { EnvironmentListItem } from '@superone/shared/environment'
import { getDeleteSessionRecovery, shouldSkipDeleteConfirm, setSkipDeleteConfirm } from './session-delete-helpers'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { useMiniAppStore } from '@/stores/miniapp'
import { AppDrawer } from '@/components/sidebar/AppDrawer'
import { BrandColorPopover } from '@/components/sidebar/BrandColorPopover'
import { UsageStatusIcon } from '@/components/UsageStatusIcon'
import { UpdateStatusIcon } from '@/components/UpdateStatusIcon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { CommandShortcut } from '@superone/ui/components/ui/command'

const isMac = window.app.platform === 'darwin'

type SortMode = 'recent' | 'added'

const MAX_DISPLAY_SESSIONS = 12
const SESSIONS_FETCH_LIMIT = MAX_DISPLAY_SESSIONS + 1
// Read through the next root so children belonging to the overflow root cannot
// be stranded on the following row-based database page.
const SESSIONS_FETCH_ROOT_TARGET = SESSIONS_FETCH_LIMIT + 1
const EMPTY_SESSIONS: SessionHistoryEntry[] = []

export const AppSidebar = memo(function AppSidebar() {
  const { t } = useTranslation()
  const { navigateTo, selectProject, removeRecentFolder, setSidebarTab, setSelectedHostConnectionId } = useAppStore(
    useShallow((s) => ({
      navigateTo: s.navigateTo,
      selectProject: s.selectProject,
      removeRecentFolder: s.removeRecentFolder,
      setSidebarTab: s.setSidebarTab,
      setSelectedHostConnectionId: s.setSelectedHostConnectionId,
    })),
  )
  const sidebarTab = useAppStore((s) => s.sidebarTab)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const recentFolders = useAppStore((s) => s.recentFolders)
  const selectedHostConnectionId = useAppStore((s) => s.selectedHostConnectionId)
  const experimentalRemoteNodesEnabled = useAppStore((s) => s.experimentalRemoteNodesEnabled)
  const isFullscreen = useFullscreen()
  const isMac = window.app.platform === 'darwin'
  const localHostLabel = isMac ? t('sidebar.thisMac') : t('sidebar.thisPc')
  const resetSession = useChatStore((s) => s.resetSession)
  const removeSessionFromMemory = useChatStore((s) => s.removeSessionFromMemory)
  const switchSession = useChatStore((s) => s.switchSession)
  const { currentActiveSid, currentStatus } = useChatStore(useShallow((s) => {
    const proj = currentFolder ? s.projectSessions[currentFolder] : undefined
    const sid = proj?._activeSessionId
    return { currentActiveSid: sid, currentStatus: sid ? proj?._sessions?.[sid]?.status : undefined }
  }))

  const [filesMounted, setExplorerMounted] = useState(sidebarTab === 'files')
  if (sidebarTab === 'files' && !filesMounted) setExplorerMounted(true)

  const fetchApps = useMiniAppStore((s) => s.fetchApps)
  useEffect(() => { fetchApps(currentFolder ?? undefined) }, [fetchApps, currentFolder])

  const sidebarTabs: SidebarTab[] = ['sessions', 'files']
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (e.shiftKey || e.altKey) return
      const digit = e.key >= '0' && e.key <= '9' ? (e.key === '0' ? 10 : parseInt(e.key)) : -1
      if (digit < 0) return
      if (mod && digit >= 1 && digit <= sidebarTabs.length) {
        e.preventDefault()
        setSidebarTab(sidebarTabs[digit - 1])
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isMac, setSidebarTab])

  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [frozenRecentOrder, setFrozenRecentOrder] = useState<string[] | null>(null)
  const prevSortModeRef = useRef<SortMode>('recent')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [folderSessions, setFolderSessions] = useState<Record<string, SessionHistoryEntry[]>>({})
  const [pinnedSessions, setPinnedSessions] = useState<PinnedSessionEntry[]>([])
  const [deleteTarget, setDeleteTarget] = useState<{ sessionId: string; title: string; folderPath: string; provider: import('@superone/shared/agent-types').HarnessId } | null>(null)
  const [copiedCmd, setCopiedCmd] = useState<'cd' | 'resume' | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{
    name: string
    path: string
    id?: string
  } | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ sessionId: string; title: string; folderPath: string } | null>(null)
  const [hostItems, setHostItems] = useState<EnvironmentListItem[]>([])
  const [hostProjects, setHostProjects] = useState<RecentFolder[]>([])
  const [hostProjectsLoading, setHostProjectsLoading] = useState(false)
  const [hostProjectsError, setHostProjectsError] = useState<string | null>(null)
  /** Bump to re-run remote project load / auto-connect. */
  const [hostProjectsRetryNonce, setHostProjectsRetryNonce] = useState(0)
  const forceHostProjectsRefreshRef = useRef(false)
  const [openProjectDialogOpen, setOpenProjectDialogOpen] = useState(false)
  const fetchRecentFolders = useAppStore((s) => s.fetchRecentFolders)
  const inFlightFolderSessions = useRef(new Map<string, Promise<SessionHistoryEntry[]>>())
  const expandedFoldersRef = useRef(expandedFolders)
  const folderSessionsRef = useRef(folderSessions)

  // Environments for the host switcher (local + paired remotes).
  // Skip listing remotes when the experiment is off.
  useEffect(() => {
    if (!experimentalRemoteNodesEnabled) {
      setHostItems([])
      return
    }
    let cancelled = false
    const refresh = () => {
      void window.environment.listItems().then((items) => {
        if (!cancelled) setHostItems(items)
      }).catch(() => {
        if (!cancelled) setHostItems([])
      })
    }
    refresh()
    const unsub = window.environment.onStatusEvent(() => refresh())
    return () => {
      cancelled = true
      unsub()
    }
  }, [experimentalRemoteNodesEnabled])

  // Force local host when the experiment is disabled.
  useEffect(() => {
    if (!experimentalRemoteNodesEnabled && selectedHostConnectionId !== 'local') {
      setSelectedHostConnectionId('local')
    }
  }, [experimentalRemoteNodesEnabled, selectedHostConnectionId, setSelectedHostConnectionId])

  // Load projects for the selected host. Local uses recentFolders; remote auto-connects then project.list.
  useEffect(() => {
    let cancelled = false
    if (selectedHostConnectionId === 'local') {
      setHostProjects([])
      setHostProjectsError(null)
      setHostProjectsLoading(false)
      return () => {
        cancelled = true
      }
    }

    setHostProjectsLoading(true)
    setHostProjectsError(null)

    void (async () => {
      try {
        const refresh = forceHostProjectsRefreshRef.current
        forceHostProjectsRefreshRef.current = false
        const host = hostItems.find((h) => h.connectionId === selectedHostConnectionId)
        const live = host?.state === 'connected' || host?.state === 'synchronizing'
        // Selecting a remote host always ensures a live connection.
        if (!live) {
          await window.environment.connect(selectedHostConnectionId)
        }
        if (cancelled) return
        const projects = await window.environment.listProjects(
          selectedHostConnectionId,
          refresh ? { refresh: true } : undefined,
        )
        if (cancelled) return
        setHostProjects(
          projects.map((p) => ({
            id: p.projectId,
            // Host-scoped key so chat-store / expand state never collides with local paths.
            path: remoteProjectKey(selectedHostConnectionId, p.path),
            name: p.name,
            missing: p.missing,
            addedAt: p.lastActiveAt ? new Date(p.lastActiveAt).toISOString() : new Date(0).toISOString(),
            lastOpened: p.lastActiveAt
              ? new Date(p.lastActiveAt).toISOString()
              : new Date(0).toISOString(),
          })),
        )
      } catch (err) {
        if (cancelled) return
        setHostProjects([])
        setHostProjectsError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setHostProjectsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedHostConnectionId, hostItems, hostProjectsRetryNonce])

  const refreshHostProjects = useCallback(() => {
    if (selectedHostConnectionId === 'local' || hostProjectsLoading) return
    forceHostProjectsRefreshRef.current = true
    setHostProjectsRetryNonce((nonce) => nonce + 1)
  }, [selectedHostConnectionId, hostProjectsLoading])

  // Drop selection if the remote host was forgotten.
  useEffect(() => {
    if (selectedHostConnectionId === 'local') return
    if (hostItems.length === 0) return
    if (!hostItems.some((h) => h.connectionId === selectedHostConnectionId)) {
      setSelectedHostConnectionId('local')
    }
  }, [hostItems, selectedHostConnectionId, setSelectedHostConnectionId])

  useEffect(() => {
    expandedFoldersRef.current = expandedFolders
  }, [expandedFolders])

  useEffect(() => {
    folderSessionsRef.current = folderSessions
  }, [folderSessions])

  const loadFolderSessions = useCallback(async (folderPath: string, reason: 'expand' | 'refresh' | 'current' | 'switch') => {
    const existing = inFlightFolderSessions.current.get(folderPath)
    if (existing) {
      traceSidebar('sessions_load:reuse', { folderPath, reason }, folderPath)
      return existing
    }

    const promise = (async () => {
      const sessions: SessionHistoryEntry[] = []
      let offset = 0
      let visibleCount = 0
      const startedAt = performance.now()
      traceSidebar('sessions_load:start', { folderPath, reason, pageSize: SESSIONS_FETCH_LIMIT }, folderPath)
      try {
        const remote = parseRemoteProjectKey(folderPath)
        if (remote) {
          // Remote node sessions via EnvironmentGateway (project id from hostProjects).
          const project = hostProjects.find((p) => p.path === folderPath)
          const projectId = project?.id
          if (!projectId) {
            setFolderSessions((prev) => ({ ...prev, [folderPath]: [] }))
            inFlightFolderSessions.current.delete(folderPath)
            return []
          }
          const remoteRows = await window.environment.listSessions(remote.connectionId, projectId)
          for (const row of remoteRows) {
            sessions.push({
              sessionId: row.sessionId,
              title: row.title,
              lastActiveAt: row.lastActiveAt,
              provider: (row.provider as SessionHistoryEntry['provider']) ?? 'claude',
              messageCount: row.messageCount,
              isPinned: row.isPinned,
              isHidden: row.isHidden,
            })
          }
          visibleCount = sessions.length
        } else {
          while (sessions.filter((session) => !session.isHidden && !session.parentSessionId).length < SESSIONS_FETCH_ROOT_TARGET) {
            const page = await window.app.listSessionsForFolderPage(folderPath, SESSIONS_FETCH_LIMIT, offset)
            visibleCount += page.filter((session) => !session.isHidden && !session.parentSessionId).length
            traceSidebar('sessions_load:page', {
              folderPath,
              reason,
              offset,
              pageCount: page.length,
              visibleCount,
              elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
            }, folderPath)
            if (page.length === 0) break
            sessions.push(...page)
            if (page.length < SESSIONS_FETCH_LIMIT) break
            offset += page.length
          }
        }
        setFolderSessions((prev) => {
          const existing = prev[folderPath]
          if (existing && existing.length === sessions.length && existing.every((session, i) => shallow(session, sessions[i]))) {
            return prev
          }
          return { ...prev, [folderPath]: sessions }
        })
        traceSidebar('sessions_load:end', {
          folderPath,
          reason,
          fetchedCount: sessions.length,
          visibleCount,
          elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        }, folderPath)
        inFlightFolderSessions.current.delete(folderPath)
        return sessions
      } catch (error) {
        traceSidebar('sessions_load:error', {
          folderPath,
          reason,
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        }, folderPath)
        inFlightFolderSessions.current.delete(folderPath)
        return []
      }
    })()

    inFlightFolderSessions.current.set(folderPath, promise)
    return promise
  }, [hostProjects])

  const toggleExpand = useCallback((folderPath: string) => {
    const remote = parseRemoteProjectKey(folderPath)
    if (remote) {
      const project = hostProjects.find((item) => item.path === folderPath)
      void selectProject(folderPath, {
        connectionId: remote.connectionId,
        projectId: project?.id,
      })
    }
    const isExpanded = expandedFoldersRef.current.has(folderPath)
    let willExpand = false
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) {
        next.delete(folderPath)
      } else {
        next.add(folderPath)
        willExpand = true
      }
      return next
    })
    if (willExpand) {
      const startedAt = performance.now()
      traceSidebar('project_expand:start', { folderPath, wasExpanded: isExpanded }, folderPath)
      requestAnimationFrame(() => {
        traceSidebar('project_expand:frame', {
          folderPath,
          sinceStartMs: Math.round((performance.now() - startedAt) * 100) / 100,
        }, folderPath)
      })
      void loadFolderSessions(folderPath, 'expand').then(() => {
        traceSidebar('project_expand:end', {
          folderPath,
          elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        }, folderPath)
      })
    } else {
      traceSidebar('project_expand:collapse', { folderPath, wasExpanded: isExpanded }, folderPath)
    }
  }, [hostProjects, loadFolderSessions, selectProject])

  const refreshPinned = useCallback(() => {
    window.app.listPinnedSessions().then(setPinnedSessions)
  }, [])

  const refreshFolderSessions = useCallback((folderPath: string) => {
    loadFolderSessions(folderPath, 'refresh')
  }, [loadFolderSessions])

  // Load pinned sessions on mount
  useEffect(() => { refreshPinned() }, [refreshPinned])

  const currentSessionId = currentActiveSid
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
  }, [currentFolder, currentStatus, currentSessionId])
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

  const handleSwitchSession = useCallback(async (folderPath: string, sessionId: string) => {
    if (useMosaicStore.getState().focusOrReplaceFocused(folderPath, sessionId)) return
    const ps = useChatStore.getState().projectSessions[folderPath]
    const currentSid = ps?._activeSessionId
    if (folderPath === currentFolder && currentSid === sessionId) return
    setExpandedFolders((prev) => prev.has(folderPath) ? prev : new Set([...prev, folderPath]))
    if (!folderSessionsRef.current[folderPath]) {
      void loadFolderSessions(folderPath, 'switch')
    }
    const remote = parseRemoteProjectKey(folderPath)
    const project = remote
      ? hostProjects.find((p) => p.path === folderPath)
      : undefined
    await selectProject(folderPath, {
      connectionId: remote?.connectionId ?? 'local',
      projectId: project?.id,
    })
    // switchSession handles remote hydrate (session.get) and local SQLite resume.
    await switchSession(sessionId)
  }, [selectProject, switchSession, currentFolder, loadFolderSessions, hostProjects])

  const handlePinSession = useCallback(async (sessionId: string, pinned: boolean, folderPath: string) => {
    const remote = parseRemoteProjectKey(folderPath)
    if (remote) {
      await window.environment.setSessionUiFlags(remote.connectionId, sessionId, { isPinned: pinned })
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

  const [skipConfirm, setSkipConfirm] = useState(false)

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
        removeSessionFromMemory(target.folderPath, target.sessionId)
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
        resetSession()
      }
    } else {
      removeSessionFromMemory(target.folderPath, target.sessionId)
    }

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

  const handleDeleteSession = useCallback(async () => {
    if (!deleteTarget) return
    if (skipConfirm) setSkipDeleteConfirm()
    await executeDeleteSession(deleteTarget)
    setDeleteTarget(null)
    setSkipConfirm(false)
  }, [deleteTarget, skipConfirm, executeDeleteSession])

  const deleteTargetCli = getDeleteSessionRecovery(deleteTarget?.provider ?? 'claude', deleteTarget?.sessionId ?? '')


  useEffect(() => {
    if (frozenRecentOrder === null && recentFolders.length > 0) {
      setFrozenRecentOrder(recentFolders.map((f) => f.path))
    }
  }, [recentFolders, frozenRecentOrder])

  useEffect(() => {
    if (!frozenRecentOrder) return
    const known = new Set(frozenRecentOrder)
    const current = new Set(recentFolders.map((f) => f.path))
    const added = recentFolders.map((f) => f.path).filter((p) => !known.has(p))
    const kept = frozenRecentOrder.filter((p) => current.has(p))
    if (added.length === 0 && kept.length === frozenRecentOrder.length) return
    setFrozenRecentOrder([...added, ...kept])
  }, [recentFolders, frozenRecentOrder])

  useEffect(() => {
    if (prevSortModeRef.current !== 'recent' && sortMode === 'recent') {
      setFrozenRecentOrder(recentFolders.map((f) => f.path))
    }
    prevSortModeRef.current = sortMode
  }, [sortMode])

  const sourceFolders = selectedHostConnectionId === 'local' ? recentFolders : hostProjects

  const sortedFolders = useMemo(() => {
    if (sortMode === 'added') {
      return [...sourceFolders].sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    }
    if (selectedHostConnectionId !== 'local') {
      return [...sourceFolders].sort(
        (a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime(),
      )
    }
    if (!frozenRecentOrder) return sourceFolders
    const indexMap = new Map(frozenRecentOrder.map((p, i) => [p, i]))
    return [...sourceFolders].sort((a, b) => {
      const ai = indexMap.get(a.path) ?? -1
      const bi = indexMap.get(b.path) ?? -1
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return -1
      if (bi === -1) return 1
      return ai - bi
    })
  }, [sourceFolders, sortMode, frozenRecentOrder, selectedHostConnectionId])

  const remoteHosts = useMemo(
    () =>
      experimentalRemoteNodesEnabled
        ? hostItems.filter((h) => h.kind === 'remote')
        : [],
    [hostItems, experimentalRemoteNodesEnabled],
  )

  // Host switcher chrome is part of the remote-nodes experiment (even with zero remotes).
  const showHostSwitcher = experimentalRemoteNodesEnabled

  const selectedHostLabel = useMemo(() => {
    if (selectedHostConnectionId === 'local') return localHostLabel
    return (
      remoteHosts.find((h) => h.connectionId === selectedHostConnectionId)?.label ?? localHostLabel
    )
  }, [selectedHostConnectionId, localHostLabel, remoteHosts])

  const expandedTraceState = useMemo(() => Array.from(expandedFolders).sort().map((folderPath) => {
    const cached = folderSessions[folderPath] ?? []
    return {
      folderPath,
      cachedCount: cached.length,
      hiddenCount: cached.filter((session) => session.isHidden).length,
      inMemoryCount: 0,
      liveCount: 0,
      unseenCount: 0,
      activeSessionId: currentFolder === folderPath ? currentActiveSid ?? null : null,
    }
  }), [expandedFolders, folderSessions, currentFolder, currentActiveSid])

  const handleRemoveProject = useCallback((folder: RecentFolder) => {
    setRemoveError(null)
    setRemoveTarget({ name: folder.name, path: folder.path, id: folder.id })
  }, [])

  const confirmRemoveProject = useCallback(async () => {
    if (!removeTarget || removeBusy) return
    setRemoveBusy(true)
    setRemoveError(null)
    try {
      if (selectedHostConnectionId === 'local') {
        await removeRecentFolder(removeTarget.path)
      } else {
        await window.environment.removeProject(selectedHostConnectionId, {
          projectId: removeTarget.id,
          path: removeTarget.path,
        })
        setHostProjects((prev) =>
          prev.filter(
            (p) =>
              p.path !== removeTarget.path &&
              !(removeTarget.id && p.id === removeTarget.id),
          ),
        )
        // ChatSuggestions uses a separate useHostProjects() instance — force refresh.
        const { notifyHostProjectsChanged } = await import('@/lib/host-projects-bus')
        notifyHostProjectsChanged()
        // Clear in-memory chat state for this remote project key (always, not only when active).
        const { useChatStore } = await import('@/stores/chat')
        const wasActive = useAppStore.getState().currentFolder === removeTarget.path
        useChatStore.setState((s) => {
          const { [removeTarget.path]: _, ...projectSessions } = s.projectSessions
          return {
            projectSessions,
            ...(wasActive || s.activeProject === removeTarget.path
              ? { activeProject: null }
              : {}),
          }
        })
        if (wasActive) {
          useAppStore.setState({ currentFolder: null, currentProjectId: null })
        }
      }
      setExpandedFolders((prev) => {
        const next = new Set(prev)
        next.delete(removeTarget.path)
        return next
      })
      setRemoveTarget(null)
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoveBusy(false)
    }
  }, [removeTarget, removeBusy, selectedHostConnectionId, removeRecentFolder])

  const handleRequestRenameSession = useCallback((target: { sessionId: string; title: string; folderPath: string }) => {
    setRenameTarget(target)
  }, [])

  const handleRequestDeleteSession = useCallback((target: { sessionId: string; title: string; folderPath: string; provider: import('@superone/shared/agent-types').HarnessId }) => {
    if (shouldSkipDeleteConfirm()) {
      void executeDeleteSession(target)
    } else {
      setDeleteTarget(target)
    }
  }, [executeDeleteSession])

  const createNewSession = useCallback(async () => {
    const before = useChatStore.getState()
    const projectPath = before.activeProject
    const previousSessionId = projectPath ? before.projectSessions[projectPath]?._activeSessionId : null
    await resetSession()
    if (!projectPath) return
    const sessionId = useChatStore.getState().projectSessions[projectPath]?._activeSessionId
    if (sessionId && sessionId !== previousSessionId) {
      useMosaicStore.getState().focusOrReplaceFocused(projectPath, sessionId)
    }
  }, [resetSession])

  const handleNewSession = useCallback((folderPath: string) => {
    const remote = parseRemoteProjectKey(folderPath)
    if (remote) {
      // Same lifecycle as local: open project → mint renderer draft only.
      // Node session.create happens on first send (resolveNodeSessionId) with UI harness.
      void (async () => {
        const project = hostProjects.find((p) => p.path === folderPath)
        await selectProject(folderPath, {
          connectionId: remote.connectionId,
          projectId: project?.id,
        })
        await createNewSession()
        setExpandedFolders((prev) =>
          prev.has(folderPath) ? prev : new Set([...prev, folderPath]),
        )
      })()
      return
    }
    void selectProject(folderPath).then(createNewSession)
  }, [selectProject, createNewSession, hostProjects])

  useSidebarRenderTrace({
    sidebarTab,
    currentFolder,
    recentFolderCount: sortedFolders.length,
    pinnedCount: pinnedSessions.length,
    expanded: expandedTraceState,
  })

  return (
    <div className="flex h-full w-full shrink-0 select-none flex-col bg-sidebar text-sidebar-foreground">
      {isMac && (
        <div
          className={cn('flex h-11 shrink-0 items-center pt-[2px]', isFullscreen ? 'pl-2' : 'pl-[18px]')}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {!isFullscreen && <div className="w-[66px] shrink-0" />}
          <LayoutToggle />
        </div>
      )}

      {/* New session button */}
      <div className={cn('mx-2 mb-1 shrink-0', !isMac && 'pt-2')}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void createNewSession()}
          className="mb-1 w-full justify-center gap-1.5 border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar hover:border-sidebar-foreground/25"
        >
          <SquarePen className="size-3.5" />
          {t('sidebar.newSession')}
        </Button>
      </div>
      <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as SidebarTab)} className="mx-1.5 mb-1 shrink-0">
        <TabsList className="sidebar-session-tabs">
          <TabsTrigger value="sessions" className="py-2">
            <MessageSquare className="size-3.5" />
            {t('sidebar.tabs.sessions')}
          </TabsTrigger>
          <TabsTrigger value="files" className="py-2">
            <FolderClosed className="size-3.5" />
            {t('sidebar.tabs.files')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AppDrawer />

      {pinnedSessions.length > 0 && sidebarTab === 'sessions' && (
        <div className="flex flex-col px-1.5 pb-1">
          <span className="px-1.5 py-1.5 text-xs font-medium text-sidebar-foreground/70">{t('sidebar.pinned')}</span>
          {pinnedSessions.map((s) => {
            const [pinStatus, pinUnseenFlag] = (pinnedStatuses[s.sessionId] ?? ':0').split(':')
            return (
              <PinnedSessionRow
                key={s.sessionId}
                session={s}
                isActive={currentFolder === s.folderPath && currentActiveSid === s.sessionId}
                status={pinStatus}
                isUnseen={pinUnseenFlag === '1'}
                onSwitch={handleSwitchSession}
                onUnpin={handlePinSession}
              />
            )
          })}
        </div>
      )}

      {filesMounted && (
        <div className={cn('min-h-0 flex-1', sidebarTab !== 'files' && 'hidden')}>
          <FileTree />
        </div>
      )}

      <div className={cn('flex min-h-0 flex-1 flex-col', sidebarTab !== 'sessions' && 'hidden')}>
      {/* Host switcher — remote hosts only when experimentalRemoteNodesEnabled */}
      <div className="flex items-center justify-between pl-3 pr-3 pt-1.5 pb-0.5">
        <div className="min-w-0 max-w-[70%]">
          {showHostSwitcher ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  <span className="truncate">{selectedHostLabel}</span>
                  <ChevronDown className="size-3.5 shrink-0 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem
                  className="text-xs"
                  onClick={() => setSelectedHostConnectionId('local')}
                >
                  {localHostLabel}
                </DropdownMenuItem>
                {remoteHosts.map((host) => (
                  <DropdownMenuItem
                    key={host.connectionId}
                    className="text-xs"
                    onClick={() => setSelectedHostConnectionId(host.connectionId)}
                  >
                    <span className="truncate">{host.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="truncate px-1 py-0.5 text-sm font-medium text-sidebar-foreground/70">
              {t('sidebar.projects')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton
            size="sm"
            tooltip={t('sidebar.addProject.title')}
            aria-label={t('sidebar.addProject.title')}
            onClick={() => setOpenProjectDialogOpen(true)}
          >
            <Plus />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="sm"
                tooltip={t('sidebar.sort.title')}
                aria-label={t('sidebar.sort.title')}
              >
                <ArrowDownUp className="size-3" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => setSortMode('recent')} className="text-xs">
                {sortMode === 'recent' ? '✓ ' : '   '}{t('sidebar.sort.recent')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortMode('added')} className="text-xs">
                {sortMode === 'added' ? '✓ ' : '   '}{t('sidebar.sort.added')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {selectedHostConnectionId !== 'local' && (
            <IconButton
              size="sm"
              tooltip={t('common.refresh')}
              aria-label={t('common.refresh')}
              disabled={hostProjectsLoading}
              onClick={refreshHostProjects}
            >
              <RotateCw className={cn('size-3', hostProjectsLoading && 'animate-spin')} />
            </IconButton>
          )}
        </div>
      </div>

      {/* Project list for the selected host */}
      <div className="min-h-0 flex-1">
        {selectedHostConnectionId !== 'local' && hostProjectsError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-sidebar-foreground/70">
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={refreshHostProjects}
            >
              {t('common.retry')}
            </Button>
            <span className="break-words px-2">{hostProjectsError}</span>
          </div>
        ) : hostProjectsLoading ? (
          <div className="flex flex-1 items-center justify-center p-4 text-xs text-sidebar-foreground/70">
            {t('common.loading')}
          </div>
        ) : sortedFolders.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-4 text-xs text-sidebar-foreground/70">
            {t('sidebar.empty')}
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="flex w-0 min-w-full flex-col px-1.5 pb-1.5">
              {sortedFolders.map((folder) => {
                return (
                  <ProjectSidebarRow
                    key={folder.path}
                    folder={folder}
                    isExpanded={expandedFolders.has(folder.path)}
                    sessions={folderSessions[folder.path] ?? EMPTY_SESSIONS}
                    maxSessions={MAX_DISPLAY_SESSIONS}
                    onToggleExpand={toggleExpand}
                    onSwitchSession={handleSwitchSession}
                    onPinSession={handlePinSession}
                    onHideSession={handleHideSession}
                    onRemoveProject={handleRemoveProject}
                    onRenameSession={handleRequestRenameSession}
                    onDeleteSession={handleRequestDeleteSession}
                    onNewSession={handleNewSession}
                  />
                )
              })}
            </div>
          </ScrollArea>
        )}
      </div>
      </div>

      <div className="flex items-center gap-1 px-3 py-2">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton size="sm" onClick={() => navigateTo('settings')}>
                <Settings />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent side="top"><span>{t('sidebar.settings')}</span> <CommandShortcut>{isMac ? '⌘,' : 'Ctrl+,'}</CommandShortcut></TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <BrandColorPopover />
        <RemoteStatusIcon />
        <UsageStatusIcon />
        <UpdateStatusIcon />
      </div>

      <AddProjectDialog
        open={openProjectDialogOpen}
        onOpenChange={setOpenProjectDialogOpen}
        connectionId={selectedHostConnectionId}
        hostLabel={selectedHostLabel}
        onOpened={(project) => {
          if (selectedHostConnectionId === 'local') {
            void fetchRecentFolders()
            void selectProject(project.path)
          } else {
            // Refresh remote list (sidebar + ChatSuggestions) and select the new project.
            setHostProjectsRetryNonce((n) => n + 1)
            void import('@/lib/host-projects-bus').then(({ notifyHostProjectsChanged }) => {
              notifyHostProjectsChanged()
            })
            void selectProject(remoteProjectKey(selectedHostConnectionId, project.path), {
              connectionId: selectedHostConnectionId,
              projectId: project.projectId,
            })
          }
        }}
      />

      {/* Delete session confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setCopiedCmd(null) } }}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('sidebar.deleteSession.title')}</DialogTitle>
            <DialogDescription asChild>
              <div className="min-w-0">
                <span className="font-medium text-foreground">{deleteTarget?.title}</span> {t('sidebar.deleteSession.descriptionPrefix')} {deleteTargetCli.cliName}{t('sidebar.deleteSession.descriptionSuffix')}
                <div className="mt-2 flex min-w-0 flex-col gap-1">
                  {([
                    ['cd', `cd ${deleteTarget?.folderPath}`],
                    ['resume', deleteTargetCli.resumeCommand],
                  ] as const).map(([key, cmd]) => (
                    <code
                      key={key}
                      onClick={() => {
                        navigator.clipboard.writeText(cmd)
                        setCopiedCmd(key)
                        setTimeout(() => setCopiedCmd((v) => v === key ? null : v), 2000)
                      }}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted/80"
                    >
                      <span className="min-w-0 truncate">{cmd}</span>
                      {copiedCmd === key
                        ? <Check className="size-3.5 shrink-0 text-success" />
                        : <Copy className="size-3.5 shrink-0 text-muted-foreground" />
                      }
                    </code>
                  ))}
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row items-center gap-2">
            <label className="mr-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={skipConfirm} onCheckedChange={(v) => setSkipConfirm(v === true)} />
              {t('sidebar.deleteSession.dontAsk')}
            </label>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setSkipConfirm(false) }}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleDeleteSession}>{t('sidebar.deleteSession.delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove project confirmation dialog */}
      <Dialog
        open={!!removeTarget}
        onOpenChange={(open) => {
          if (!open && !removeBusy) {
            setRemoveTarget(null)
            setRemoveError(null)
          }
        }}
      >
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('sidebar.removeProject.title')}</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{removeTarget?.name}</span> {t('sidebar.removeProject.description')}
            </DialogDescription>
          </DialogHeader>
          {removeError ? (
            <p className="text-sm text-destructive break-words">{removeError}</p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={removeBusy}
              onClick={() => {
                setRemoveTarget(null)
                setRemoveError(null)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={removeBusy}
              onClick={() => {
                void confirmRemoveProject()
              }}
            >
              {t('sidebar.removeProject.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RenameSessionDialog
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRenamed={(target) => { refreshFolderSessions(target.folderPath); refreshPinned() }}
      />
    </div>
  )
})

function RemoteStatusIcon() {
  const { t } = useTranslation()
  const remoteEnabled = useAppStore((s) => s.remoteConfig?.enabled ?? false)
  const { navigateTo, setSettingsTab } = useAppStore(useShallow((s) => ({ navigateTo: s.navigateTo, setSettingsTab: s.setSettingsTab })))
  const { hostname, relayConnected, lanActive } = useRemoteStatus(remoteEnabled)
  const [onlineDevices, setOnlineDevices] = useState<Array<{ id: string; name: string; transport?: 'lan' | 'relay' }>>([])

  useEffect(() => {
    if (!remoteEnabled) {
      setOnlineDevices([])
      return
    }
    let cancelled = false
    const refreshDevices = async (): Promise<void> => {
      const devices = await window.app.listPairedDevices()
      if (cancelled) return
      setOnlineDevices(devices.filter((d) => d.online).map((d) => ({ id: d.id, name: d.name, transport: d.transport })))
    }
    void refreshDevices()
    const unsubDevice = window.app.onDeviceStatusChanged(() => { void refreshDevices() })
    return () => {
      cancelled = true
      unsubDevice()
    }
  }, [remoteEnabled])

  if (!remoteEnabled) return null

  const reachable = relayConnected || lanActive

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            size="sm"
            className="relative"
            onClick={() => { setSettingsTab('remote'); navigateTo('settings') }}
          >
            <Smartphone />
            <span className={cn('absolute top-1 right-1 size-1.5 rounded-full', reachable ? 'bg-success' : 'bg-error')} />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent side="top">
          <div className="flex min-w-44 flex-col gap-1.5 text-xs">
            <div className="flex items-center gap-1.5">
              <Monitor className="size-3 shrink-0 opacity-60" />
              <span className="truncate font-mono">{hostname || '—'}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <Cloud className={cn('size-3', relayConnected ? 'text-success' : 'opacity-40')} />
                <span className={cn(relayConnected ? 'text-success' : 'opacity-60')}>
                  {relayConnected ? t('sidebar.remote.connected') : t('sidebar.remote.disconnected')}
                </span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Wifi className={cn('size-3', lanActive ? 'text-success' : 'opacity-40')} />
                <span className={cn(lanActive ? 'text-success' : 'opacity-60')}>
                  {lanActive ? t('sidebar.remote.lanActive') : t('sidebar.remote.lanInactive')}
                </span>
              </span>
            </div>
            {onlineDevices.length > 0 && (
              <div className="flex flex-col gap-0.5 border-t border-border/40 pt-1.5">
                {onlineDevices.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3">
                    <span>{d.name}</span>
                    {d.transport === 'lan' ? <Wifi className="size-3 text-success" /> : <Cloud className="size-3 text-sky-500" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
