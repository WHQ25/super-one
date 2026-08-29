import { memo, useMemo, useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { CalendarClock, ChevronDown, ChevronRight, ChevronUp, Folder, FolderOpen, FolderX, History, Pencil, Play, SquarePen, Trash2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { useChatStore } from '@/stores/chat'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { useMiniAppStore } from '@/stores/miniapp'
import { armedSendFor, useScheduledSendsStore } from '@/stores/scheduled-sends'
import { MiniAppHostGroup } from './MiniAppHostGroup'
import { cn } from '@superone/ui/lib/utils'
import { homePath } from '@/lib/path-utils'
import type { Automation, RecentFolder, ScheduledSend, SessionHistoryEntry } from '@superone/shared/agent-types'
import { DEFAULT_SESSION_TITLE, getSessionTitle, isLiveSession } from './session-state-utils'
import { AutomationDialog } from '../AutomationDialog'
import { SessionRow, type SessionRowCallbacks } from './SessionRow'
import { ProjectHistoryList } from './ProjectHistoryList'

function MorphHeight({ children, morphKey }: { children: React.ReactNode; morphKey: unknown }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const prevKeyRef = useRef(morphKey)
  const pendingFromRef = useRef<number | null>(null)
  const animationRef = useRef<Animation | null>(null)

  if (prevKeyRef.current !== morphKey) {
    prevKeyRef.current = morphKey
    pendingFromRef.current = innerRef.current?.offsetHeight ?? null
  }

  useLayoutEffect(() => {
    const from = pendingFromRef.current
    pendingFromRef.current = null
    if (from == null || !outerRef.current || !innerRef.current) return
    const to = innerRef.current.offsetHeight
    if (from === to || typeof outerRef.current.animate !== 'function') return
    animationRef.current?.cancel()
    animationRef.current = outerRef.current.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: 160, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    )
  })

  return (
    <div ref={outerRef} style={{ overflow: 'hidden' }}>
      <div ref={innerRef}>{children}</div>
    </div>
  )
}

interface SidebarSessionGroup {
  parent: SessionHistoryEntry
  children: SessionHistoryEntry[]
}

export function groupSidebarSessions(sessions: SessionHistoryEntry[]): SidebarSessionGroup[] {
  const byId = new Map(sessions.map((session) => [session.sessionId, session]))
  const children = new Map<string, SessionHistoryEntry[]>()
  for (const session of sessions) {
    if (!session.parentSessionId || !byId.has(session.parentSessionId)) continue
    const current = children.get(session.parentSessionId) ?? []
    current.push(session)
    children.set(session.parentSessionId, current)
  }
  return sessions
    .filter((session) => !session.parentSessionId || !byId.has(session.parentSessionId))
    .map((parent) => ({ parent, children: children.get(parent.sessionId) ?? [] }))
}

/**
 * Float the groups that owe a send to the top, soonest first.
 *
 * A queued send is the one thing in this list that is about the *future*: every
 * other row is ordered by when it was last active, which buries the session that
 * is going to speak next under every session that already has. Ties and the
 * unscheduled remainder keep the order they came in, so this only ever lifts
 * rows — it never reshuffles the list underneath them.
 *
 * Only the parent counts. A collab child sits inside its parent's group, and
 * pulling the group up because a child is scheduled would move a row the user
 * cannot even see while the group is collapsed.
 */
export function orderScheduledGroupsFirst(
  groups: SidebarSessionGroup[],
  scheduledBySession: Record<string, ScheduledSend>,
): SidebarSessionGroup[] {
  const ranked = groups.map((group, index) => ({
    group,
    index,
    dueAt: armedSendFor(scheduledBySession, group.parent.sessionId)?.sendAt ?? null,
  }))
  if (!ranked.some((entry) => entry.dueAt !== null)) return groups
  ranked.sort((a, b) => {
    if (a.dueAt !== null && b.dueAt !== null) return a.dueAt - b.dueAt || a.index - b.index
    if (a.dueAt !== null) return -1
    if (b.dueAt !== null) return 1
    return a.index - b.index
  })
  return ranked.map((entry) => entry.group)
}

/**
 * Mirrors project-list collapse: when the parent's child list is collapsed,
 * still surface live/unseen children (streaming, pending, unseen, …).
 * Expanded lists show every child.
 */
export function visibleChildSessions(
  children: SessionHistoryEntry[],
  childrenExpanded: boolean,
  isLive: (session: SessionHistoryEntry) => boolean,
): SessionHistoryEntry[] {
  if (childrenExpanded) return children
  return children.filter(isLive)
}

interface ProjectSidebarRowProps extends SessionRowCallbacks {
  folder: RecentFolder
  isExpanded: boolean
  sessions: SessionHistoryEntry[]
  maxSessions: number
  onToggleExpand: (folderPath: string) => void
  onEditProject: (folder: RecentFolder) => void
  onRemoveProject: (folder: RecentFolder) => void
  onNewSession: (folderPath: string) => void
}

export const ProjectSidebarRow = memo(function ProjectSidebarRow({
  folder,
  isExpanded,
  sessions: allSessions,
  maxSessions,
  onToggleExpand,
  onSwitchSession,
  onPinSession,
  onHideSession,
  onEditProject,
  onRemoveProject,
  onRenameSession,
  onDeleteSession,
  onNewSession,
}: ProjectSidebarRowProps) {
  const { t } = useTranslation()
  const realtimeSessionSig = useCodexRealtimeViewStore((state) => Object.entries(state.sessions)
    .filter(([, session]) => session.hasTimeline || session.realtimeSessionId !== null)
    .map(([sessionId, session]) => [
      sessionId,
      session.hasTimeline ? 1 : 0,
      session.realtimeSessionId ?? '',
    ].join('\x01'))
    .sort()
    .join('\x01'))
  const liveSessionSig = useChatStore(useShallow((s) => {
    const proj = s.projectSessions[folder.path]
    const sig: Record<string, string> = {}
    if (proj?._sessions) {
      for (const [sid, data] of Object.entries(proj._sessions)) {
        const hasRealtimeTimeline = useCodexRealtimeViewStore.getState().sessions[sid]?.hasTimeline ?? false
        if (data.messages.length === 0 && !hasRealtimeTimeline) continue
        sig[sid] = [
          data.status ?? '',
          data.messages.length,
          data._historyHydrated ? 1 : 0,
          proj.unseenCompletedSessions.has(sid) ? 1 : 0,
          (data.pendingPermissions?.length ?? 0) > 0 ? 1 : 0,
          data.pendingQuestion ? 1 : 0,
          data.pendingPlanApproval ? 1 : 0,
          data.awaitingAssistantReply ? 1 : 0,
          data.sessionProvider ?? '',
          data.session?.sessionId ?? '',
          data._gitBranch ?? '',
          data._worktreePath ?? '',
          getSessionTitle(data.messages) ?? '',
          hasRealtimeTimeline ? 1 : 0,
        ].join('\x01')
      }
    }
    return sig
  }))

  const INITIAL_EXPAND_LEVEL = 6
  const [expandLevel, setExpandLevel] = useState<number>(INITIAL_EXPAND_LEVEL)
  const [historyMode, setHistoryMode] = useState(false)
  /** Parent session ids whose collab child list is fully expanded. Default: collapsed. */
  const [expandedChildrenIds, setExpandedChildrenIds] = useState<Set<string>>(() => new Set())

  const toggleChildrenExpanded = useCallback((sessionId: string) => {
    setExpandedChildrenIds((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }, [])

  useEffect(() => {
    if (!isExpanded) setExpandLevel(INITIAL_EXPAND_LEVEL)
  }, [isExpanded])

  const openHistory = useCallback(() => {
    setHistoryMode(true)
    if (!isExpanded) onToggleExpand(folder.path)
  }, [isExpanded, onToggleExpand, folder.path])

  const scheduledBySession = useScheduledSendsStore((s) => s.bySession)

  const derived = useMemo(() => {
    const projectSession = useChatStore.getState().projectSessions[folder.path]
    const dbVisibleSessions = allSessions.filter((session) => !session.isHidden)
    const dbSessionById = new Map(allSessions.map((session) => [session.sessionId, session]))
    let sessions = dbVisibleSessions

    if (projectSession?._sessions) {
      const live: SessionHistoryEntry[] = []
      for (const [sid, data] of Object.entries(projectSession._sessions)) {
        const hasRealtimeTimeline = useCodexRealtimeViewStore.getState().sessions[sid]?.hasTimeline ?? false
        if (data.messages.length === 0 && !hasRealtimeTimeline) continue
        const title = getSessionTitle(data.messages)
        const dbEntry = dbSessionById.get(sid)
        if (dbEntry?.isHidden) continue
        if (dbEntry) continue
        const isUnseen = projectSession.unseenCompletedSessions.has(sid)
        if (!hasRealtimeTimeline && !isLiveSession(data, isUnseen)) continue
        if (!title && !data._historyHydrated) continue
        live.push({
          sessionId: sid,
          title: title ?? DEFAULT_SESSION_TITLE,
          lastActiveAt: new Date().toISOString(),
          provider: data.sessionProvider ?? undefined,
          providerSessionId: data._providerSessionId ?? undefined,
          messageCount: data.messages.length,
          isWorktree: !!data._gitBranch,
          gitBranch: data._gitBranch ?? undefined,
          worktreePath: data._worktreePath ?? undefined,
        })
      }
      if (live.length > 0) sessions = [...live, ...sessions]
    }

    const groups = orderScheduledGroupsFirst(groupSidebarSessions(sessions), scheduledBySession)
    const isLive = (session: SessionHistoryEntry) => {
      const entry = projectSession?._sessions?.[session.sessionId]
      const isUnseen = projectSession?.unseenCompletedSessions?.has(session.sessionId)
      if (!entry && !isUnseen) return false
      const realtimeSessionId = useCodexRealtimeViewStore
        .getState()
        .sessions[session.sessionId]?.realtimeSessionId
      const isRealtimeActive = typeof realtimeSessionId === 'string'
      return isLiveSession(entry, isUnseen, isRealtimeActive)
    }
    const liveGroups = isExpanded ? [] : groups.filter((group) =>
      isLive(group.parent) || group.children.some(isLive),
    )

    const displayLimit = Math.min(expandLevel, maxSessions)
    return {
      displayPath: homePath(
        // Strip remote host-scoped keys for display (see remote-project-key.ts).
        folder.path.startsWith('remote:')
          ? folder.path.slice(folder.path.indexOf(':', 'remote:'.length) + 1) || folder.path
          : folder.path,
      ),
      groupsToShow: isExpanded ? groups.slice(0, displayLimit) : liveGroups,
      showSessions: isExpanded || liveGroups.length > 0,
      totalCount: groups.length,
      hasMoreThanInitial: groups.length > expandLevel,
      hasOverflow: groups.length > maxSessions,
      isLive,
    }
  }, [allSessions, folder.path, isExpanded, maxSessions, liveSessionSig, realtimeSessionSig, expandLevel, scheduledBySession])

  /**
   * Every opened mini-app owns a host process, so listing live hosts would just
   * mirror the open panels. This group is about work the user cannot see, which
   * only apps that declared `background` in their manifest can do — UI-bound
   * hosts are released with their last panel.
   */
  const projectHosts = useMiniAppStore(useShallow((s) =>
    s.hosts.filter((host) => host.projectDir === folder.path && host.background),
  ))
  const handleStopHost = useCallback((appId: string) => {
    window.miniapp.hostStop(folder.path, appId).catch(() => {})
  }, [folder.path])

  const handleOpenHostApp = useCallback((appId: string) => {
    const entry = useMiniAppStore.getState().apps.find((a) => a.id === appId)
    if (entry) useMiniAppStore.getState().openAppInPanel(entry, folder.path).catch(() => {})
  }, [folder.path])

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

  // MCP / IPC list mutations + run lifecycle (status dots) while this project is expanded.
  useEffect(() => {
    if (!isExpanded || folder.missing) return
    const unsubChanged = window.app.onAutomationsChanged((event) => {
      if (event.projectPath && event.projectPath !== folder.path) return
      refreshAutomations()
    })
    const unsubRun = window.app.onAutomationEvent((event) => {
      // Prefer projectPath when present; otherwise only re-list if we already track this id.
      if (event.projectPath && event.projectPath !== folder.path) return
      if (!event.projectPath) {
        // Legacy events without projectPath: still refresh (cheap).
      }
      refreshAutomations()
    })
    return () => {
      unsubChanged()
      unsubRun()
    }
  }, [isExpanded, folder.missing, folder.path, refreshAutomations])

  const openCreateDialog = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingAutomation(null)
    setAutomationDialogOpen(true)
  }, [])

  const openEditDialog = useCallback((automation: Automation) => {
    setEditingAutomation(automation)
    setAutomationDialogOpen(true)
  }, [])

  const folderMenuItems: AdaptiveMenuEntry[] = [
    ...(!folder.missing
      ? ([
          { kind: 'item', id: 'history', label: t('sidebar.contextMenu.sessionHistory'), icon: History, onSelect: openHistory },
          // Gated on !missing like history: with the root gone there is nothing
          // meaningful to point workspace folders at.
          { kind: 'item', id: 'edit-project', label: t('sidebar.contextMenu.editProject'), icon: Pencil, onSelect: () => onEditProject(folder) },
          { kind: 'separator' },
        ] as AdaptiveMenuEntry[])
      : []),
    { kind: 'item', id: 'remove', label: t('sidebar.contextMenu.removeProject'), icon: Trash2, destructive: true, onSelect: () => onRemoveProject(folder) },
  ]

  return (
    <div>
      <AdaptiveContextMenu items={folderMenuItems} contentClassName="w-48">
          <div
            onClick={() => {
              if (folder.missing) return
              if (historyMode) setHistoryMode(false)
              onToggleExpand(folder.path)
            }}
            className={cn(
              'group flex h-9 items-center overflow-hidden rounded-md px-2.5 transition-colors',
              folder.missing ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-sidebar-hover'
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
                  <span className={cn('ml-2 min-w-0 truncate text-md', folder.missing && 'text-sidebar-foreground/50 line-through')}>{folder.name}</span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  <span className="text-xs">{folder.missing ? t('tooltips.folderNotFound', { path: folder.path }) : derived.displayPath}</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {!folder.missing && (
              <div
                data-slot="project-row-actions"
                className="invisible ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100"
              >
                <IconButton
                  size="md"
                  variant="nested"
                  tooltip={t('tooltips.newAutomation')}
                  tooltipSideOffset={8}
                  onClick={openCreateDialog}
                >
                  <CalendarClock />
                </IconButton>
                <IconButton
                  size="md"
                  variant="nested"
                  tooltip={t('tooltips.newSession')}
                  tooltipSideOffset={8}
                  onClick={(e) => {
                    e.stopPropagation()
                    onNewSession(folder.path)
                  }}
                >
                  <SquarePen />
                </IconButton>
              </div>
            )}
          </div>
      </AdaptiveContextMenu>

      {isExpanded && projectAutomations.length > 0 && (
        <div className="overflow-hidden pl-2.5">
          <button
            onClick={() => setAutomationsExpanded((v) => !v)}
            className="group/auto flex h-7 w-full items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground/70"
          >
            <ChevronRight className={cn(
              'hidden size-3.5 shrink-0 transition-transform duration-200 group-hover/auto:block',
              automationsExpanded && 'rotate-90',
            )} />
            <CalendarClock className="size-3.5 shrink-0 group-hover/auto:hidden" />
            <span>{t('sidebar.contextMenu.automations')}</span>
            <span className="ml-auto text-[10px] text-sidebar-foreground/30">{projectAutomations.length}</span>
          </button>
          {automationsExpanded && (
            <div className="flex flex-col py-0.5 pl-2">
              {projectAutomations.map((automation) => {
                const automationMenuItems: AdaptiveMenuEntry[] = [
                  { kind: 'item', id: 'run', label: t('sidebar.contextMenu.runNow'), icon: Play, onSelect: () => { window.app.runAutomationNow(automation.id).catch(() => {}) } },
                  { kind: 'item', id: 'edit', label: t('sidebar.contextMenu.edit'), icon: Pencil, onSelect: () => openEditDialog(automation) },
                  { kind: 'separator' },
                  { kind: 'item', id: 'delete', label: t('sidebar.contextMenu.delete'), icon: Trash2, destructive: true, onSelect: () => { window.app.deleteAutomation(automation.id).then(refreshAutomations).catch(() => {}) } },
                ]
                return (
                <AdaptiveContextMenu key={automation.id} items={automationMenuItems}>
                    <button
                      onClick={() => openEditDialog(automation)}
                      className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-sidebar-hover"
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
                </AdaptiveContextMenu>
                )
              })}
            </div>
          )}
        </div>
      )}

      {isExpanded && (
        <MiniAppHostGroup
          hosts={projectHosts}
          onOpen={handleOpenHostApp}
          onStop={handleStopHost}
        />
      )}

      <MorphHeight morphKey={historyMode}>
        {historyMode ? (
          <ProjectHistoryList
            folderPath={folder.path}
            initialSessions={allSessions}
            onClose={() => setHistoryMode(false)}
            onSwitchSession={onSwitchSession}
            onPinSession={onPinSession}
            onHideSession={onHideSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
          />
        ) : derived.showSessions ? (
          <div className="flex flex-col py-0.5 pl-2.5">
            {derived.groupsToShow.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[11px] text-sidebar-foreground/70">{t('sidebar.contextMenu.noSessions')}</div>
            ) : (
              derived.groupsToShow.map(({ parent, children }) => {
                const hasChildren = children.length > 0
                const childrenExpanded = hasChildren && expandedChildrenIds.has(parent.sessionId)
                const childrenCollapsed = hasChildren && !childrenExpanded
                const childrenToShow = visibleChildSessions(children, childrenExpanded, derived.isLive)
                return (
                <div key={parent.sessionId}>
                  <SessionRow
                    session={parent}
                    folderPath={folder.path}
                    hasChildren={hasChildren}
                    childrenCollapsed={childrenCollapsed}
                    onToggleChildren={hasChildren ? () => toggleChildrenExpanded(parent.sessionId) : undefined}
                    onSwitchSession={onSwitchSession}
                    onPinSession={onPinSession}
                    onHideSession={onHideSession}
                    onRenameSession={onRenameSession}
                    onDeleteSession={onDeleteSession}
                  />
                  {childrenToShow.map((child) => (
                    <SessionRow
                      key={child.sessionId}
                      session={child}
                      folderPath={folder.path}
                      childSession
                      onSwitchSession={onSwitchSession}
                      onPinSession={onPinSession}
                      onHideSession={onHideSession}
                      onRenameSession={onRenameSession}
                      onDeleteSession={onDeleteSession}
                    />
                  ))}
                </div>
                )
              })
            )}
            {isExpanded && expandLevel < maxSessions && derived.hasMoreThanInitial && (
              <button
                onClick={() => setExpandLevel(maxSessions)}
                className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground/70"
              >
                <ChevronDown className="size-3.5 shrink-0" />
                <span>{t('sidebar.contextMenu.showMore')}</span>
              </button>
            )}
            {isExpanded && expandLevel >= maxSessions && derived.totalCount > INITIAL_EXPAND_LEVEL && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setExpandLevel(INITIAL_EXPAND_LEVEL)}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground/70"
                >
                  <ChevronUp className="size-3.5 shrink-0" />
                  <span>{t('sidebar.contextMenu.showLess')}</span>
                </button>
                {derived.hasOverflow && (
                  <IconButton
                    size="md"
                    tooltip={t('sidebar.contextMenu.sessionHistory')}
                    onClick={openHistory}
                  >
                    <History />
                  </IconButton>
                )}
              </div>
            )}
          </div>
        ) : null}
      </MorphHeight>

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
