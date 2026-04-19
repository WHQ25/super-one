import { memo, useMemo, useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Bot, CalendarClock, ChevronRight, CircleCheck, Copy, EyeOff, Folder, FolderOpen, FolderX, GitFork, History, Loader2, MessageSquare, Pencil, Pin, Play, Smartphone, SquarePen, Trash2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useChatStore } from '@/stores/chat'
import { cn } from '@/lib/utils'
import { homePath } from '@/lib/path-utils'
import type { Automation, RecentFolder, SessionHistoryEntry } from '../../../../shared/agent-types'
import { getPendingReason, getSessionTitle, isLiveSession } from './session-state-utils'
import { AutomationDialog } from '../AutomationDialog'

interface ProjectSidebarRowProps {
  folder: RecentFolder
  currentFolder: string | null
  hasRealProject: boolean
  isExpanded: boolean
  sessions: SessionHistoryEntry[]
  maxSessions: number
  onToggleExpand: (folderPath: string) => void
  onSwitchSession: (folderPath: string, sessionId: string) => void
  onPinSession: (sessionId: string, pinned: boolean, folderPath: string) => void
  onHideSession: (sessionId: string, hidden: boolean, folderPath: string) => void
  onRemoveProject: (folder: RecentFolder) => void
  onRenameSession: (target: { sessionId: string; title: string; folderPath: string }) => void
  onDeleteSession: (target: { sessionId: string; title: string; folderPath: string; provider: 'claude' | 'codex' }) => void
  onOpenHistory: (folderPath: string) => void
  onNewSession: (folderPath: string) => void
}

export const ProjectSidebarRow = memo(function ProjectSidebarRow({
  folder,
  currentFolder,
  hasRealProject,
  isExpanded,
  sessions: allSessions,
  maxSessions,
  onToggleExpand,
  onSwitchSession,
  onPinSession,
  onHideSession,
  onRemoveProject,
  onRenameSession,
  onDeleteSession,
  onOpenHistory,
  onNewSession,
}: ProjectSidebarRowProps) {
  const projectSession = useChatStore((s) => s.projectSessions[folder.path])
  const remoteSessionId = useChatStore((s) => s.remoteSession?.projectPath === folder.path ? s.remoteSession.sessionId : null)

  const derived = useMemo(() => {
    const isActive = hasRealProject && folder.path === currentFolder
    const dbVisibleSessions = allSessions.filter((session) => !session.isHidden)
    const dbSessionById = new Map(allSessions.map((session) => [session.sessionId, session]))
    let sessions = dbVisibleSessions

    if (projectSession?._sessions) {
      const live: SessionHistoryEntry[] = []
      for (const [sid, data] of Object.entries(projectSession._sessions)) {
        if (data.messages.length === 0) continue
        const title = getSessionTitle(data.messages)
        const dbEntry = dbSessionById.get(sid)
        if (dbEntry?.isHidden) continue
        if (dbEntry) continue
        const isUnseen = projectSession.unseenCompletedSessions.has(sid)
        if (!isLiveSession(data, isUnseen)) continue
        if (!title && !data._historyHydrated) continue
        live.push({
          sessionId: sid,
          title: title ?? 'New session',
          lastActiveAt: new Date().toISOString(),
          provider: data.sessionProvider ?? undefined,
          providerSessionId: data.session?.sessionId || undefined,
          messageCount: data.messages.length,
          isWorktree: !!data._worktreeBaseBranch,
          gitBranch: data._worktreeBaseBranch ?? undefined,
          worktreePath: data._worktreePath ?? undefined,
        })
      }
      if (live.length > 0) sessions = [...live, ...sessions]
    }

    const liveSessions = isExpanded ? [] : sessions.filter((session) => {
      const entry = projectSession?._sessions?.[session.sessionId]
      const isUnseen = projectSession?.unseenCompletedSessions?.has(session.sessionId)
      if (!entry && !isUnseen) return false
      return isLiveSession(entry, isUnseen)
    })

    return {
      isActive,
      displayPath: homePath(folder.path),
      sessionsToShow: isExpanded ? sessions.slice(0, maxSessions) : liveSessions,
      showSessions: isExpanded || liveSessions.length > 0,
      activeSid: projectSession?._activeSessionId ?? null,
    }
  }, [allSessions, currentFolder, folder.path, hasRealProject, isExpanded, maxSessions, projectSession])

  const [projectAutomations, setProjectAutomations] = useState<Automation[]>([])
  const [automationsExpanded, setAutomationsExpanded] = useState(false)
  const [automationDialogOpen, setAutomationDialogOpen] = useState(false)
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null)

  const refreshAutomations = useCallback(() => {
    if (folder.missing) return
    window.app.listAutomations(folder.path).then((next) => {
      setProjectAutomations((prev) => {
        if (prev.length !== next.length) return next
        for (let i = 0; i < prev.length; i++) {
          const a = prev[i]
          const b = next[i]
          if (a.id !== b.id || a.updatedAt !== b.updatedAt || a.lastRunStatus !== b.lastRunStatus || a.enabled !== b.enabled) {
            return next
          }
        }
        return prev
      })
    }).catch(() => {})
  }, [folder.path, folder.missing])

  useEffect(() => {
    if (isExpanded) refreshAutomations()
  }, [isExpanded, refreshAutomations])

  const openCreateDialog = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingAutomation(null)
    setAutomationDialogOpen(true)
  }, [])

  const openEditDialog = useCallback((automation: Automation) => {
    setEditingAutomation(automation)
    setAutomationDialogOpen(true)
  }, [])

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={folder.missing}>
          <div
            onClick={() => !folder.missing && onToggleExpand(folder.path)}
            className={cn(
              'group flex h-9 items-center overflow-hidden rounded-md px-2.5 transition-colors',
              folder.missing ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-sidebar-accent'
            )}
          >
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
                  <span className={cn('ml-2 min-w-0 truncate text-md', folder.missing && 'text-muted-foreground line-through')}>{folder.name}</span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  <span className="text-xs">{folder.missing ? `Folder not found: ${folder.path}` : derived.displayPath}</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {!folder.missing && (
              <div className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={openCreateDialog}
                        className="rounded p-0.5 text-sidebar-foreground/70 transition-colors hover:text-sidebar-accent-foreground"
                      >
                        <CalendarClock className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>New Automation</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onNewSession(folder.path)
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
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem
            onClick={() => onOpenHistory(folder.path)}
            className="text-xs"
          >
            <History className="size-3.5" />
            Session History
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => onRemoveProject(folder)}
            className="text-xs"
          >
            <Trash2 className="size-3.5" />
            Remove Project
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isExpanded && projectAutomations.length > 0 && (
        <div className="overflow-hidden pl-5">
          <button
            onClick={() => setAutomationsExpanded((v) => !v)}
            className="group/auto flex h-7 w-full items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/70"
          >
            <ChevronRight className={cn(
              'hidden size-3.5 shrink-0 transition-transform duration-200 group-hover/auto:block',
              automationsExpanded && 'rotate-90',
            )} />
            <CalendarClock className="size-3.5 shrink-0 group-hover/auto:hidden" />
            <span>Automations</span>
            <span className="ml-auto text-[10px] text-sidebar-foreground/30">{projectAutomations.length}</span>
          </button>
          {automationsExpanded && (
            <div className="flex flex-col py-0.5 pl-4">
              {projectAutomations.map((automation) => (
                <ContextMenu key={automation.id}>
                  <ContextMenuTrigger asChild>
                    <button
                      onClick={() => openEditDialog(automation)}
                      className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-sidebar-accent"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <CalendarClock className="size-3 shrink-0 text-sidebar-foreground/50" />
                        <span className="truncate">{automation.name}</span>
                      </span>
                      <span className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        automation.lastRunStatus === 'error' ? 'bg-red-500' :
                        automation.lastRunStatus === 'running' ? 'bg-yellow-500' :
                        automation.enabled ? 'bg-green-500' : 'bg-muted-foreground/30',
                      )} />
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => { window.app.runAutomationNow(automation.id).catch(() => {}) }}>
                      <Play className="size-3.5" />
                      Run Now
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => openEditDialog(automation)}>
                      <Pencil className="size-3.5" />
                      Edit
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => { window.app.deleteAutomation(automation.id).then(refreshAutomations).catch(() => {}) }}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          )}
        </div>
      )}

      {derived.showSessions && (
        <div className="overflow-hidden">
          <div className="flex flex-col py-0.5 pl-5">
            {derived.sessionsToShow.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[11px] text-sidebar-foreground/70">No sessions</div>
            ) : (
              derived.sessionsToShow.map((session) => {
                const sessionEntry = projectSession?._sessions?.[session.sessionId]
                const isRunning = sessionEntry?.status === 'streaming'
                const isUnseen = projectSession?.unseenCompletedSessions?.has(session.sessionId)
                const pendingReason = getPendingReason(sessionEntry?.pendingPermissions, sessionEntry?.pendingQuestion, sessionEntry?.pendingPlanApproval)
                return (
                  <div key={session.sessionId}>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <div
                          onClick={() => onSwitchSession(folder.path, session.sessionId)}
                          className={cn(
                            'group/session flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 py-1.5 transition-colors',
                            derived.isActive && derived.activeSid === session.sessionId
                              ? 'bg-sidebar-accent'
                              : 'hover:bg-sidebar-accent'
                          )}
                        >
                          <div className="relative flex shrink-0 items-center justify-center size-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onHideSession(session.sessionId, true, folder.path)
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
                                  : session.isAutomation
                                    ? <CalendarClock className="size-3 text-sidebar-foreground/70" />
                                    : session.isWorktree
                                      ? <GitFork className="size-3 text-sidebar-foreground/70" />
                                      : remoteSessionId === session.sessionId
                                        ? <Smartphone className="size-3 text-sidebar-foreground/70" />
                                        : <MessageSquare className="size-3 text-sidebar-foreground/70" />
                              }
                            </span>
                          </div>
                          <span className="min-w-0 truncate text-[13px]">{session.title}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onPinSession(session.sessionId, !session.isPinned, folder.path)
                            }}
                            className="ml-auto shrink-0 rounded p-0.5 text-sidebar-foreground/70 opacity-0 transition-opacity hover:text-sidebar-accent-foreground group-hover/session:opacity-100"
                          >
                            <Pin className="size-3" />
                          </button>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-48">
                        <ContextMenuItem
                          onClick={() => onRenameSession({ sessionId: session.sessionId, title: session.title, folderPath: folder.path })}
                          className="text-xs"
                        >
                          <Pencil className="size-3.5" />
                          Rename
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => onPinSession(session.sessionId, !session.isPinned, folder.path)}
                          className="text-xs"
                        >
                          <Pin className="size-3.5" />
                          {session.isPinned ? 'Unpin' : 'Pin'}
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => onHideSession(session.sessionId, true, folder.path)}
                          className="text-xs"
                        >
                          <EyeOff className="size-3.5" />
                          Hide
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onClick={() => {
                            const providerLabel = session.provider === 'codex' ? 'Codex' : 'Claude Code'
                            if (session.providerSessionId) {
                              navigator.clipboard.writeText(session.providerSessionId)
                              toast.success(`${providerLabel} Session ID Copied`)
                            } else {
                              navigator.clipboard.writeText(session.sessionId)
                              toast.success(`${providerLabel} Session ID not ready — copied internal id`)
                            }
                          }}
                          className="text-xs"
                        >
                          <Copy className="size-3.5" />
                          Copy Session ID
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => { const dir = session.worktreePath ?? folder.path; navigator.clipboard.writeText(dir); toast.success('Working Directory Copied') }}
                          className="text-xs"
                        >
                          <Copy className="size-3.5" />
                          Copy Working Directory
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => window.app.openFolder(session.worktreePath ?? folder.path)}
                          className="text-xs"
                        >
                          <FolderOpen className="size-3.5" />
                          Open Folder
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => onDeleteSession({
                            sessionId: session.sessionId,
                            title: session.title,
                            folderPath: folder.path,
                            provider: (session.provider ?? 'claude') as 'claude' | 'codex',
                          })}
                          className="text-xs"
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                    {pendingReason && (
                      <div
                        onClick={() => onSwitchSession(folder.path, session.sessionId)}
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
        </div>
      )}

      <AutomationDialog
        open={automationDialogOpen}
        onOpenChange={setAutomationDialogOpen}
        editAutomation={editingAutomation}
        projectPath={folder.path}
        onSaved={refreshAutomations}
      />
    </div>
  )
})
