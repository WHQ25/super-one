import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Plus, Settings, PanelLeftDashed, FolderClosed, ArrowDownUp, SquarePen, MessageSquare, GitFork, Pin, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Checkbox } from '@/components/ui/checkbox'
import { CommandShortcut } from '@/components/ui/command'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useChatStore } from '@/stores/chat'
import { useAppStore, useHasRealProject, type SidebarTab } from '@/stores/app'
import { useShallow } from 'zustand/react/shallow'
import { useFullscreen } from '@/hooks/useFullscreen'

import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FileTree } from '@/components/sidebar/FileTree'
import { ProjectSidebarRow } from '@/components/sidebar/ProjectSidebarRow'
import { traceSidebar, useSidebarRenderTrace } from '@/components/sidebar/sidebar-trace'
import type { RecentFolder, SessionHistoryEntry, PinnedSessionEntry } from '../../../shared/agent-types'
import { getDeleteSessionRecovery, shouldSkipDeleteConfirm, setSkipDeleteConfirm } from './session-delete-helpers'

type SortMode = 'recent' | 'added'

const MAX_SESSIONS = 10

export function AppSidebar() {
  const { setShowSidebar, navigateTo, selectAndOpenFolder, openFolder, removeRecentFolder, setSidebarTab } = useAppStore(useShallow((s) => ({ setShowSidebar: s.setShowSidebar, navigateTo: s.navigateTo, selectAndOpenFolder: s.selectAndOpenFolder, openFolder: s.openFolder, removeRecentFolder: s.removeRecentFolder, setSidebarTab: s.setSidebarTab })))
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

  const [sortMode, setSortMode] = useState<SortMode>('added')
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
      traceSidebar('sessions_load:start', { folderPath, reason, pageSize: MAX_SESSIONS }, folderPath)
      try {
        while (sessions.filter((session) => !session.isHidden).length < MAX_SESSIONS) {
          const page = await window.app.listSessionsForFolderPage(folderPath, MAX_SESSIONS, offset)
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
          if (page.length < MAX_SESSIONS) break
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

  const sortedFolders = useMemo(() => {
    const folders = [...recentFolders]
    if (sortMode === 'added') {
      folders.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    }
    return folders
  }, [recentFolders, sortMode])

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
      useAppStore.setState({ showFilePanel: true, filePanelView: 'history' })
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
        {isMac && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowSidebar(false)}
                  className="rounded-md p-1 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                  <PanelLeftDashed className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                <span>Toggle Sidebar</span> <CommandShortcut>⌘B</CommandShortcut>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* New session button */}
      <div className="mx-2 mb-1 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => resetSession()}
          className="mb-1 w-full justify-center gap-1.5 border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <SquarePen className="size-3.5" />
          New Session
        </Button>
      </div>
      <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as SidebarTab)} className="mx-2 mb-1 shrink-0">
        <TabsList variant="sidebar">
          <TabsTrigger value="sessions" className="py-1">
            <MessageSquare className="size-3.5" />
            Sessions
          </TabsTrigger>
          <TabsTrigger value="files" className="py-1">
            <FolderClosed className="size-3.5" />
            Files
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Pinned sessions (always visible) */}
      {pinnedSessions.length > 0 && (
        <div className="flex flex-col px-1.5 pb-1">
          <span className="px-1.5 py-1.5 text-xs font-medium text-sidebar-foreground/70">Pinned</span>
          {pinnedSessions.map((s) => (
            <div
              key={s.sessionId}
              onClick={() => handleSwitchSession(s.folderPath, s.sessionId)}
              className="group/pin flex cursor-pointer items-center justify-between overflow-hidden rounded-md px-2.5 py-1.5 transition-colors hover:bg-sidebar-accent"
            >
              <div className="flex min-w-0 items-center gap-2">
                {s.isWorktree
                  ? <GitFork className="size-3 shrink-0 text-sidebar-foreground/70" />
                  : <MessageSquare className="size-3 shrink-0 text-sidebar-foreground/70" />
                }
                <div className="flex min-w-0 flex-col">
                  <span className="min-w-0 truncate text-[13px]">{s.title}</span>
                  <span className="min-w-0 truncate text-[11px] text-sidebar-foreground/50">{s.folderName}</span>
                </div>
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

      {filesMounted && (
        <div className={cn('min-h-0 flex-1', sidebarTab !== 'files' && 'hidden')}>
          <FileTree />
        </div>
      )}
      <div className={cn('flex min-h-0 flex-1 flex-col', sidebarTab !== 'sessions' && 'hidden')}>
      {/* Projects header */}
      <div className="flex items-center justify-between pl-4 pr-3 pt-1.5 pb-0.5">
        <span className="text-sm font-medium text-sidebar-foreground/40">Projects</span>
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
                {sortMode === 'recent' ? '✓ ' : '   '}Recent Activity
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortMode('added')} className="text-xs">
                {sortMode === 'added' ? '✓ ' : '   '}Date Added
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Project list */}
      <div className="min-h-0 flex-1">
        {sortedFolders.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-4 text-xs text-sidebar-foreground/70">
            No projects yet
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
                    maxSessions={MAX_SESSIONS}
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

      {/* Footer — settings */}
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          onClick={() => navigateTo('settings')}
          className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Settings className="size-3.5" />
        </button>
      </div>

      {/* Delete session confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setCopiedCmd(null) } }}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Session?</DialogTitle>
            <DialogDescription asChild>
              <div>
                <span className="font-medium text-foreground">{deleteTarget?.title}</span> will be removed from SuperOne. You can still access it via {deleteTargetCli.cliName}:
                <div className="mt-2 flex flex-col gap-1">
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
              Don't ask again
            </label>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setSkipConfirm(false) }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteSession}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove project confirmation dialog */}
      <Dialog open={!!removeTarget} onOpenChange={(open) => { if (!open) setRemoveTarget(null) }}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Project?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{removeTarget?.name}</span> and all its chat sessions will be removed from SuperOne. Your project files will not be affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (!removeTarget) return
              removeRecentFolder(removeTarget.path)
              setExpandedFolders((prev) => { const next = new Set(prev); next.delete(removeTarget.path); return next })
              setRemoveTarget(null)
            }}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename session dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null) }}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename Session</DialogTitle>
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
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button onClick={handleRenameSession} disabled={!renameValue.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
