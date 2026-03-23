import { useState, useEffect, useMemo, useCallback } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { Plus, Settings, PanelLeftDashed, Folder, FolderOpen, FolderClosed, FolderX, ChevronRight, Trash2, ArrowDownUp, MoreHorizontal, SquarePen, MessageSquare, Loader2, Bot, GitFork, Pin, Copy, Check, Pencil, CircleCheck, History, EyeOff } from 'lucide-react'
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
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
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
import { homePath } from '@/lib/path-utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FileTree } from '@/components/sidebar/FileTree'
import type { SessionHistoryEntry, PinnedSessionEntry, PermissionRequest, AskUserQuestionRequest, PlanApprovalRequest } from '../../../shared/agent-types'
import { getDeleteSessionRecovery, shouldSkipDeleteConfirm, setSkipDeleteConfirm } from './session-delete-helpers'

type SortMode = 'recent' | 'added'

/** Extract a short pending-reason string from the pending request objects. */
function getPendingReason(
  permissions: PermissionRequest[] | undefined,
  question: AskUserQuestionRequest | null | undefined,
  planApproval: PlanApprovalRequest | null | undefined,
): string | null {
  if (permissions && permissions.length > 0) return `Allow ${permissions[0].toolName}?`
  if (question) return question.questions[0]?.question ?? 'Waiting for input'
  if (planApproval) return 'Review plan'
  return null
}

function isLiveSession(
  session:
    | {
      status?: string
      pendingPermissions?: PermissionRequest[]
      pendingQuestion?: AskUserQuestionRequest | null
      pendingPlanApproval?: PlanApprovalRequest | null
      awaitingAssistantReply?: boolean
    }
    | undefined,
  isUnseen: boolean | undefined,
): boolean {
  return !!isUnseen
    || session?.status === 'streaming'
    || (session?.pendingPermissions?.length ?? 0) > 0
    || !!session?.pendingQuestion
    || !!session?.pendingPlanApproval
    || !!session?.awaitingAssistantReply
}

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
  const projectSessions = useChatStore((s) => s.projectSessions)

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

  const toggleExpand = useCallback(async (folderPath: string) => {
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
    // Refresh session list every time we expand
    if (willExpand) {
      const sessions = await window.app.listSessionsForFolder(folderPath)
      setFolderSessions((prev) => ({ ...prev, [folderPath]: sessions }))
    }
  }, [])

  const refreshPinned = useCallback(() => {
    window.app.listPinnedSessions().then(setPinnedSessions)
  }, [])

  const refreshFolderSessions = useCallback((folderPath: string) => {
    window.app.listSessionsForFolder(folderPath).then((sessions) => {
      setFolderSessions((prev) => ({ ...prev, [folderPath]: sessions }))
    })
  }, [])

  // Load pinned sessions on mount
  useEffect(() => { refreshPinned() }, [refreshPinned])

  const currentProject = currentFolder ? projectSessions[currentFolder] : undefined
  const currentActiveSid = currentProject?._activeSessionId
  const currentActiveSession = currentActiveSid ? currentProject?._sessions?.[currentActiveSid] : undefined
  const currentStatus = currentActiveSession?.status
  const currentSessionId = currentActiveSid
  useEffect(() => {
    if (!currentFolder) return
    window.app.listSessionsForFolder(currentFolder).then((sessions) => {
      setFolderSessions((prev) => ({ ...prev, [currentFolder]: sessions }))
    })
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
    const ps = projectSessions[folderPath]
    const currentSid = ps?._activeSessionId
    if (folderPath === currentFolder && currentSid === sessionId) return
    setExpandedFolders((prev) => prev.has(folderPath) ? prev : new Set([...prev, folderPath]))
    if (!folderSessions[folderPath]) {
      window.app.listSessionsForFolder(folderPath).then((sessions) => {
        setFolderSessions((prev) => ({ ...prev, [folderPath]: sessions }))
      })
    }
    await openFolder(folderPath)
    await switchSession(sessionId)
  }, [openFolder, switchSession, currentFolder, projectSessions, folderSessions])

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

    const current = projectSessions[target.folderPath]
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
  }, [refreshFolderSessions, refreshPinned, projectSessions, resetSession, removeSessionFromMemory])

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
                const isActive = hasRealProject && folder.path === currentFolder
                const isExpanded = expandedFolders.has(folder.path)
                const displayPath = homePath(folder.path)
                const allSessions = folderSessions[folder.path] ?? []
                let sessions = allSessions.filter(s => !s.isHidden)
                const projectSession = projectSessions[folder.path]
                if (projectSession?._sessions) {
                  const live: SessionHistoryEntry[] = []
                  for (const [sid, data] of Object.entries(projectSession._sessions)) {
                    if (data.messages.length === 0) continue
                    const firstText = data.messages[0]?.content.find(b => b.type === 'text')
                    const dbEntry = allSessions.find(s => s.sessionId === sid)
                    if (dbEntry?.isHidden) continue
                    if (dbEntry) continue
                    const isUnseen = projectSession.unseenCompletedSessions?.has(sid)
                    if (!isActive && !isLiveSession(data, isUnseen)) continue
                    live.push({
                      sessionId: sid,
                      title: (firstText && 'text' in firstText ? firstText.text : '').slice(0, 100) || 'New session',
                      lastActiveAt: new Date().toISOString(),
                      provider: data.sessionProvider ?? undefined,
                      messageCount: data.messages.length,
                      isWorktree: !!data._worktreeBaseBranch,
                      gitBranch: data._worktreeBaseBranch ?? undefined,
                    })
                  }
                  if (live.length > 0) sessions = [...live, ...sessions]
                }
                const liveSessions = isExpanded ? [] : sessions.filter(s => {
                  const entry = projectSession?._sessions?.[s.sessionId]
                  const isUnseen = projectSession?.unseenCompletedSessions?.has(s.sessionId)
                  if (!entry && !isUnseen) return false
                  return isLiveSession(entry, isUnseen)
                })
                const sessionsToShow = isExpanded ? sessions.slice(0, MAX_SESSIONS) : liveSessions
                const showSessions = isExpanded || liveSessions.length > 0
                return (
                  <div key={folder.path}>
                    {/* Folder row */}
                    <div
                      onClick={() => !folder.missing && toggleExpand(folder.path)}
                      className={cn(
                        'group flex h-9 items-center justify-between overflow-hidden rounded-md px-2.5 transition-colors',
                        folder.missing ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-sidebar-accent'
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <ChevronRight className={cn(
                          'hidden size-4 shrink-0 text-sidebar-foreground/70 transition-transform duration-200 group-hover:block',
                          isExpanded && 'rotate-90',
                          folder.missing && '!hidden'
                        )} />
                        {folder.missing
                          ? <FolderX className="size-4.5 shrink-0 text-destructive" />
                          : isExpanded
                            ? <FolderOpen className="size-4.5 shrink-0 text-sidebar-foreground/70 group-hover:hidden" />
                            : <Folder className="size-4.5 shrink-0 text-sidebar-foreground/70 group-hover:hidden" />
                        }
                        <TooltipProvider delayDuration={500}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={cn('min-w-0 truncate text-md', folder.missing && 'text-muted-foreground line-through')}>{folder.name}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={8}>
                              <span className="text-xs">{folder.missing ? `Folder not found: ${folder.path}` : displayPath}</span>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                        {folder.missing ? (
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setRemoveTarget({ name: folder.name, path: folder.path })
                                  }}
                                  className="rounded p-0.5 text-destructive/70 transition-colors hover:text-destructive"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" sideOffset={8}>Remove Project</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  onClick={(e) => e.stopPropagation()}
                                  className="rounded p-0.5 text-sidebar-foreground/70 transition-colors hover:text-sidebar-accent-foreground"
                                >
                                  <MoreHorizontal className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" side="right" className="w-44">
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openFolder(folder.path).then(() => {
                                      useChatStore.getState().fetchSessions()
                                      useAppStore.setState({ showFilePanel: true, filePanelView: 'history' })
                                    })
                                  }}
                                  className="text-xs"
                                >
                                  <History className="size-3.5" />
                                  Session History
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setRemoveTarget({ name: folder.name, path: folder.path })
                                  }}
                                  className="text-xs"
                                >
                                  <Trash2 className="size-3.5" />
                                  Remove Project
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <TooltipProvider delayDuration={300}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openFolder(folder.path).then(() => resetSession())
                                    }}
                                    className="rounded p-0.5 text-sidebar-foreground/70 transition-colors hover:text-sidebar-accent-foreground"
                                  >
                                    <SquarePen className="size-4" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={8}>New Session</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Sessions list */}
                    <AnimatePresence initial={false}>
                      {showSessions && (
                        <motion.div
                          key="sessions"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.12, ease: 'easeOut' }}
                          className="overflow-hidden"
                        >
                          <div className="flex flex-col py-0.5 pl-5">
                            {sessionsToShow.length === 0 ? (
                              <div className="px-2.5 py-1.5 text-[11px] text-sidebar-foreground/70">No sessions</div>
                            ) : (
                              sessionsToShow.map((session) => {
                                const activeSid = projectSession?._activeSessionId
                                const isForeground = activeSid === session.sessionId
                                const sessionEntry = projectSession?._sessions?.[session.sessionId]
                                const isRunning = sessionEntry?.status === 'streaming'
                                const isUnseen = projectSession?.unseenCompletedSessions?.has(session.sessionId)
                                const pendingReason = getPendingReason(sessionEntry?.pendingPermissions, sessionEntry?.pendingQuestion, sessionEntry?.pendingPlanApproval)
                                return (
                                  <div key={session.sessionId}>
                                    <ContextMenu>
                                      <ContextMenuTrigger asChild>
                                        <div
                                          onClick={() => handleSwitchSession(folder.path, session.sessionId)}
                                          className={cn(
                                            'group/session flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 py-1.5 transition-colors',
                                            isActive && isForeground
                                              ? 'bg-sidebar-accent'
                                              : 'hover:bg-sidebar-accent'
                                          )}
                                        >
                                          <div className="relative flex shrink-0 items-center justify-center size-3">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                handleHideSession(session.sessionId, true, folder.path)
                                              }}
                                              className="absolute inset-0 flex items-center justify-center rounded text-sidebar-foreground/70 opacity-0 transition-opacity hover:text-sidebar-accent-foreground group-hover/session:opacity-100"
                                            >
                                              <EyeOff className="size-3" />
                                            </button>
                                            <span className="pointer-events-none group-hover/session:opacity-0 transition-opacity">
                                              {isRunning
                                                ? <Loader2 className="size-3 animate-spin text-sidebar-foreground/70" />
                                                : isUnseen
                                                  ? <CircleCheck className="size-3 text-green-400" />
                                                  : session.isWorktree
                                                    ? <GitFork className="size-3 text-sidebar-foreground/70" />
                                                    : <MessageSquare className="size-3 text-sidebar-foreground/70" />
                                              }
                                            </span>
                                          </div>
                                          <span className="min-w-0 truncate text-[13px]">{session.title}</span>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              handlePinSession(session.sessionId, !session.isPinned, folder.path)
                                            }}
                                            className="ml-auto shrink-0 rounded p-0.5 text-sidebar-foreground/70 opacity-0 transition-opacity hover:text-sidebar-accent-foreground group-hover/session:opacity-100"
                                          >
                                            <Pin className="size-3" />
                                          </button>
                                        </div>
                                      </ContextMenuTrigger>
                                      <ContextMenuContent className="w-36">
                                        <ContextMenuItem
                                          onClick={() => {
                                            setRenameTarget({ sessionId: session.sessionId, title: session.title, folderPath: folder.path })
                                            setRenameValue(session.title)
                                          }}
                                          className="text-xs"
                                        >
                                          <Pencil className="size-3.5" />
                                          Rename
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          onClick={() => handlePinSession(session.sessionId, !session.isPinned, folder.path)}
                                          className="text-xs"
                                        >
                                          <Pin className="size-3.5" />
                                          {session.isPinned ? 'Unpin' : 'Pin'}
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          onClick={() => handleHideSession(session.sessionId, true, folder.path)}
                                          className="text-xs"
                                        >
                                          <EyeOff className="size-3.5" />
                                          Hide
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          onClick={() => { navigator.clipboard.writeText(session.sessionId); toast.success(`${session.provider === 'codex' ? 'Codex' : 'Claude Code'} Session ID Copied`) }}
                                          className="text-xs"
                                        >
                                          <Copy className="size-3.5" />
                                          Copy Session ID
                                        </ContextMenuItem>
                                        <ContextMenuSeparator />
                                        <ContextMenuItem
                                          variant="destructive"
                                          onClick={() => {
                                            const target = {
                                              sessionId: session.sessionId,
                                              title: session.title,
                                              folderPath: folder.path,
                                              provider: (session.provider ?? 'claude') as 'claude' | 'codex',
                                            }
                                            if (shouldSkipDeleteConfirm()) {
                                              executeDeleteSession(target)
                                            } else {
                                              setDeleteTarget(target)
                                            }
                                          }}
                                          className="text-xs"
                                        >
                                          <Trash2 className="size-3.5" />
                                          Delete
                                        </ContextMenuItem>
                                      </ContextMenuContent>
                                    </ContextMenu>
                                    {pendingReason && (
                                      <div
                                        onClick={() => handleSwitchSession(folder.path, session.sessionId)}
                                        className="ml-5 mr-1 mt-0.5 flex cursor-pointer items-center gap-1 rounded-md bg-green-500/15 px-2 py-1"
                                      >
                                        <Bot className="size-3 shrink-0 text-green-400" />
                                        <span className="min-w-0 truncate text-[11px] text-green-400">{pendingReason}</span>
                                      </div>
                                    )}
                                  </div>
                                )
                              })
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
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
