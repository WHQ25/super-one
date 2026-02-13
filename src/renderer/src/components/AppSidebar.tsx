import { useState, useEffect, useMemo, useCallback } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, Sun, Moon, Settings, PanelLeftDashed, Folder, FolderOpen, ChevronRight, Trash2, ArrowDownUp, MoreHorizontal, SquarePen, MessageSquare, Loader2, Bot, GitFork } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CommandShortcut } from '@/components/ui/command'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useChatStore } from '@/stores/chat'
import { useAppStore, useHasRealProject } from '@/stores/app'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import type { SessionHistoryEntry, PermissionRequest, AskUserQuestionRequest, PlanApprovalRequest } from '../../../shared/agent-types'

type SortMode = 'recent' | 'added'

/** Extract a short pending-reason string from the pending request objects. */
function getPendingReason(
  permission: PermissionRequest | null | undefined,
  question: AskUserQuestionRequest | null | undefined,
  planApproval: PlanApprovalRequest | null | undefined,
): string | null {
  if (permission) return `Allow ${permission.toolName}?`
  if (question) return question.questions[0]?.question ?? 'Waiting for input'
  if (planApproval) return 'Review plan'
  return null
}

const MAX_SESSIONS = 5

export function AppSidebar() {
  const theme = useTheme()
  const { setShowSidebar, navigateTo, selectAndOpenFolder, openFolder, removeRecentFolder } = useAppStore()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const recentFolders = useAppStore((s) => s.recentFolders)
  const isFullscreen = useFullscreen()
  const hasRealProject = useHasRealProject()
  const resetSession = useChatStore((s) => s.resetSession)
  const resumeSession = useChatStore((s) => s.resumeSession)
  const projectSessions = useChatStore((s) => s.projectSessions)

  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [folderSessions, setFolderSessions] = useState<Record<string, SessionHistoryEntry[]>>({})

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

  // Auto-expand current project and refresh session list when a new session starts streaming
  const currentStatus = currentFolder ? projectSessions[currentFolder]?.status : undefined
  const currentSessionId = currentFolder ? projectSessions[currentFolder]?.session?.sessionId : undefined
  useEffect(() => {
    if (!currentFolder) return
    // Expand the folder if not already expanded
    setExpandedFolders((prev) => {
      if (prev.has(currentFolder)) return prev
      const next = new Set(prev)
      next.add(currentFolder)
      return next
    })
    // Refresh session list for the current folder (covers initial load, new session, and resume)
    window.app.listSessionsForFolder(currentFolder).then((sessions) => {
      setFolderSessions((prev) => ({ ...prev, [currentFolder]: sessions }))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolder, currentStatus, currentSessionId])

  const handleResumeSession = useCallback(async (folderPath: string, sessionId: string) => {
    const ps = projectSessions[folderPath]
    const currentSid = ps?._historySessionId ?? ps?.session?.sessionId
    // Skip if already on this session
    if (folderPath === currentFolder && currentSid === sessionId) return
    await openFolder(folderPath)
    await resumeSession(sessionId)
  }, [openFolder, resumeSession, currentFolder, projectSessions])

  const sortedFolders = useMemo(() => {
    const folders = [...recentFolders]
    if (sortMode === 'added') {
      folders.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    }
    return folders
  }, [recentFolders, sortMode])

  return (
    <div className="flex h-full w-full shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* Header — drag region with traffic lights spacer + toggle */}
      <div
        className={cn('flex h-11 shrink-0 items-center pt-[2px]', isFullscreen ? 'pl-2' : 'pl-[18px]')}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {!isFullscreen && <div className="w-[66px] shrink-0" />}
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
      </div>

      {/* Projects header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs font-medium text-sidebar-foreground/70">Projects</span>
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
            <div className="flex w-0 min-w-full flex-col p-1.5">
              {sortedFolders.map((folder) => {
                const isActive = hasRealProject && folder.path === currentFolder
                const isExpanded = expandedFolders.has(folder.path)
                const displayPath = folder.path.replace(/^\/Users\/[^/]+/, '~')
                const sessions = folderSessions[folder.path] ?? []
                const projectSession = projectSessions[folder.path]
                return (
                  <div key={folder.path}>
                    {/* Folder row */}
                    <div
                      onClick={() => toggleExpand(folder.path)}
                      className={cn(
                        'group flex h-9 cursor-pointer items-center justify-between overflow-hidden rounded-md px-2.5 transition-colors',
                        'hover:bg-sidebar-accent'
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <ChevronRight className={cn(
                          'hidden size-4 shrink-0 text-sidebar-foreground/70 transition-transform duration-200 group-hover:block',
                          isExpanded && 'rotate-90'
                        )} />
                        {isExpanded
                          ? <FolderOpen className="size-4.5 shrink-0 text-sidebar-foreground/70 group-hover:hidden" />
                          : <Folder className="size-4.5 shrink-0 text-sidebar-foreground/70 group-hover:hidden" />
                        }
                        <TooltipProvider delayDuration={500}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="min-w-0 truncate text-md">{folder.name}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={8}>
                              <span className="text-xs">{displayPath}</span>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="rounded p-0.5 text-sidebar-foreground/70 transition-colors hover:text-sidebar-accent-foreground"
                            >
                              <MoreHorizontal className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" side="right" className="w-36">
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={(e) => {
                                e.stopPropagation()
                                removeRecentFolder(folder.path)
                                setExpandedFolders((prev) => { const next = new Set(prev); next.delete(folder.path); return next })
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
                      </div>
                    </div>

                    {/* Sessions list */}
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          key="sessions"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: 'easeOut' }}
                          className="overflow-hidden"
                        >
                          <div className="flex flex-col py-0.5 pl-5">
                            {sessions.length === 0 ? (
                              <div className="px-2.5 py-1.5 text-[11px] text-sidebar-foreground/70">No sessions</div>
                            ) : (
                              sessions.slice(0, MAX_SESSIONS).map((session) => {
                                const fgSid = projectSession?._historySessionId ?? projectSession?.session?.sessionId
                                const isForeground = fgSid === session.sessionId
                                const bgEntry = projectSession?._bgSessions?.[session.sessionId]
                                const isRunning = isForeground
                                  ? projectSession?.status === 'streaming'
                                  : bgEntry?.status === 'streaming'
                                const pendingReason = isForeground
                                  ? getPendingReason(projectSession?.pendingPermission, projectSession?.pendingQuestion, projectSession?.pendingPlanApproval)
                                  : getPendingReason(bgEntry?.pendingPermission, bgEntry?.pendingQuestion, bgEntry?.pendingPlanApproval)
                                return (
                                  <div key={session.sessionId}>
                                    <div
                                      onClick={() => handleResumeSession(folder.path, session.sessionId)}
                                      className={cn(
                                        'flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 py-1.5 transition-colors',
                                        isActive && isForeground
                                          ? 'bg-sidebar-accent'
                                          : 'hover:bg-sidebar-accent'
                                      )}
                                    >
                                      {isRunning
                                        ? <Loader2 className="size-3 shrink-0 animate-spin text-sidebar-foreground/70" />
                                        : session.isWorktree
                                          ? <GitFork className="size-3 shrink-0 text-sidebar-foreground/70" />
                                          : <MessageSquare className="size-3 shrink-0 text-sidebar-foreground/70" />
                                      }
                                      <span className="min-w-0 truncate text-[13px]">{session.title}</span>
                                    </div>
                                    {pendingReason && (
                                      <div
                                        onClick={() => handleResumeSession(folder.path, session.sessionId)}
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

      {/* Footer — settings, theme */}
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          onClick={() => navigateTo('settings')}
          className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Settings className="size-3.5" />
        </button>
        <button
          onClick={theme.toggle}
          className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {theme.dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>
      </div>
    </div>
  )
}
