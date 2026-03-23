import { memo, useMemo } from 'react'
import { toast } from 'sonner'
import { Bot, ChevronRight, CircleCheck, Copy, EyeOff, Folder, FolderOpen, FolderX, GitFork, History, Loader2, MessageSquare, MoreHorizontal, Pencil, Pin, Smartphone, SquarePen, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useChatStore } from '@/stores/chat'
import { cn } from '@/lib/utils'
import { homePath } from '@/lib/path-utils'
import type { RecentFolder, SessionHistoryEntry } from '../../../../shared/agent-types'
import { getPendingReason, isLiveSession } from './session-state-utils'

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
        const firstText = data.messages[0]?.content.find((block) => block.type === 'text')
        const dbEntry = dbSessionById.get(sid)
        if (dbEntry?.isHidden) continue
        if (dbEntry) continue
        const isUnseen = projectSession.unseenCompletedSessions.has(sid)
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

  return (
    <div>
      <div
        onClick={() => !folder.missing && onToggleExpand(folder.path)}
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
                <span className="text-xs">{folder.missing ? `Folder not found: ${folder.path}` : derived.displayPath}</span>
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
                      onRemoveProject(folder)
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
                      onOpenHistory(folder.path)
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
                      onRemoveProject(folder)
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
            </>
          )}
        </div>
      </div>

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
                      <ContextMenuContent className="w-36">
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
    </div>
  )
}, (prev, next) =>
  prev.folder === next.folder &&
  prev.currentFolder === next.currentFolder &&
  prev.hasRealProject === next.hasRealProject &&
  prev.isExpanded === next.isExpanded &&
  prev.sessions === next.sessions &&
  prev.maxSessions === next.maxSessions &&
  prev.onToggleExpand === next.onToggleExpand &&
  prev.onSwitchSession === next.onSwitchSession &&
  prev.onPinSession === next.onPinSession &&
  prev.onHideSession === next.onHideSession &&
  prev.onRemoveProject === next.onRemoveProject &&
  prev.onRenameSession === next.onRenameSession &&
  prev.onDeleteSession === next.onDeleteSession &&
  prev.onOpenHistory === next.onOpenHistory &&
  prev.onNewSession === next.onNewSession
)
