import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { Plus, Settings, FolderClosed, ArrowDownUp, SquarePen, MessageSquare, Pin, Copy, Check, Smartphone, Wifi, Cloud, Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
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
import { useAppStore, useHasRealProject, type SidebarTab } from '@/stores/app'
import { useShallow } from 'zustand/react/shallow'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useRemoteStatus } from '@/hooks/useRemoteStatus'

import { cn } from '@superone/ui/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { FileTree } from '@/components/sidebar/FileTree'
import { ProjectSidebarRow } from '@/components/sidebar/ProjectSidebarRow'
import { traceSidebar, useSidebarRenderTrace } from '@/components/sidebar/sidebar-trace'
import type { RecentFolder, SessionHistoryEntry, PinnedSessionEntry } from '@superone/shared/agent-types'
import { getDeleteSessionRecovery, shouldSkipDeleteConfirm, setSkipDeleteConfirm } from './session-delete-helpers'
import { openHistoryTab } from '@/components/activity/activity-panel-api'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { useMiniAppStore } from '@/stores/miniapp'
import { MiniAppView } from '@/components/miniapp/MiniAppView'
import { AppDrawer } from '@/components/sidebar/AppDrawer'
import { BrandColorPopover } from '@/components/sidebar/BrandColorPopover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { CommandShortcut } from '@superone/ui/components/ui/command'

const isMac = window.app.platform === 'darwin'

type SortMode = 'recent' | 'added'

const MAX_DISPLAY_SESSIONS = 10
const SESSIONS_FETCH_LIMIT = MAX_DISPLAY_SESSIONS + 1

export const AppSidebar = memo(function AppSidebar() {
  const { t } = useTranslation()
  const { navigateTo, selectAndOpenFolder, openFolder, removeRecentFolder, setSidebarTab } = useAppStore(useShallow((s) => ({ navigateTo: s.navigateTo, selectAndOpenFolder: s.selectAndOpenFolder, openFolder: s.openFolder, removeRecentFolder: s.removeRecentFolder, setSidebarTab: s.setSidebarTab })))
  const sidebarTab = useAppStore((s) => s.sidebarTab)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const recentFolders = useAppStore((s) => s.recentFolders)
  const isFullscreen = useFullscreen()
  const isMac = window.app.platform === 'darwin'
  const hasRealProject = useHasRealProject()
  const resetSession = useChatStore((s) => s.resetSession)
  const removeSessionFromMemory = useChatStore((s) => s.removeSessionFromMemory)
  const switchSession = useChatStore((s) => s.switchSession)
  const currentProject = useChatStore(useCallback((s) => currentFolder ? s.projectSessions[currentFolder] : undefined, [currentFolder]))

  const [filesMounted, setExplorerMounted] = useState(sidebarTab === 'files')
  if (sidebarTab === 'files' && !filesMounted) setExplorerMounted(true)

  const fetchApps = useMiniAppStore((s) => s.fetchApps)
  useEffect(() => { fetchApps(currentFolder ?? undefined) }, [fetchApps, currentFolder])

  const [mountedMiniApps, setMountedMiniApps] = useState<Set<string>>(new Set())
  const openedMiniAppIds = useRef<Set<string>>(new Set())
  const activeMiniAppId = sidebarTab.startsWith('miniapp:') ? sidebarTab.slice(8) : null

  if (activeMiniAppId && !mountedMiniApps.has(activeMiniAppId)) {
    setMountedMiniApps((prev) => new Set(prev).add(activeMiniAppId))
  }

  useEffect(() => {
    if (!activeMiniAppId || openedMiniAppIds.current.has(activeMiniAppId)) return
    openedMiniAppIds.current.add(activeMiniAppId)
    window.miniapp.open(activeMiniAppId, currentFolder ?? '')
  }, [activeMiniAppId, currentFolder])

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
  const [deleteTarget, setDeleteTarget] = useState<{ sessionId: string; title: string; folderPath: string; provider: 'claude' | 'codex' } | null>(null)
  const [copiedCmd, setCopiedCmd] = useState<'cd' | 'resume' | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ name: string; path: string } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ sessionId: string; title: string; folderPath: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const inFlightFolderSessions = useRef(new Map<string, Promise<SessionHistoryEntry[]>>())
  const expandedFoldersRef = useRef(expandedFolders)
  const folderSessionsRef = useRef(folderSessions)

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
        while (sessions.filter((session) => !session.isHidden).length < SESSIONS_FETCH_LIMIT) {
          const page = await window.app.listSessionsForFolderPage(folderPath, SESSIONS_FETCH_LIMIT, offset)
          visibleCount += page.filter((session) => !session.isHidden).length
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
        setFolderSessions((prev) => ({ ...prev, [folderPath]: sessions }))
        traceSidebar('sessions_load:end', {
          folderPath,
          reason,
          fetchedCount: sessions.length,
          visibleCount,
          elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        }, folderPath)
        return sessions
      } catch (error) {
        traceSidebar('sessions_load:error', {
          folderPath,
          reason,
          error: error instanceof Error ? error.message : String(error),
          elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        }, folderPath)
        return []
      } finally {
        inFlightFolderSessions.current.delete(folderPath)
      }
    })()

    inFlightFolderSessions.current.set(folderPath, promise)
    return promise
  }, [])

  const toggleExpand = useCallback((folderPath: string) => {
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
  }, [loadFolderSessions])

  const refreshPinned = useCallback(() => {
    window.app.listPinnedSessions().then(setPinnedSessions)
  }, [])

  const refreshFolderSessions = useCallback((folderPath: string) => {
    loadFolderSessions(folderPath, 'refresh')
  }, [loadFolderSessions])

  // Load pinned sessions on mount
  useEffect(() => { refreshPinned() }, [refreshPinned])

  const currentActiveSid = currentProject?._activeSessionId
  const currentActiveSession = currentActiveSid ? currentProject?._sessions?.[currentActiveSid] : undefined
  const currentStatus = currentActiveSession?.status
  const currentSessionId = currentActiveSid
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
    })
  }, [currentFolder, refreshFolderSessions, refreshPinned])

  const handleSwitchSession = useCallback(async (folderPath: string, sessionId: string) => {
    const ps = useChatStore.getState().projectSessions[folderPath]
    const currentSid = ps?._activeSessionId
    if (folderPath === currentFolder && currentSid === sessionId) return
    setExpandedFolders((prev) => prev.has(folderPath) ? prev : new Set([...prev, folderPath]))
    if (!folderSessionsRef.current[folderPath]) {
      void loadFolderSessions(folderPath, 'switch')
    }
    await openFolder(folderPath)
    await switchSession(sessionId)
  }, [openFolder, switchSession, currentFolder, loadFolderSessions])

  const handlePinSession = useCallback(async (sessionId: string, pinned: boolean, folderPath: string) => {
    await window.app.pinSession(sessionId, pinned)
    refreshPinned()
    refreshFolderSessions(folderPath)
  }, [refreshPinned, refreshFolderSessions])

  const handleHideSession = useCallback(async (sessionId: string, hidden: boolean, folderPath: string) => {
    await window.app.hideSession(sessionId, hidden)
    refreshFolderSessions(folderPath)
  }, [refreshFolderSessions])

  const [skipConfirm, setSkipConfirm] = useState(false)

  const executeDeleteSession = useCallback(async (target: { sessionId: string; folderPath: string }) => {
    await window.app.deleteSession(target.sessionId)

    const current = useChatStore.getState().projectSessions[target.folderPath]
    if (current?._activeSessionId === target.sessionId) {
      resetSession()
    }
    removeSessionFromMemory(target.folderPath, target.sessionId)

    setFolderSessions((prev) => ({
      ...prev,
      [target.folderPath]: (prev[target.folderPath] ?? []).filter(
        (s) => s.sessionId !== target.sessionId
      ),
    }))
    setPinnedSessions((prev) => prev.filter((s) => s.sessionId !== target.sessionId))
    refreshFolderSessions(target.folderPath)
    refreshPinned()
  }, [refreshFolderSessions, refreshPinned, resetSession, removeSessionFromMemory])

  const handleDeleteSession = useCallback(async () => {
    if (!deleteTarget) return
    if (skipConfirm) setSkipDeleteConfirm()
    await executeDeleteSession(deleteTarget)
    setDeleteTarget(null)
    setSkipConfirm(false)
  }, [deleteTarget, skipConfirm, executeDeleteSession])

  const deleteTargetCli = getDeleteSessionRecovery(deleteTarget?.provider ?? 'claude', deleteTarget?.sessionId ?? '')

  const handleRenameSession = useCallback(async () => {
    if (!renameTarget || !renameValue.trim()) return
    await window.app.renameSession(renameTarget.sessionId, renameValue.trim())
    refreshFolderSessions(renameTarget.folderPath)
    refreshPinned()
    setRenameTarget(null)
  }, [renameTarget, renameValue, refreshFolderSessions, refreshPinned])

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

  const sortedFolders = useMemo(() => {
    if (sortMode === 'added') {
      return [...recentFolders].sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    }
    if (!frozenRecentOrder) return recentFolders
    const indexMap = new Map(frozenRecentOrder.map((p, i) => [p, i]))
    return [...recentFolders].sort((a, b) => {
      const ai = indexMap.get(a.path) ?? -1
      const bi = indexMap.get(b.path) ?? -1
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return -1
      if (bi === -1) return 1
      return ai - bi
    })
  }, [recentFolders, sortMode, frozenRecentOrder])

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
    setRemoveTarget({ name: folder.name, path: folder.path })
  }, [])

  const handleRequestRenameSession = useCallback((target: { sessionId: string; title: string; folderPath: string }) => {
    setRenameTarget(target)
    setRenameValue(target.title)
  }, [])

  const handleRequestDeleteSession = useCallback((target: { sessionId: string; title: string; folderPath: string; provider: 'claude' | 'codex' }) => {
    if (shouldSkipDeleteConfirm()) {
      void executeDeleteSession(target)
    } else {
      setDeleteTarget(target)
    }
  }, [executeDeleteSession])

  const handleOpenHistory = useCallback((folderPath: string) => {
    openFolder(folderPath).then(() => {
      useChatStore.getState().fetchSessions()
      openHistoryTab()
    })
  }, [openFolder])

  const handleNewSession = useCallback((folderPath: string) => {
    openFolder(folderPath).then(() => resetSession())
  }, [openFolder, resetSession])

  useSidebarRenderTrace({
    sidebarTab,
    currentFolder,
    recentFolderCount: sortedFolders.length,
    pinnedCount: pinnedSessions.length,
    expanded: expandedTraceState,
  })

  return (
    <div className="flex h-full w-full shrink-0 select-none flex-col bg-sidebar text-sidebar-foreground">
      {/* Header — drag region with traffic lights spacer + toggle */}
      <div
        className={cn('flex h-11 shrink-0 items-center pt-[2px]', !isMac || isFullscreen ? 'pl-2' : 'pl-[18px]')}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {isMac && !isFullscreen && <div className="w-[66px] shrink-0" />}
        <LayoutToggle />
      </div>

      {/* New session button */}
      <div className="mx-2 mb-1 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => resetSession()}
          className="mb-1 w-full justify-center gap-1.5 border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:border-border"
        >
          <SquarePen className="size-3.5" />
          {t('sidebar.newSession')}
        </Button>
      </div>
      <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as SidebarTab)} className="mx-2 mb-1 shrink-0">
        <TabsList variant="sidebar">
          <TabsTrigger value="sessions" className="py-1">
            <MessageSquare className="size-3.5" />
            {t('sidebar.tabs.sessions')}
          </TabsTrigger>
          <TabsTrigger value="files" className="py-1">
            <FolderClosed className="size-3.5" />
            {t('sidebar.tabs.files')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <AppDrawer />

      {pinnedSessions.length > 0 && sidebarTab === 'sessions' && (
        <div className="flex flex-col px-1.5 pb-1">
          <span className="px-1.5 py-1.5 text-xs font-medium text-sidebar-foreground/70">{t('sidebar.pinned')}</span>
          {pinnedSessions.map((s) => (
            <div
              key={s.sessionId}
              onClick={() => handleSwitchSession(s.folderPath, s.sessionId)}
              className="group/pin flex cursor-pointer items-center justify-between overflow-hidden rounded-md px-2.5 py-1.5 transition-colors hover:bg-sidebar-accent"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="min-w-0 truncate text-[13px]">{s.title}</span>
                <span className="min-w-0 truncate text-[11px] text-sidebar-foreground/50">{s.folderName}</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handlePinSession(s.sessionId, false, s.folderPath)
                }}
                className="shrink-0 rounded p-0.5 text-sidebar-foreground/70 opacity-0 transition-colors hover:text-sidebar-accent-foreground group-hover/pin:opacity-100"
              >
                <Pin className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {[...mountedMiniApps].map((appId) => (
        <div key={appId} className={cn('mt-1 min-h-0 flex-1', sidebarTab !== `miniapp:${appId}` && 'hidden')}>
          <MiniAppView appId={appId} className="h-full w-full" />
        </div>
      ))}

      {filesMounted && (
        <div className={cn('min-h-0 flex-1', sidebarTab !== 'files' && 'hidden')}>
          <FileTree />
        </div>
      )}

      <div className={cn('flex min-h-0 flex-1 flex-col', sidebarTab !== 'sessions' && 'hidden')}>
      {/* Projects header */}
      <div className="flex items-center justify-between pl-4 pr-3 pt-1.5 pb-0.5">
        <span className="text-sm font-medium text-sidebar-foreground/40">{t('sidebar.projects')}</span>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => selectAndOpenFolder()}
            className="shrink-0 cursor-pointer text-sidebar-foreground/70 hover:text-sidebar-accent-foreground"
          >
            <Plus className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" className="shrink-0 cursor-pointer text-sidebar-foreground/70 hover:text-sidebar-accent-foreground">
                <ArrowDownUp className="size-3" />
              </Button>
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
        </div>
      </div>

      {/* Project list */}
      <div className="min-h-0 flex-1">
        {sortedFolders.length === 0 ? (
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
                    currentFolder={currentFolder}
                    hasRealProject={hasRealProject}
                    isExpanded={expandedFolders.has(folder.path)}
                    sessions={folderSessions[folder.path] ?? []}
                    maxSessions={MAX_DISPLAY_SESSIONS}
                    onToggleExpand={toggleExpand}
                    onSwitchSession={handleSwitchSession}
                    onPinSession={handlePinSession}
                    onHideSession={handleHideSession}
                    onRemoveProject={handleRemoveProject}
                    onRenameSession={handleRequestRenameSession}
                    onDeleteSession={handleRequestDeleteSession}
                    onOpenHistory={handleOpenHistory}
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
              <button
                onClick={() => navigateTo('settings')}
                className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Settings className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><span>{t('sidebar.settings')}</span> <CommandShortcut>{isMac ? '⌘,' : 'Ctrl+,'}</CommandShortcut></TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <BrandColorPopover />
        <RemoteStatusIcon />
      </div>

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
                        ? <Check className="size-3.5 shrink-0 text-green-500" />
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
      <Dialog open={!!removeTarget} onOpenChange={(open) => { if (!open) setRemoveTarget(null) }}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('sidebar.removeProject.title')}</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{removeTarget?.name}</span> {t('sidebar.removeProject.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={() => {
              if (!removeTarget) return
              removeRecentFolder(removeTarget.path)
              setExpandedFolders((prev) => { const next = new Set(prev); next.delete(removeTarget.path); return next })
              setRemoveTarget(null)
            }}>{t('sidebar.removeProject.remove')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename session dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null) }}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('sidebar.renameSession.title')}</DialogTitle>
          </DialogHeader>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') {
                e.preventDefault()
                handleRenameSession()
              }
            }}
            autoFocus
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>{t('common.cancel')}</Button>
            <Button onClick={handleRenameSession} disabled={!renameValue.trim()}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          <button
            onClick={() => { setSettingsTab('remote'); navigateTo('settings') }}
            className="relative rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Smartphone className="size-3.5" />
            <span className={cn('absolute top-1 right-1 size-1.5 rounded-full', reachable ? 'bg-green-500' : 'bg-red-500')} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <div className="flex min-w-44 flex-col gap-1.5 text-xs">
            <div className="flex items-center gap-1.5">
              <Monitor className="size-3 shrink-0 opacity-60" />
              <span className="truncate font-mono">{hostname || '—'}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <Cloud className={cn('size-3', relayConnected ? 'text-green-500' : 'opacity-40')} />
                <span className={cn(relayConnected ? 'text-green-500' : 'opacity-60')}>
                  {relayConnected ? t('sidebar.remote.connected') : t('sidebar.remote.disconnected')}
                </span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Wifi className={cn('size-3', lanActive ? 'text-green-500' : 'opacity-40')} />
                <span className={cn(lanActive ? 'text-green-500' : 'opacity-60')}>
                  {lanActive ? t('sidebar.remote.lanActive') : t('sidebar.remote.lanInactive')}
                </span>
              </span>
            </div>
            {onlineDevices.length > 0 && (
              <div className="flex flex-col gap-0.5 border-t border-border/40 pt-1.5">
                {onlineDevices.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3">
                    <span>{d.name}</span>
                    {d.transport === 'lan' ? <Wifi className="size-3 text-green-500" /> : <Cloud className="size-3 text-sky-500" />}
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
