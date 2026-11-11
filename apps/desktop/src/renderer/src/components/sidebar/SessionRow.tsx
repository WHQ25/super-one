import { memo, useCallback, useEffect, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, ChevronRight, CircleCheck, Clock, CornerDownRight, Laptop, Loader2, MessageSquare, Mic, Pin, Smartphone, Undo2, Unplug } from 'lucide-react'
import type { SessionIconProps } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { MarqueeText } from '@superone/ui/components/ui/marquee-text'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore } from '@/stores/chat'
import { useAppStore, useHasRealProject } from '@/stores/app'
import { useRealtimeCallStore } from '@/stores/realtime-call'
import { REALTIME_VOICE_GLYPH_SCALE } from '@/lib/realtime-voice-visuals'
import { armedSendFor, useScheduledSendsStore } from '@/stores/scheduled-sends'
import { formatSendWhen } from '@/components/chat/scheduled-send-time'
import { remoteControllerBadgeText } from '@/components/chat/RemoteControllerBanner'
import { useStallLevel, getStallColor, useEllipsisRepaintKey, type StallLevel } from '@/lib/stall-utils'
import type { AgentStatus, SessionHistoryEntry } from '@superone/shared/agent-types'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { getPendingReason } from './session-state-utils'
import { useSessionDragOut } from './useSessionDragOut'
import { SessionTitleAnimated } from './AnimatedSessionTitle'
import { useSessionTitle } from '@/hooks/useSessionTitle'
import { canSettleSession } from '@/lib/session-menu-items'
import { useSpawnChildTurnOpen } from '@/lib/spawn-child-turn'
import { focusSession } from './sidebar-focus'
import { useSessionMenuItems, type SessionMenuCallbacks } from './useSessionMenuItems'
import { commitPerSession } from '@/stores/chat-store/helpers/store-helpers'
import type { ProjectState } from '@/stores/chat-store/types'
import { SessionHoverCard, SessionHoverCardTrigger, sidebarHoverCardRowClass } from './multi-host/SessionHoverCard'
import type { SessionHoverModel } from '@/lib/multi-host/session-hover'

const EMPTY_REMOTE_SESSION_IDS: string[] = []

/** Pin, unsettle, and expand occupy no width at rest. Padding lands on hover. */
const SESSION_ROW_HOVER_ACTION =
  'box-content w-0 shrink-0 overflow-hidden rounded p-0 text-sidebar-foreground/70 opacity-0 hover:text-sidebar-foreground group-hover/session:w-3 group-hover/session:p-0.5 group-hover/session:opacity-100'

/** Lazy `lastEventAt` reader — never subscribe; the store rewrites it on every
 *  content delta and a subscription would re-render the whole session list at
 *  stream frequency. Stall level only needs a 1 Hz sample. */
function useSessionLastEventAt(folderPath: string, sessionId: string): () => number {
  return useCallback(
    () => useChatStore.getState().projectSessions[folderPath]?._sessions?.[sessionId]?.lastEventAt ?? 0,
    [folderPath, sessionId],
  )
}

function useSessionStallLevel(folderPath: string, sessionId: string, isRunning: boolean): StallLevel {
  // A local slash command (/code-review) runs for minutes without emitting a
  // single event, which the stall heuristic would read as a hang and paint
  // amber then red. It is not stalled — suspend the check while it runs.
  const inSlashCommand = useChatStore(
    (s) => !!s.projectSessions[folderPath]?._sessions?.[sessionId]?.runningSlashCommand,
  )
  return useStallLevel(isRunning && !inSlashCommand, useSessionLastEventAt(folderPath, sessionId))
}

function SessionStatusSpinner({ stallLevel }: { stallLevel: StallLevel }) {
  return <Loader2 className={cn('size-3 animate-spin', getStallColor(stallLevel, 'text-sidebar-foreground/70'))} />
}

function sessionRowStoreSlice(state: { projectSessions: Record<string, ProjectState> }, folderPath: string, sessionId: string) {
  const proj = state.projectSessions[folderPath]
  const entry = proj?._sessions?.[sessionId]
  return {
    activeSid: proj?._activeSessionId ?? null,
    status: entry?.status,
    isUnseen: proj?.unseenCompletedSessions?.has(sessionId) ?? false,
    pendingPermissions: entry?.pendingPermissions,
    pendingQuestion: entry?.pendingQuestion,
    pendingPlanApproval: entry?.pendingPlanApproval,
    animateInitialTitle: entry?._animateInitialTitle ?? false,
  }
}

function sessionRowViewModel(input: {
  hasRealProject: boolean
  folderPath: string
  currentFolder: string | null
  provider: SessionHistoryEntry['provider']
  realtimeSessionId: string | null
  realtimeState: string
  sessionId: string
  activeSid: string | null
  status: AgentStatus | undefined
  isUnseen: boolean
  isAutomation: boolean | undefined
  stallLevel: StallLevel
  isSettled: boolean | undefined
  opening: boolean
  childTurnOpen: boolean
}) {
  const isProjectActive = input.hasRealProject && input.folderPath === input.currentFolder
  const isRealtimeVoiceSession = input.provider === 'codex'
    && input.realtimeSessionId === input.sessionId
    && input.realtimeState !== 'idle'
  const isRunning = input.status === 'streaming'
  const isBackground = input.status === 'background'
  return {
    isRealtimeVoiceSession,
    isRunning,
    isSessionActive: isProjectActive && input.activeSid === input.sessionId,
    titleClassName: cn(
      'text-[13px]',
      isRunning && 'transition-colors duration-500',
      isRunning && getStallColor(input.stallLevel, ''),
    ),
    harnessStatus: harnessGlyphStatus({
      isRunning,
      isBackground,
      isUnseen: input.isUnseen,
      isAutomation: input.isAutomation,
    }),
    settled: input.isSettled === true,
    showLeadingSettle: !input.opening && input.isSettled !== true && canSettleSession(input.status, {
      realtimeVoice: isRealtimeVoiceSession,
      childTurnOpen: input.childTurnOpen,
    }),
  }
}

function harnessGlyphStatus(input: {
  isRunning: boolean
  isBackground: boolean
  isUnseen: boolean
  isAutomation: boolean | undefined
}): SessionIconProps['status'] {
  if (input.isRunning) return 'running'
  if (input.isBackground) return 'background'
  if (input.isUnseen) return 'unseen'
  if (input.isAutomation) return 'automation'
  return 'default'
}

function sessionLeadingGlyph({
  opening,
  loadingLabel,
  scheduledLabel,
  voice,
  HarnessIcon,
  isSessionActive,
  voiceGlyph,
  remote,
  harnessStatus,
  isRunning,
  stallLevel,
}: {
  opening: boolean
  loadingLabel: string
  scheduledLabel: string | null
  voice: boolean
  HarnessIcon: ReturnType<typeof resolveSessionIcon>
  isSessionActive: boolean
  voiceGlyph: ReactNode
  remote: boolean
  harnessStatus: SessionIconProps['status']
  isRunning: boolean
  stallLevel: StallLevel
}) {
  if (opening) return <Loader2 aria-label={loadingLabel} className="size-3 animate-spin text-sidebar-foreground/70" />
  if (scheduledLabel) return <Clock className="size-3 text-warning" aria-label={scheduledLabel} />
  if (voice && HarnessIcon) {
    return <HarnessIcon status="running" active={isSessionActive} renderLevel="compact" runningGlyph={voiceGlyph} />
  }
  if (remote) return <Smartphone className="size-3 text-sidebar-foreground/70" />
  if (HarnessIcon && harnessStatus !== 'default') {
    return <HarnessIcon status={harnessStatus} active={isSessionActive} renderLevel="compact" />
  }
  if (isRunning) return <SessionStatusSpinner stallLevel={stallLevel} />
  return <MessageSquare className="size-3 text-sidebar-foreground/70" />
}

function PlainSessionTitle({ projectPath, sessionId, fallback, className }: { projectPath: string; sessionId: string; fallback: string; className?: string }) {
  const title = useSessionTitle(projectPath, sessionId, fallback)
  const repaintKey = useEllipsisRepaintKey(className ?? '')
  return (
    <MarqueeText key={repaintKey} className={cn('session-row-title min-w-0 flex-1 text-[13px]', className)}>
      {title}
    </MarqueeText>
  )
}

function SessionRowTrailing({
  settled,
  pinned,
  hasChildren,
  childrenCollapsed,
  remoteLabel,
  onToggleChildren,
  onPin,
  onUnsettle,
}: {
  settled: boolean
  pinned: boolean
  hasChildren: boolean
  childrenCollapsed: boolean
  remoteLabel?: string
  onToggleChildren?: () => void
  onPin: () => void
  onUnsettle: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="ml-auto flex shrink-0 items-center" onDoubleClick={(event) => event.stopPropagation()}>
      {/* Why this row is at the top of the list. Always visible — the
          hover-revealed pin, unsettle, and expand buttons beside it are
          actions, this is a state, and a state the user cannot see
          explains nothing. */}
      {remoteLabel !== undefined && (
        <span
          className="mr-1 inline-flex max-w-24 min-w-0 items-center gap-1 rounded bg-sidebar-foreground/10 px-1 py-px text-[10px] text-sidebar-foreground/70"
          title={remoteControllerBadgeText(t, remoteLabel)}
          aria-label={remoteControllerBadgeText(t, remoteLabel)}
        >
          <Laptop className="size-2.5 shrink-0" />
          {remoteLabel && <span className="truncate">{remoteLabel}</span>}
        </span>
      )}
      {hasChildren && onToggleChildren && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleChildren()
          }}
          title={childrenCollapsed ? t('sidebar.contextMenu.expandChildren') : t('sidebar.contextMenu.collapseChildren')}
          className={SESSION_ROW_HOVER_ACTION}
        >
          {childrenCollapsed
            ? <ChevronRight className="size-3" />
            : <ChevronDown className="size-3" />}
        </button>
      )}
      {settled ? (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onUnsettle()
          }}
          aria-label={t('sidebar.contextMenu.unsettle')}
          className={SESSION_ROW_HOVER_ACTION}
        >
          <Undo2 className="size-3" />
        </button>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPin()
          }}
          aria-label={pinned ? t('sidebar.contextMenu.unpin') : t('sidebar.contextMenu.pin')}
          className={SESSION_ROW_HOVER_ACTION}
        >
          <Pin className="size-3" />
        </button>
      )}
    </div>
  )
}

export type SessionRowCallbacks = SessionMenuCallbacks

interface SessionRowProps extends SessionRowCallbacks {
  session: SessionHistoryEntry
  folderPath: string
  /** Replaces the glyph in front of the title while this session is opening. */
  opening?: boolean
  animateTitle?: boolean
  childSession?: boolean
  /** Parent rows with nested collab sessions can expose a hover toggle. */
  hasChildren?: boolean
  childrenCollapsed?: boolean
  onToggleChildren?: () => void
  /** Built from the session list. Absent on the single-host sidebar. */
  hover?: SessionHoverModel | null
  /** The session's environment is offline. Dims the row; no extra request. */
  environmentOffline?: boolean
  /** Passed through so focus can step back to this environment. Omitted inherits. */
  focusEnvironmentId?: string | null
}

export const SessionRow = memo(function SessionRow({
  session,
  folderPath,
  opening = false,
  animateTitle = true,
  childSession = false,
  hasChildren = false,
  childrenCollapsed = false,
  onToggleChildren,
  hover = null,
  environmentOffline = false,
  focusEnvironmentId,
  onSwitchSession,
  onPinSession,
  onSettleSession,
  onRenameSession,
  onDeleteSession,
}: SessionRowProps) {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const hasRealProject = useHasRealProject()
  const realtimeCall = useRealtimeCallStore(useShallow((s) => ({
    sessionId: s.sessionId,
    state: s.state,
  })))
  const remoteSessionIds = useChatStore((s) => s.remoteSessions[folderPath] ?? EMPTY_REMOTE_SESSION_IDS)
  // Deliberately does NOT select `lastEventAt` — it changes on every content
  // delta; stall level reads it lazily via getState() once per second.
  const { activeSid, status, isUnseen, pendingPermissions, pendingQuestion, pendingPlanApproval, animateInitialTitle } = useChatStore(useShallow((s) => (
    sessionRowStoreSlice(s, folderPath, session.sessionId)
  )))
  useEffect(() => {
    if (!animateTitle || !animateInitialTitle) return
    useChatStore.setState((state) => {
      if (!state.projectSessions[folderPath]?._sessions[session.sessionId]?._animateInitialTitle) return state
      return commitPerSession(state,
        { projectPath: folderPath, sessionId: session.sessionId }, () => ({ _animateInitialTitle: false }))
    })
  }, [animateTitle, animateInitialTitle, folderPath, session.sessionId])
  const pendingReason = getPendingReason(pendingPermissions, pendingQuestion, pendingPlanApproval, t)
  const isRunning = status === 'streaming'
  // Stall color on the title (and fallback spinner) mirrors the chat turn
  // footer: amber after 60s without events, red after 120s. Harness icons no
  // longer carry this signal, so the title is the sidebar indicator.
  const stallLevel = useSessionStallLevel(folderPath, session.sessionId, isRunning)
  const childTurnOpen = useSpawnChildTurnOpen(folderPath, session.sessionId)
  const view = sessionRowViewModel({
    hasRealProject,
    folderPath,
    currentFolder,
    provider: session.provider,
    realtimeSessionId: realtimeCall.sessionId,
    realtimeState: realtimeCall.state,
    sessionId: session.sessionId,
    activeSid,
    status,
    isUnseen,
    isAutomation: session.isAutomation,
    stallLevel,
    isSettled: session.isSettled,
    opening,
    childTurnOpen,
  })
  const HarnessIcon = resolveSessionIcon(session.provider, session.acpAgentId)
  const scheduled = useScheduledSendsStore((s) => armedSendFor(s.bySession, session.sessionId))
  const scheduledLabel = scheduled
    ? t('sidebar.scheduledFor', { time: formatSendWhen(scheduled.sendAt, Date.now()) })
    : null
  const voiceGlyph = view.isRealtimeVoiceSession
    ? <Mic
        strokeWidth={2}
        className="text-white"
        style={{
          width: `${REALTIME_VOICE_GLYPH_SCALE * 100}%`,
          height: `${REALTIME_VOICE_GLYPH_SCALE * 100}%`,
        }}
        aria-hidden
      />
    : undefined

  const { rowRef, dragHandlers, dragPreview } = useSessionDragOut({
    folderPath,
    sessionId: session.sessionId,
    title: session.title,
  })

  const menuItems = useSessionMenuItems(session, folderPath, {
    onSwitchSession,
    onPinSession,
    onSettleSession,
    onRenameSession,
    onDeleteSession,
  })
  const onDrill = hasChildren
    ? () => focusSession(folderPath, session.sessionId, focusEnvironmentId)
    : undefined

  return (
    <SessionRowFrame
      session={session}
      folderPath={folderPath}
      opening={opening}
      animateTitle={animateTitle}
      childSession={childSession}
      hasChildren={hasChildren}
      childrenCollapsed={childrenCollapsed}
      onToggleChildren={onToggleChildren}
      hover={hover}
      environmentOffline={environmentOffline}
      onSwitchSession={onSwitchSession}
      onPinSession={onPinSession}
      onSettleSession={onSettleSession}
      rowRef={rowRef}
      dragHandlers={dragHandlers}
      dragPreview={dragPreview}
      pendingReason={pendingReason}
      animateInitialTitle={animateInitialTitle}
      view={view}
      HarnessIcon={HarnessIcon}
      scheduledLabel={scheduledLabel}
      voiceGlyph={voiceGlyph}
      remote={remoteSessionIds.includes(session.sessionId)}
      stallLevel={stallLevel}
      menuItems={menuItems}
      onDrill={onDrill}
      settleLabel={t('sidebar.contextMenu.settle')}
      loadingLabel={t('common.loading')}
      offlineLabel={t('sidebar.sessionOffline')}
    />
  )
})

function SessionRowFrame({
  session,
  folderPath,
  opening,
  animateTitle,
  childSession,
  hasChildren,
  childrenCollapsed,
  onToggleChildren,
  hover,
  environmentOffline,
  onSwitchSession,
  onPinSession,
  onSettleSession,
  rowRef,
  dragHandlers,
  dragPreview,
  pendingReason,
  animateInitialTitle,
  view,
  HarnessIcon,
  scheduledLabel,
  voiceGlyph,
  remote,
  stallLevel,
  menuItems,
  onDrill,
  settleLabel,
  loadingLabel,
  offlineLabel,
}: {
  session: SessionHistoryEntry
  folderPath: string
  opening: boolean
  animateTitle: boolean
  childSession: boolean
  hasChildren: boolean
  childrenCollapsed: boolean
  onToggleChildren?: () => void
  hover: SessionHoverModel | null
  environmentOffline: boolean
  onSwitchSession: SessionRowCallbacks['onSwitchSession']
  onPinSession: SessionRowCallbacks['onPinSession']
  onSettleSession: SessionRowCallbacks['onSettleSession']
  rowRef: ReturnType<typeof useSessionDragOut>['rowRef']
  dragHandlers: ReturnType<typeof useSessionDragOut>['dragHandlers']
  dragPreview: ReturnType<typeof useSessionDragOut>['dragPreview']
  pendingReason: string | null
  animateInitialTitle: boolean
  view: ReturnType<typeof sessionRowViewModel>
  HarnessIcon: ReturnType<typeof resolveSessionIcon>
  scheduledLabel: string | null
  voiceGlyph: ReactNode
  remote: boolean
  stallLevel: StallLevel
  menuItems: ReturnType<typeof useSessionMenuItems>
  onDrill?: () => void
  settleLabel: string
  loadingLabel: string
  offlineLabel: string
}) {
  const rowInner = (
          <div
            ref={rowRef}
            {...dragHandlers}
            onClick={() => onSwitchSession(folderPath, session.sessionId)}
            onDoubleClick={onDrill ? (event) => {
              event.stopPropagation()
              onDrill()
            } : undefined}
            className={cn(
              'group/session flex cursor-pointer items-center gap-2 overflow-hidden rounded-md pl-2.5 pr-2.25 py-1.5 transition-colors',
              view.isSessionActive ? 'bg-sidebar-accent sidebar-selected' : sidebarHoverCardRowClass,
              (session.isHidden || environmentOffline) && 'opacity-50',
            )}
          >
            {childSession && <CornerDownRight className="size-3 shrink-0 text-sidebar-foreground/45" />}
            <div className="relative flex size-4 shrink-0 items-center justify-center">
              {view.showLeadingSettle && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onSettleSession(session.sessionId, true, folderPath)
                  }}
                  aria-label={settleLabel}
                  className="absolute inset-0 flex items-center justify-center rounded text-sidebar-foreground/70 opacity-0 hover:text-sidebar-foreground group-hover/session:opacity-100"
                >
                  <CircleCheck className="size-3" />
                </button>
              )}
              <span className={cn('pointer-events-none', view.showLeadingSettle && 'group-hover/session:opacity-0')}>
                {sessionLeadingGlyph({
                  opening,
                  loadingLabel,
                  scheduledLabel,
                  voice: view.isRealtimeVoiceSession,
                  HarnessIcon,
                  isSessionActive: view.isSessionActive,
                  voiceGlyph,
                  remote,
                  harnessStatus: view.harnessStatus,
                  isRunning: view.isRunning,
                  stallLevel,
                })}
              </span>
            </div>
            {animateTitle
              ? <SessionTitleAnimated projectPath={folderPath} sessionId={session.sessionId} fallback={session.title} className={cn('min-w-0 flex-1', view.titleClassName)} animateOnMount={animateInitialTitle} />
              : <PlainSessionTitle projectPath={folderPath} sessionId={session.sessionId} fallback={session.title} className={view.titleClassName} />
            }
            {environmentOffline && (
              <Unplug className="size-3 shrink-0 text-sidebar-foreground/70" aria-label={offlineLabel} />
            )}
            <SessionRowTrailing
              settled={view.settled}
              pinned={session.isPinned === true}
              hasChildren={hasChildren}
              childrenCollapsed={childrenCollapsed}
              remoteLabel={session.remoteController ? (session.remoteController.label ?? '') : undefined}
              onToggleChildren={onToggleChildren}
              onPin={() => onPinSession(session.sessionId, !session.isPinned, folderPath)}
              onUnsettle={() => onSettleSession(session.sessionId, false, folderPath)}
            />
          </div>
  )

  const rowMenu = (
    <AdaptiveContextMenu items={menuItems} contentClassName="w-48">
      {hover ? <SessionHoverCardTrigger>{rowInner}</SessionHoverCardTrigger> : rowInner}
    </AdaptiveContextMenu>
  )

  return (
    <div>
      {dragPreview}
      {hover ? <SessionHoverCard model={hover}>{rowMenu}</SessionHoverCard> : rowMenu}
      {pendingReason && (
        <div
          onClick={() => onSwitchSession(folderPath, session.sessionId)}
          className="ml-2.5 mr-1 mt-0.5 flex cursor-pointer items-center gap-1 rounded-md bg-green-500/15 px-2 py-1"
        >
          <Bot className="size-3 shrink-0 text-green-600 dark:text-green-400" />
          <span className="min-w-0 truncate text-[11px] text-green-600 dark:text-green-400">{pendingReason}</span>
        </div>
      )}
    </div>
  )
}
