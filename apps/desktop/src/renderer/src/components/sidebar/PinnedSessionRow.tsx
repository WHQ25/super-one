import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, MessageSquare, Pin, Unplug } from 'lucide-react'
import type { SessionIconProps } from '@superone/ui/components/harness/ClaudeSessionIcon'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore } from '@/stores/chat'
import { useStallLevel, getStallColor } from '@/lib/stall-utils'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { useSessionDragOut } from './useSessionDragOut'
import { SessionTitleAnimated } from './AnimatedSessionTitle'
import { useSessionMenuItems, type SessionMenuCallbacks } from './useSessionMenuItems'
import { SessionHoverCard, SessionHoverCardTrigger } from './multi-host/SessionHoverCard'
import type { SessionHoverModel } from '@/lib/multi-host/session-hover'

/** Session icons draw their glyph at `size - 2`, so 20 gives an 18px mark beside `text-md` titles. */
const PINNED_ICON_SIZE = 20

const PINNED_ROW_HOVER_ACTION =
  'box-content w-0 shrink-0 overflow-hidden rounded p-0 text-sidebar-foreground/70 opacity-0 hover:text-sidebar-foreground group-hover/pin:w-3 group-hover/pin:p-0.5 group-hover/pin:opacity-100'

interface PinnedSessionRowProps extends SessionMenuCallbacks {
  session: PinnedSessionEntry
  isActive: boolean
  status: string
  isUnseen: boolean
  /** Replaces the glyph in front of the title while this session is opening. */
  opening?: boolean
  hover?: SessionHoverModel | null
  environmentOffline?: boolean
}

export const PinnedSessionRow = memo(function PinnedSessionRow({
  session,
  isActive,
  status,
  isUnseen,
  opening = false,
  hover = null,
  environmentOffline = false,
  onSwitchSession,
  onPinSession,
  onHideSession,
  onRenameSession,
  onDeleteSession,
}: PinnedSessionRowProps) {
  const { t } = useTranslation()
  const isRunning = status === 'streaming'
  const readLastEventAt = useCallback(
    () => useChatStore.getState().projectSessions[session.folderPath]?._sessions?.[session.sessionId]?.lastEventAt ?? 0,
    [session.folderPath, session.sessionId],
  )
  // Not stalled, just a long local slash command emitting nothing — see SessionRow.
  const inSlashCommand = useChatStore(
    (s) => !!s.projectSessions[session.folderPath]?._sessions?.[session.sessionId]?.runningSlashCommand,
  )
  const stallLevel = useStallLevel(isRunning && !inSlashCommand, readLastEventAt)
  const titleClassName = cn(
    'min-w-0 flex-1 text-md',
    isRunning && 'transition-colors duration-500',
    isRunning && getStallColor(stallLevel, ''),
  )
  const HarnessIcon = resolveSessionIcon(session.provider, session.acpAgentId)
  const harnessStatus: SessionIconProps['status'] = isRunning
    ? 'running'
    : status === 'background'
      ? 'background'
      : isUnseen
        ? 'unseen'
        : session.isAutomation
          ? 'automation'
          : 'default'

  const { rowRef, dragHandlers, dragPreview } = useSessionDragOut({
    folderPath: session.folderPath,
    sessionId: session.sessionId,
    title: session.title,
  })
  const menuItems = useSessionMenuItems(session, session.folderPath, {
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
      onClick={() => onSwitchSession(session.folderPath, session.sessionId)}
      className={cn(
        'group/pin flex cursor-pointer items-center gap-2 overflow-hidden rounded-md pl-2.5 pr-2.25 py-1.5 transition-colors',
        isActive ? 'bg-sidebar-accent sidebar-selected' : 'hover:bg-sidebar-hover',
        environmentOffline && 'opacity-50',
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        {opening
          ? <Loader2 aria-label={t('common.loading')} className="size-3.5 animate-spin text-sidebar-foreground/70" />
          : HarnessIcon
            ? <HarnessIcon status={harnessStatus} active={isActive} size={PINNED_ICON_SIZE} renderLevel="compact" />
            : <MessageSquare className="size-3.5 text-sidebar-foreground/70" />}
      </span>
      <SessionTitleAnimated projectPath={session.folderPath} sessionId={session.sessionId} fallback={session.title} className={titleClassName} />
      {!hover && (
        <span className="max-w-[40%] min-w-0 shrink truncate text-[11px] text-sidebar-foreground/50">{session.folderName}</span>
      )}
      {environmentOffline && (
        <Unplug className="size-3 shrink-0 text-sidebar-foreground/70" aria-label={t('sidebar.sessionOffline')} />
      )}
      <div className="ml-auto flex shrink-0 items-center">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPinSession(session.sessionId, false, session.folderPath)
          }}
          className={PINNED_ROW_HOVER_ACTION}
        >
          <Pin className="size-3" />
        </button>
      </div>
    </div>
  )

  const rowMenu = (
    <AdaptiveContextMenu items={menuItems} contentClassName="w-48">
      {hover ? <SessionHoverCardTrigger>{rowInner}</SessionHoverCardTrigger> : rowInner}
    </AdaptiveContextMenu>
  )

  return (
    <>
      {dragPreview}
      {hover ? <SessionHoverCard model={hover}>{rowMenu}</SessionHoverCard> : rowMenu}
    </>
  )
})
