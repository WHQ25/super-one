import { memo } from 'react'
import { Pin } from 'lucide-react'
import { ClaudeSessionIcon, type SessionIconProps } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import { useSessionDragOut } from './useSessionDragOut'
import { SessionTitleAnimated } from './AnimatedSessionTitle'

interface PinnedSessionRowProps {
  session: PinnedSessionEntry
  isActive: boolean
  status: string
  isUnseen: boolean
  onSwitch: (folderPath: string, sessionId: string) => void
  onUnpin: (sessionId: string, pinned: boolean, folderPath: string) => void
}

export const PinnedSessionRow = memo(function PinnedSessionRow({
  session,
  isActive,
  status,
  isUnseen,
  onSwitch,
  onUnpin,
}: PinnedSessionRowProps) {
  const HarnessIcon = session.provider === 'codex'
    ? CodexSessionIcon
    : session.provider === 'claude'
      ? ClaudeSessionIcon
      : null
  const harnessStatus: SessionIconProps['status'] = status === 'streaming'
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

  return (
    <>
      {dragPreview}
      <div
        ref={rowRef}
        {...dragHandlers}
        onClick={() => onSwitch(session.folderPath, session.sessionId)}
        className="group/pin flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 py-1.5 transition-colors hover:bg-sidebar-accent/80"
      >
        {HarnessIcon && (
          <span className="shrink-0">
            <HarnessIcon status={harnessStatus} active={isActive} size={22} renderLevel="compact" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <SessionTitleAnimated sessionId={session.sessionId} fallback={session.title} className="text-[13px]" />
          <span className="min-w-0 truncate text-[11px] text-sidebar-foreground/50">{session.folderName}</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onUnpin(session.sessionId, false, session.folderPath)
          }}
          className="box-content w-0 shrink-0 overflow-hidden rounded p-0.5 text-sidebar-foreground/70 opacity-0 transition-all hover:text-sidebar-accent-foreground group-hover/pin:w-3 group-hover/pin:opacity-100"
        >
          <Pin className="size-3" />
        </button>
      </div>
    </>
  )
})
