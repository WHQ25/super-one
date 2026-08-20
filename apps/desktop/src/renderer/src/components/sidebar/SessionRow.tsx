import { memo, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { Bot, ChevronDown, ChevronRight, CornerDownRight, Eye, EyeOff, Loader2, MessageSquare, Pin, Smartphone } from 'lucide-react'
import type { SessionIconProps } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore } from '@/stores/chat'
import { useAppStore, useHasRealProject } from '@/stores/app'
import { useStallLevel, getStallColor, useEllipsisRepaintKey, type StallLevel } from '@/lib/stall-utils'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { getPendingReason } from './session-state-utils'
import { useSessionDragOut } from './useSessionDragOut'
import { SessionTitleAnimated, useSessionTitleByAgent } from './AnimatedSessionTitle'
import { useSessionMenuItems, type SessionMenuCallbacks } from './useSessionMenuItems'

const EMPTY_REMOTE_SESSION_IDS: string[] = []

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
  return useStallLevel(isRunning, useSessionLastEventAt(folderPath, sessionId))
}

function SessionStatusSpinner({ stallLevel }: { stallLevel: StallLevel }) {
  return <Loader2 className={cn('size-3 animate-spin', getStallColor(stallLevel, 'text-sidebar-foreground/70'))} />
}

function PlainSessionTitle({ sessionId, fallback, className }: { sessionId: string; fallback: string; className?: string }) {
  const title = useSessionTitleByAgent(sessionId, fallback)
  const repaintKey = useEllipsisRepaintKey(className ?? '')
  return (
    <span key={repaintKey} className={cn('session-row-title min-w-0 flex-1 truncate text-[13px]', className)}>
      {title}
    </span>
  )
}

export type SessionRowCallbacks = SessionMenuCallbacks

interface SessionRowProps extends SessionRowCallbacks {
  session: SessionHistoryEntry
  folderPath: string
  animateTitle?: boolean
  childSession?: boolean
  /** Parent rows with nested collab sessions can expose a hover toggle. */
  hasChildren?: boolean
  childrenCollapsed?: boolean
  onToggleChildren?: () => void
}

export const SessionRow = memo(function SessionRow({
  session,
  folderPath,
  animateTitle = true,
  childSession = false,
  hasChildren = false,
  childrenCollapsed = false,
  onToggleChildren,
  onSwitchSession,
  onPinSession,
  onHideSession,
  onRenameSession,
  onDeleteSession,
}: SessionRowProps) {
  const { t } = useTranslation()
  const currentFolder = useAppStore((s) => s.currentFolder)
  const hasRealProject = useHasRealProject()
  const remoteSessionIds = useChatStore((s) => s.remoteSessions[folderPath] ?? EMPTY_REMOTE_SESSION_IDS)
  // Deliberately does NOT select `lastEventAt` — it changes on every content
  // delta; stall level reads it lazily via getState() once per second.
  const { activeSid, status, isUnseen, pendingPermissions, pendingQuestion, pendingPlanApproval } = useChatStore(useShallow((s) => {
    const proj = s.projectSessions[folderPath]
    const entry = proj?._sessions?.[session.sessionId]
    return {
      activeSid: proj?._activeSessionId ?? null,
      status: entry?.status,
      isUnseen: proj?.unseenCompletedSessions?.has(session.sessionId) ?? false,
      pendingPermissions: entry?.pendingPermissions,
      pendingQuestion: entry?.pendingQuestion,
      pendingPlanApproval: entry?.pendingPlanApproval,
    }
  }))
  const pendingReason = getPendingReason(pendingPermissions, pendingQuestion, pendingPlanApproval, t)

  const isProjectActive = hasRealProject && folderPath === currentFolder
  const isRunning = status === 'streaming'
  const isBackground = status === 'background'
  const isSessionActive = isProjectActive && activeSid === session.sessionId
  // Stall color on the title (and fallback spinner) mirrors the chat turn
  // footer: amber after 60s without events, red after 120s. Harness icons no
  // longer carry this signal, so the title is the sidebar indicator.
  const stallLevel = useSessionStallLevel(folderPath, session.sessionId, isRunning)
  const titleClassName = cn(
    'text-[13px]',
    isRunning && 'transition-colors duration-500',
    // Empty normal color → inherit sidebar foreground while streaming is healthy.
    isRunning && getStallColor(stallLevel, ''),
  )
  const harnessStatus: SessionIconProps['status'] = isRunning
    ? 'running'
    : isBackground
      ? 'background'
      : isUnseen
        ? 'unseen'
        : session.isAutomation
          ? 'automation'
          : 'default'
  const HarnessIcon = resolveSessionIcon(session.provider, session.acpAgentId)

  const { rowRef, dragHandlers, dragPreview } = useSessionDragOut({
    folderPath,
    sessionId: session.sessionId,
    title: session.title,
  })

  const menuItems = useSessionMenuItems(session, folderPath, {
    onSwitchSession,
    onPinSession,
    onHideSession,
    onRenameSession,
    onDeleteSession,
  })

  const rowInner = (
          <div
            ref={rowRef}
            {...dragHandlers}
            onClick={() => onSwitchSession(folderPath, session.sessionId)}
            className={cn(
              'group/session flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 py-1.5 transition-colors',
              isSessionActive ? 'bg-sidebar-accent sidebar-selected' : 'hover:bg-sidebar-hover',
              session.isHidden && 'opacity-50',
            )}
          >
            {childSession && <CornerDownRight className="size-3 shrink-0 text-sidebar-foreground/45" />}
            <div className="relative flex size-3 shrink-0 items-center justify-center">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onHideSession(session.sessionId, !session.isHidden, folderPath)
                }}
                className="absolute inset-0 flex items-center justify-center rounded text-sidebar-foreground/70 opacity-0 transition-opacity hover:text-sidebar-foreground group-hover/session:opacity-100"
              >
                {session.isHidden ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              </button>
              <span className="pointer-events-none transition-opacity group-hover/session:opacity-0">
                {remoteSessionIds.includes(session.sessionId)
                  ? <Smartphone className="size-3 text-sidebar-foreground/70" />
                  : HarnessIcon && harnessStatus !== 'default'
                    ? <HarnessIcon status={harnessStatus} active={isSessionActive} renderLevel="compact" />
                    : isRunning
                      ? <SessionStatusSpinner stallLevel={stallLevel} />
                      : <MessageSquare className="size-3 text-sidebar-foreground/70" />
                }
              </span>
            </div>
            {animateTitle
              ? <SessionTitleAnimated sessionId={session.sessionId} fallback={session.title} className={titleClassName} />
              : <PlainSessionTitle sessionId={session.sessionId} fallback={session.title} className={titleClassName} />
            }
            <div className="ml-auto flex shrink-0 items-center">
              {hasChildren && onToggleChildren && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleChildren()
                  }}
                  title={childrenCollapsed ? t('sidebar.contextMenu.expandChildren') : t('sidebar.contextMenu.collapseChildren')}
                  className="box-content w-0 overflow-hidden rounded p-0.5 text-sidebar-foreground/70 opacity-0 transition-all hover:text-sidebar-foreground group-hover/session:w-3 group-hover/session:opacity-100"
                >
                  {childrenCollapsed
                    ? <ChevronRight className="size-3" />
                    : <ChevronDown className="size-3" />}
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onPinSession(session.sessionId, !session.isPinned, folderPath)
                }}
                className="box-content w-0 overflow-hidden rounded p-0.5 text-sidebar-foreground/70 opacity-0 transition-all hover:text-sidebar-foreground group-hover/session:w-3 group-hover/session:opacity-100"
              >
                <Pin className="size-3" />
              </button>
            </div>
          </div>
  )

  return (
    <div>
      {dragPreview}
      <AdaptiveContextMenu items={menuItems} contentClassName="w-48">
        {rowInner}
      </AdaptiveContextMenu>
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
})
