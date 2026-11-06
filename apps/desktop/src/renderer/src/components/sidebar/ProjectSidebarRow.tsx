import { memo, useMemo, useState, useEffect, useCallback, useRef, useLayoutEffect, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { CalendarClock, ChevronRight, Folder, FolderOpen, FolderX, Loader2, Pencil, Play, Search, SquarePen, Trash2 } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { useChatStore } from '@/stores/chat'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { useMiniAppStore } from '@/stores/miniapp'
import { armedSendFor, useScheduledSendsStore } from '@/stores/scheduled-sends'
import { MiniAppHostGroup } from './MiniAppHostGroup'
import { SidebarHoverChevron, sidebarRowActionsClass } from './hover-disclosure'
import { cn } from '@superone/ui/lib/utils'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { isListedSession } from '@/lib/session-list-ops'
import { projectHostPath, projectHoverFolders } from '@/lib/multi-host/project-hover'
import { ProjectHoverCard } from './multi-host/ProjectHoverCard'
import { SessionHoverCardTrigger, sidebarHoverCardRowClass } from './multi-host/SessionHoverCard'
import type { Automation, PinnedSessionEntry, RecentFolder, ScheduledSend, SessionHistoryEntry } from '@superone/shared/agent-types'
import { getSessionTitle, isEphemeralSession, isLiveSession, withLiveSessionBrand } from './session-state-utils'
import { selectSessionTitle } from '@/lib/session-title'
import { AutomationDialog } from '../AutomationDialog'
import { SessionRow, type SessionRowCallbacks } from './SessionRow'
import type { SessionHoverModel } from '@/lib/multi-host/session-hover'
import { ActiveSessionList } from './ActiveSessionList'
import { ProjectHistoryList } from './ProjectHistoryList'
import { SettledSection } from './SettledSection'
import { foldProjectSettled } from './sidebar-section-collapse'
import { focusProject } from './sidebar-focus'

const EMPTY_SETTLED_SESSIONS: PinnedSessionEntry[] = []

function SessionGroupsFrame({
  open,
  hasMore,
  onLoadMore,
  fill = false,
  children,
}: {
  open: boolean
  hasMore: boolean
  onLoadMore?: () => void | Promise<void>
  /** Focus mode: this project's list is the pane, so the height cap comes off. */
  fill?: boolean
  children: React.ReactNode
}) {
  // A collapsed project only keeps attention rows. Those stay in the sidebar flow.
  // The open list is its own scroller, same as search and Settled.
  if (!open) return children
  return (
    <ActiveSessionList hasMore={hasMore} onLoadMore={onLoadMore} layout={fill ? 'fill' : 'cap'}>
      {children}
    </ActiveSessionList>
  )
}

function MorphHeight({ children, morphKey, fill = false }: { children: React.ReactNode; morphKey: unknown; fill?: boolean }) {
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
    // A pixel height would pin the focus pane instead of letting the list fill it.
    if (fill || from == null || !outerRef.current || !innerRef.current) return
    const to = innerRef.current.offsetHeight
    if (from === to || typeof outerRef.current.animate !== 'function') return
    animationRef.current?.cancel()
    animationRef.current = outerRef.current.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: 160, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    )
  })

  return (
    <div ref={outerRef} className={cn(fill && 'flex min-h-0 flex-1 flex-col')} style={{ overflow: 'hidden' }}>
      <div ref={innerRef} className={cn(fill && 'flex min-h-0 flex-1 flex-col')}>{children}</div>
    </div>
  )
}

export interface SidebarSessionGroup {
  parent: SessionHistoryEntry
  children: SessionHistoryEntry[]
}

export interface SidebarSessionSections {
  attention: SidebarSessionGroup[]
  scheduled: SidebarSessionGroup[]
  normal: SidebarSessionGroup[]
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

export function partitionSidebarSessionGroups(
  groups: SidebarSessionGroup[],
  scheduledBySession: Record<string, ScheduledSend>,
  isAttention: (session: SessionHistoryEntry) => boolean,
): SidebarSessionSections {
  const attention: SidebarSessionGroup[] = []
  const scheduled: Array<{ group: SidebarSessionGroup; sendAt: number; index: number }> = []
  const normal: SidebarSessionGroup[] = []

  // Membership is exclusive and checked in priority order. A scheduled
  // attention session stays in group one; only the parent owns a scheduled send.
  groups.forEach((group, index) => {
    if (isAttention(group.parent) || group.children.some(isAttention)) {
      attention.push(group)
      return
    }
    const queued = armedSendFor(scheduledBySession, group.parent.sessionId)
    if (queued) {
      scheduled.push({ group, sendAt: queued.sendAt, index })
      return
    }
    normal.push(group)
  })

  scheduled.sort((a, b) => a.sendAt - b.sendAt || a.index - b.index)
  return {
    attention,
    scheduled: scheduled.map((entry) => entry.group),
    normal,
  }
}

/**
 * `isPinned` keeps a group rendered without promoting it — the session the user
 * is currently viewing must stay reachable in the sidebar, but reordering it to
 * the top would reshuffle the list under the cursor on every switch. So a pinned
 * group holds its natural position and is only appended when the display limit
 * (or a collapsed project row) would otherwise drop it.
 */
export function visibleSidebarSessionGroups(
  sections: SidebarSessionSections,
  isExpanded: boolean,
  displayLimit: number,
  isPinned: (group: SidebarSessionGroup) => boolean = () => false,
): SidebarSessionGroup[] {
  const visible = isExpanded
    ? (() => {
        const required = [...sections.attention, ...sections.scheduled]
        const normalSlots = Math.max(0, displayLimit - required.length)
        return [...required, ...sections.normal.slice(0, normalSlots)]
      })()
    : [...sections.attention]
  const shown = new Set(visible.map((group) => group.parent.sessionId))
  for (const group of [...sections.scheduled, ...sections.normal]) {
    if (shown.has(group.parent.sessionId) || !isPinned(group)) continue
    visible.push(group)
  }
  return visible
}

/**
 * A session the active query did not return. Settled sessions are omitted from
 * that query on purpose; opening one, or restoring its Codex voice timeline,
 * must not invent a second row above the Settled group. A session with no row
 * yet still surfaces while it is the one on screen, a live turn, or a voice
 * timeline that has not been written down.
 */
export function shouldSynthesizeActiveSidebarSession(input: {
  settled: boolean
  foreground: boolean
  live: boolean
  hasRealtimeTimeline: boolean
}): boolean {
  if (input.settled) return false
  return input.foreground || input.live || input.hasRealtimeTimeline
}

/**
 * Mirrors project-list collapse: when the parent's child list is collapsed,
 * still surface children that must stay reachable (running, pending, unseen,
 * and the session currently in the foreground). Expanded lists show every child.
 */
export function visibleChildSessions(
  children: SessionHistoryEntry[],
  childrenExpanded: boolean,
  isVisibleWhenCollapsed: (session: SessionHistoryEntry) => boolean,
): SessionHistoryEntry[] {
  if (childrenExpanded) return children
  return children.filter(isVisibleWhenCollapsed)
}

export interface ProjectFocusActions {
  openHistory: () => void
  openAutomation: () => void
}

interface ProjectSidebarRowProps extends SessionRowCallbacks {
  folder: RecentFolder
  isExpanded: boolean
  sessions: SessionHistoryEntry[]
  /** Session list is in flight. Spins the folder icon; does not add a row. */
  sessionsLoading?: boolean
  /** Session whose open is in flight. Spins the icon in front of its title. */
  openingSessionId?: string | null
  onToggleExpand: (folderPath: string) => void
  onEditProject: (folder: RecentFolder) => void
  onRemoveProject: (folder: RecentFolder) => void
  onNewSession: (folderPath: string) => void
  /** Dims the checkout and its sessions when that environment is offline. */
  offline?: boolean
  /**
   * Origin when the catalog already knows it. Omit on a recent-folder row so
   * the card asks the environment. `null` means there is no remote.
   */
  repoIdentity?: string | null
  /** Hover card fields. The row never fetches them. */
  sessionPresentation?: (session: SessionHistoryEntry) => {
    hover?: SessionHoverModel | null
    environmentOffline?: boolean
  }
  /** Merged project: sessions sit under one header, so this checkout draws none. */
  sessionsOnly?: boolean
  /** Finished sessions for every open project. This row keeps its own folder. */
  settledSessions?: PinnedSessionEntry[]
  /** This project's settled list has another page below the rows already shown. */
  settledHasMore?: boolean
  /** Settled sessions in this project, including pages not loaded yet. */
  settledCount?: number
  onLoadMoreSettled?: (folderPath: string) => void | Promise<void>
  /** The active list has another page below the rows already shown. */
  sessionsHasMore?: boolean
  /** Scroll near the bottom of the active list loads the next page. */
  onLoadMoreSessions?: (folderPath: string) => void | Promise<void>
  /** Spawn children already loaded for each parent in this project. */
  childSessions?: Record<string, SessionHistoryEntry[]>
  /** parent id → that child's list has another page. */
  childSessionsHasMore?: Record<string, boolean>
  /**
   * Parents whose child lists start open. Later toggles stay on this row.
   * The sidebar itself starts every list collapsed.
   */
  initialExpandedChildIds?: readonly string[]
  /** Expanding a parent loads its first page of children. */
  onLoadChildSessions?: (folderPath: string, parentSessionId: string) => void | Promise<void>
  /** Scrolling a parent's child list loads the next page. */
  onLoadMoreChildSessions?: (folderPath: string, parentSessionId: string) => void | Promise<void>
  /** `fill` is project focus: the active list takes the pane and Settled stays at the bottom. */
  sessionListLayout?: 'cap' | 'fill'
  /** The environment this checkout belongs to. Omitted on the single-host list. */
  focusEnvironmentId?: string | null
  /** Focus bar calls search and new-automation while this row's own header is hidden. */
  focusActionsRef?: RefObject<ProjectFocusActions | null>
}

const EMPTY_CHILD_SESSIONS: Record<string, SessionHistoryEntry[]> = {}
const EMPTY_CHILD_HAS_MORE: Record<string, boolean> = {}

function mergeListedSessions(
  roots: SessionHistoryEntry[],
  childrenByParent: Record<string, SessionHistoryEntry[]>,
): SessionHistoryEntry[] {
  const extra = Object.values(childrenByParent).flat()
  if (extra.length === 0) return roots
  const seen = new Set(roots.map((session) => session.sessionId))
  const merged = roots.slice()
  for (const session of extra) {
    if (seen.has(session.sessionId)) continue
    seen.add(session.sessionId)
    merged.push(session)
  }
  return merged
}

export const ProjectSidebarRow = memo(function ProjectSidebarRow({
  folder,
  isExpanded,
  sessions: allSessions,
  sessionsLoading = false,
  openingSessionId = null,
  onToggleExpand,
  onSwitchSession,
  onPinSession,
  onSettleSession,
  onEditProject,
  onRemoveProject,
  onRenameSession,
  onDeleteSession,
  onNewSession,
  offline = false,
  repoIdentity,
  sessionPresentation,
  sessionsOnly = false,
  settledSessions = EMPTY_SETTLED_SESSIONS,
  settledHasMore = false,
  settledCount,
  onLoadMoreSettled,
  sessionsHasMore = false,
  onLoadMoreSessions,
  childSessions = EMPTY_CHILD_SESSIONS,
  childSessionsHasMore = EMPTY_CHILD_HAS_MORE,
  initialExpandedChildIds,
  onLoadChildSessions,
  onLoadMoreChildSessions,
  sessionListLayout = 'cap',
  focusEnvironmentId,
  focusActionsRef,
}: ProjectSidebarRowProps) {
  const fill = sessionListLayout === 'fill'
  // A disconnected environment has nothing to list. Ignore a stored expand so
  // the row collapses as soon as the connection drops.
  const open = isExpanded && !offline
  // The settled list unmounts with the project. Fold it here so the next expand
  // does not reopen the group the person left open.
  useEffect(() => {
    if (isExpanded) return
    foldProjectSettled(folder.path)
  }, [isExpanded, folder.path])
  const { t } = useTranslation()
  const foregroundSessionId = useChatStore((state) =>
    state.activeProject === folder.path
      ? state.projectSessions[folder.path]?._activeSessionId ?? null
      : null,
  )
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
        if (isEphemeralSession(data)) continue
        const hasRealtimeTimeline = useCodexRealtimeViewStore.getState().sessions[sid]?.hasTimeline ?? false
        // Remote activity entries carry a title/status but no transcript.
        // Include even unnamed placeholders in the signature: their status can
        // reveal a child whose title/parent came from a loaded list page.
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
          data.acpAgentId ?? '',
          data.session?.sessionId ?? '',
          data._gitBranch ?? '',
          data._worktreePath ?? '',
          data._title ?? '',
          data._parentSessionId ?? '',
          getSessionTitle(data.messages) ?? '',
          hasRealtimeTimeline ? 1 : 0,
        ].join('\x01')
      }
    }
    return sig
  }))

  const [historyMode, setHistoryMode] = useState(false)
  /** Parent session ids whose collab child list is fully expanded. Default: collapsed. */
  const [expandedChildrenIds, setExpandedChildrenIds] = useState<Set<string>>(
    () => new Set(initialExpandedChildIds ?? []),
  )

  const toggleChildrenExpanded = useCallback((sessionId: string) => {
    setExpandedChildrenIds((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }, [])

  /** Every session row below already sits under this project row, at whatever
   *  collapse state the user chose — switching to one must not toggle it. */
  const switchSessionInPlace = useCallback(
    (folderPath: string, sessionId: string) => onSwitchSession(folderPath, sessionId, { revealProject: false }),
    [onSwitchSession],
  )

  const openHistory = useCallback(() => {
    if (offline || folder.missing) return
    setHistoryMode(true)
    if (!open) onToggleExpand(folder.path)
  }, [offline, folder.missing, open, onToggleExpand, folder.path])

  const scheduledBySession = useScheduledSendsStore((s) => s.bySession)

  const listedSessions = useMemo(
    () => mergeListedSessions(allSessions, childSessions),
    [allSessions, childSessions],
  )

  const derived = useMemo(() => {
    const projectSession = useChatStore.getState().projectSessions[folder.path]
    const dbVisibleSessions = listedSessions.filter((session) => isListedSession(session))
    const dbSessionById = new Map(listedSessions.map((session) => [session.sessionId, session]))
    const settledIds = new Set<string>()
    for (const session of settledSessions) {
      if (session.folderPath === folder.path) settledIds.add(session.sessionId)
    }
    let sessions = dbVisibleSessions

    if (projectSession?._sessions) {
      const live: SessionHistoryEntry[] = []
      for (const [sid, data] of Object.entries(projectSession._sessions)) {
        if (isEphemeralSession(data)) continue
        const hasRealtimeTimeline = useCodexRealtimeViewStore.getState().sessions[sid]?.hasTimeline ?? false
        if (data.messages.length === 0 && !hasRealtimeTimeline && !data._title) continue
        const title = selectSessionTitle(useChatStore.getState(), folder.path, sid)
        const dbEntry = dbSessionById.get(sid)
        // The active query drops settled rows, so they have no db entry to reject.
        // The Settled page is that missing fact: an open Codex timeline is not a
        // second active row.
        if (!shouldSynthesizeActiveSidebarSession({
          settled: settledIds.has(sid) || (dbEntry != null && !isListedSession(dbEntry)),
          foreground: sid === foregroundSessionId,
          live: isLiveSession(data, projectSession.unseenCompletedSessions.has(sid)),
          hasRealtimeTimeline,
        })) continue
        if (dbEntry) continue
        // A launch has a durable row before its first task arrives. Until hydration
        // restores its spawn relationship, showing it as a root would flash the
        // wrong hierarchy. Handoffs hydrate with no parent and stay independent.
        if (!data._historyHydrated && data.messages.some(
          (message) => message.metadata?.collaboration?.kind === 'initial_task',
        )) continue
        if (!data._title && !getSessionTitle(data.messages) && !data._historyHydrated) continue
        live.push({
          sessionId: sid,
          title,
          lastActiveAt: new Date().toISOString(),
          provider: data.sessionProvider ?? undefined,
          ...(data.acpAgentId ? { acpAgentId: data.acpAgentId } : {}),
          providerSessionId: data._providerSessionId ?? undefined,
          parentSessionId: data._parentSessionId ?? undefined,
          messageCount: data.messages.length,
          isWorktree: !!data._gitBranch,
          gitBranch: data._gitBranch ?? undefined,
          worktreePath: data._worktreePath ?? undefined,
        })
      }
      if (live.length > 0) sessions = [...live, ...sessions]
    }

    sessions = sessions.map((entry) =>
      withLiveSessionBrand(entry, projectSession?._sessions?.[entry.sessionId]),
    )

    // Ordering priority is about work that wants the user — not about where the
    // user already is. The foreground session is pinned visible instead (see
    // `isPinnedGroup`), so switching to an idle session never reorders the list.
    const isAttention = (session: SessionHistoryEntry) => {
      const entry = projectSession?._sessions?.[session.sessionId]
      const isUnseen = projectSession?.unseenCompletedSessions?.has(session.sessionId)
      const realtimeSessionId = useCodexRealtimeViewStore
        .getState()
        .sessions[session.sessionId]?.realtimeSessionId
      return isLiveSession(entry, isUnseen, typeof realtimeSessionId === 'string')
    }
    const isForegroundSession = (session: SessionHistoryEntry) =>
      !!foregroundSessionId && session.sessionId === foregroundSessionId
    const isPinnedGroup = (group: SidebarSessionGroup) =>
      isForegroundSession(group.parent) || group.children.some(isForegroundSession)
    // Collapsed child lists and collapsed project rows both keep the session the
    // user is viewing on screen, so visibility unions both predicates.
    const isVisibleWhenCollapsed = (session: SessionHistoryEntry) =>
      isAttention(session) || isForegroundSession(session)

    const sections = partitionSidebarSessionGroups(
      groupSidebarSessions(sessions),
      scheduledBySession,
      isAttention,
    )
    // An open project shows every loaded non-settled group. Further pages arrive
    // when that list scrolls. Collapsed rows still keep only attention, plus the
    // session the user is already viewing.
    const displayLimit = sections.attention.length + sections.scheduled.length + sections.normal.length
    const groupsToShow = visibleSidebarSessionGroups(sections, open, displayLimit, isPinnedGroup)
    return {
      groupsToShow,
      showSessions: open || groupsToShow.length > 0,
      isVisibleWhenCollapsed,
    }
  }, [listedSessions, settledSessions, folder.path, open, liveSessionSig, realtimeSessionSig, scheduledBySession, foregroundSessionId])

  const projectSettled = useMemo(
    () => settledSessions.filter((session) => session.folderPath === folder.path),
    [settledSessions, folder.path],
  )

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
    if (open) refreshAutomations()
  }, [open, refreshAutomations])

  // MCP / IPC list mutations + run lifecycle (status dots) while this project is expanded.
  useEffect(() => {
    if (!open || folder.missing) return
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
  }, [open, folder.missing, folder.path, refreshAutomations])

  const openAutomation = useCallback(() => {
    setEditingAutomation(null)
    setAutomationDialogOpen(true)
  }, [])

  const openCreateDialog = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    openAutomation()
  }, [openAutomation])

  useEffect(() => {
    if (!focusActionsRef) return
    focusActionsRef.current = { openHistory, openAutomation }
    return () => {
      focusActionsRef.current = null
    }
  }, [focusActionsRef, openHistory, openAutomation])

  const openEditDialog = useCallback((automation: Automation) => {
    setEditingAutomation(automation)
    setAutomationDialogOpen(true)
  }, [])

  const hostPath = projectHostPath(folder.path)
  const remoteProject = parseRemoteProjectKey(folder.path)
  const canOpenFolders = !folder.missing && !remoteProject
  const hoverFolders = useMemo(() => {
    const listed = projectHoverFolders(hostPath, folder.extraDirs)
    if (!canOpenFolders) return listed
    return listed.map((item) => ({ ...item, openable: true }))
  }, [hostPath, folder.extraDirs, canOpenFolders])
  const sessionPaths = useMemo(() => [folder.path], [folder.path])
  const repoLookup = repoIdentity === undefined
    ? { connectionId: remoteProject?.connectionId ?? 'local', projectId: folder.id, hostPath }
    : null

  const folderMenuItems: AdaptiveMenuEntry[] = [
    ...(!folder.missing
      ? ([
          // History opens the session list. A disconnected environment has no list to open.
          ...(!offline
            ? [
                { kind: 'item' as const, id: 'history', label: t('sidebar.contextMenu.sessionHistory'), icon: Search, onSelect: openHistory },
              ]
            : []),
          // Gated on !missing: with the root gone there is nothing
          // meaningful to point workspace folders at.
          { kind: 'item', id: 'edit-project', label: t('sidebar.contextMenu.editProject'), icon: Pencil, onSelect: () => onEditProject(folder) },
          // Finder can only reveal a path on this machine.
          ...(!remoteProject
            ? [{ kind: 'item' as const, id: 'open-folder', label: t('sidebar.contextMenu.openFolder'), icon: FolderOpen, onSelect: () => window.app.showInFolder(folder.path, '') }]
            : []),
          { kind: 'separator' },
        ] as AdaptiveMenuEntry[])
      : []),
    { kind: 'item', id: 'remove', label: t('sidebar.contextMenu.removeProject'), icon: Trash2, destructive: true, onSelect: () => onRemoveProject(folder) },
  ]

  return (
    <div className={cn(fill && 'flex h-full min-h-0 flex-1 flex-col')}>
      {!sessionsOnly && <ProjectHoverCard
          name={folder.name}
          repoIdentity={repoIdentity}
          repoLookup={repoLookup}
          folders={hoverFolders}
          sessionPaths={sessionPaths}
          offline={offline}
          onEdit={folder.missing ? undefined : () => onEditProject(folder)}
        >
        <AdaptiveContextMenu items={folderMenuItems} contentClassName="w-48">
          <SessionHoverCardTrigger>
          <div
            onClick={() => {
              if (folder.missing || offline) return
              if (historyMode) setHistoryMode(false)
              onToggleExpand(folder.path)
            }}
            onDoubleClick={(event) => {
              if (folder.missing || offline) return
              event.stopPropagation()
              focusProject(folder.path, focusEnvironmentId)
            }}
            className={cn(
              'group flex h-9 items-center overflow-hidden rounded-md pl-2.5 pr-1.5 transition-colors',
              folder.missing || offline ? 'cursor-default opacity-60' : cn('cursor-pointer', sidebarHoverCardRowClass),
            )}
          >
            <SidebarHoverChevron
              expanded={open}
              locked={folder.missing || sessionsLoading || offline}
              glyph={folder.missing
                ? <FolderX className="size-4 shrink-0 text-destructive" />
                : sessionsLoading
                  ? (
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        <Loader2 aria-label={t('common.loading')} className="size-3.5 animate-spin text-sidebar-foreground/70" />
                      </span>
                    )
                  : open
                    ? <FolderOpen className="size-4 shrink-0 text-sidebar-foreground/70" />
                    : <Folder className="size-4 shrink-0 text-sidebar-foreground/70" />
              }
            />
            <span className={cn('ml-2 min-w-0 truncate text-md', folder.missing && 'text-sidebar-foreground/50 line-through')}>{folder.name}</span>
            {!folder.missing && !offline && (
              <div
                data-slot="project-row-actions"
                className={sidebarRowActionsClass}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <IconButton
                  size="sm"
                  variant="nested"
                  tooltip={t('sidebar.contextMenu.searchSessions')}
                  tooltipSideOffset={8}
                  onClick={(e) => {
                    e.stopPropagation()
                    openHistory()
                  }}
                >
                  <Search />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="nested"
                  tooltip={t('tooltips.newAutomation')}
                  tooltipSideOffset={8}
                  onClick={openCreateDialog}
                >
                  <CalendarClock />
                </IconButton>
                <IconButton
                  size="sm"
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
          </SessionHoverCardTrigger>
      </AdaptiveContextMenu>
      </ProjectHoverCard>}

      {/* Everything under the project header sits one step in. A merged repository indents its own children. */}
      <div className={cn(!sessionsOnly && 'pl-1', fill && 'flex h-full min-h-0 flex-col')}>
        {!sessionsOnly && open && projectAutomations.length > 0 && (
          <div className="overflow-hidden">
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

        {!sessionsOnly && open && (
          <MiniAppHostGroup
            hosts={projectHosts}
            onOpen={handleOpenHostApp}
            onStop={handleStopHost}
          />
        )}

        <MorphHeight morphKey={historyMode} fill={fill}>
          {historyMode ? (
            <ProjectHistoryList
              folderPath={folder.path}
              initialSessions={allSessions}
              openingSessionId={openingSessionId}
              onClose={() => setHistoryMode(false)}
              onSwitchSession={switchSessionInPlace}
              onPinSession={onPinSession}
              onSettleSession={onSettleSession}
              onRenameSession={onRenameSession}
              onDeleteSession={onDeleteSession}
            />
          ) : derived.showSessions ? (
            <div className={cn('flex flex-col py-0.5', fill && 'min-h-0 flex-1')}>
              {derived.groupsToShow.length === 0 ? (
                sessionsLoading || sessionsOnly || projectSettled.length > 0 ? null : (
                  <div className="px-2.5 py-1.5 text-[11px] text-sidebar-foreground/70">{t('sidebar.contextMenu.noSessions')}</div>
                )
              ) : (
                <SessionGroupsFrame
                  open={open}
                  fill={fill}
                  hasMore={sessionsHasMore}
                  onLoadMore={onLoadMoreSessions ? () => onLoadMoreSessions(folder.path) : undefined}
                >
                {derived.groupsToShow.map(({ parent, children }) => {
                  const hasChildren = children.length > 0 || (parent.childCount ?? 0) > 0
                  const childrenExpanded = hasChildren && expandedChildrenIds.has(parent.sessionId)
                  const childrenCollapsed = hasChildren && !childrenExpanded
                  const childrenToShow = visibleChildSessions(children, childrenExpanded, derived.isVisibleWhenCollapsed)
                  const parentPresentation = sessionPresentation?.(parent)
                  const childRows = childrenToShow.map((child) => {
                    const childPresentation = sessionPresentation?.(child)
                    return (
                      <SessionRow
                        key={child.sessionId}
                        session={child}
                        folderPath={folder.path}
                        childSession
                        opening={openingSessionId === child.sessionId}
                        onSwitchSession={switchSessionInPlace}
                        onPinSession={onPinSession}
                        onSettleSession={onSettleSession}
                        onRenameSession={onRenameSession}
                        onDeleteSession={onDeleteSession}
                        {...(childPresentation ?? {})}
                        environmentOffline={offline || childPresentation?.environmentOffline}
                      />
                    )
                  })
                  return (
                  <div key={parent.sessionId}>
                    <SessionRow
                      session={parent}
                      folderPath={folder.path}
                      opening={openingSessionId === parent.sessionId}
                      hasChildren={hasChildren}
                      childrenCollapsed={childrenCollapsed}
                      onToggleChildren={hasChildren ? () => {
                        const opening = !expandedChildrenIds.has(parent.sessionId)
                        toggleChildrenExpanded(parent.sessionId)
                        if (opening) void onLoadChildSessions?.(folder.path, parent.sessionId)
                      } : undefined}
                      onSwitchSession={switchSessionInPlace}
                      onPinSession={onPinSession}
                      onSettleSession={onSettleSession}
                      onRenameSession={onRenameSession}
                      onDeleteSession={onDeleteSession}
                      {...(parentPresentation ?? {})}
                      environmentOffline={offline || parentPresentation?.environmentOffline}
                      focusEnvironmentId={focusEnvironmentId}
                    />
                    {childrenExpanded ? (
                      <ActiveSessionList
                        kind="child"
                        hasMore={childSessionsHasMore[parent.sessionId] === true}
                        onLoadMore={() => onLoadMoreChildSessions?.(folder.path, parent.sessionId)}
                      >
                        {childRows}
                      </ActiveSessionList>
                    ) : childRows}
                  </div>
                  )
                })}
                </SessionGroupsFrame>
              )}
            </div>
          ) : null}
        </MorphHeight>
        {open && !historyMode && projectSettled.length > 0 && (
          <div className={cn(fill && 'shrink-0')}>
          <SettledSection
            folderPath={folder.path}
            sessions={projectSettled}
            count={settledCount}
            hasMore={settledHasMore}
            onLoadMore={onLoadMoreSettled ? () => onLoadMoreSettled(folder.path) : undefined}
            openingSessionId={openingSessionId}
            presentation={sessionPresentation}
            onSwitchSession={switchSessionInPlace}
            onPinSession={onPinSession}
            onSettleSession={onSettleSession}
            onRenameSession={onRenameSession}
            onDeleteSession={onDeleteSession}
          />
          </div>
        )}
      </div>

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
