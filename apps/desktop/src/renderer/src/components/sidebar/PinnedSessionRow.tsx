import { memo, useCallback } from 'react'
import { Pin } from 'lucide-react'
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

interface PinnedSessionRowProps extends SessionMenuCallbacks {
  session: PinnedSessionEntry
  isActive: boolean
  status: string
  isUnseen: boolean
}

export const PinnedSessionRow = memo(function PinnedSessionRow({
  session,
  isActive,
  status,
  isUnseen,
  onSwitchSession,
  onPinSession,
  onHideSession,
  onRenameSession,
  onDeleteSession,
}: PinnedSessionRowProps) {
  const isRunning = status === 'streaming'
  const readLastEventAt = useCallback(
    () => useChatStore.getState().projectSessions[session.folderPath]?._sessions?.[session.sessionId]?.lastEventAt ?? 0,
    [session.folderPath, session.sessionId],
  )
  const stallLevel = useStallLevel(isRunning, readLastEventAt)
  const titleClassName = cn(
    'text-[13px]',
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

  return (
    <>
      {dragPreview}
      <AdaptiveContextMenu items={menuItems} contentClassName="w-48">
        <div
          ref={rowRef}
          {...dragHandlers}
          onClick={() => onSwitchSession(session.folderPath, session.sessionId)}
          className="group/pin flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 py-1.5 transition-colors hover:bg-sidebar-accent/80"
        >
          {HarnessIcon && (
            <span className="shrink-0">
              <HarnessIcon status={harnessStatus} active={isActive} size={22} renderLevel="compact" />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <SessionTitleAnimated sessionId={session.sessionId} fallback={session.title} className={titleClassName} />
            <span className="min-w-0 truncate text-[11px] text-sidebar-foreground/50">{session.folderName}</span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPinSession(session.sessionId, false, session.folderPath)
            }}
            className="box-content w-0 shrink-0 overflow-hidden rounded p-0.5 text-sidebar-foreground/70 opacity-0 transition-all hover:text-sidebar-accent-foreground group-hover/pin:w-3 group-hover/pin:opacity-100"
          >
            <Pin className="size-3" />
          </button>
        </div>
      </AdaptiveContextMenu>
    </>
  )
})
