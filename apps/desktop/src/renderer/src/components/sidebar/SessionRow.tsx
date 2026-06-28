import { memo, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Bot, Eye, EyeOff, GitFork, Loader2, MessageSquare, Pin, Smartphone } from 'lucide-react'
import { ClaudeSessionIcon } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'
import type { SessionIconProps } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore } from '@/stores/chat'
import { useAppStore, useHasRealProject } from '@/stores/app'
import { useStallLevel, getStallColor } from '@/lib/stall-utils'
import type { SessionForkMode, SessionHistoryEntry } from '@superone/shared/agent-types'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { buildSessionMenuItems } from '@/lib/session-menu-items'
import { getPendingReason } from './session-state-utils'
import { SessionTitleAnimated, useSessionTitleByAgent } from './AnimatedSessionTitle'

const EMPTY_REMOTE_SESSION_IDS: string[] = []

function SessionStatusSpinner({ lastEventAt }: { lastEventAt: number }) {
  const level = useStallLevel(true, lastEventAt)
  return <Loader2 className={cn('size-3 animate-spin', getStallColor(level, 'text-sidebar-foreground/70'))} />
}

function PlainSessionTitle({ sessionId, fallback }: { sessionId: string; fallback: string }) {
  const title = useSessionTitleByAgent(sessionId, fallback)
  return <span className="session-row-title min-w-0 flex-1 truncate text-[13px]">{title}</span>
}

export interface SessionRowCallbacks {
  onSwitchSession: (folderPath: string, sessionId: string) => void
  onPinSession: (sessionId: string, pinned: boolean, folderPath: string) => void
  onHideSession: (sessionId: string, hidden: boolean, folderPath: string) => void
  onRenameSession: (target: { sessionId: string; title: string; folderPath: string }) => void
  onDeleteSession: (target: { sessionId: string; title: string; folderPath: string; provider: 'claude' | 'codex' }) => void
}

interface SessionRowProps extends SessionRowCallbacks {
  session: SessionHistoryEntry
  folderPath: string
  animateTitle?: boolean
}

export const SessionRow = memo(function SessionRow({
  session,
  folderPath,
  animateTitle = true,
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
  const { activeSid, status, lastEventAt, isUnseen, pendingReason } = useChatStore(useShallow((s) => {
    const proj = s.projectSessions[folderPath]
    const entry = proj?._sessions?.[session.sessionId]
    return {
      activeSid: proj?._activeSessionId ?? null,
      status: entry?.status,
      lastEventAt: entry?.lastEventAt ?? 0,
      isUnseen: proj?.unseenCompletedSessions?.has(session.sessionId) ?? false,
      pendingReason: getPendingReason(entry?.pendingPermissions, entry?.pendingQuestion, entry?.pendingPlanApproval),
    }
  }))

  const isProjectActive = hasRealProject && folderPath === currentFolder
  const isRunning = status === 'streaming'
  const isBackground = status === 'background'
  const isSessionActive = isProjectActive && activeSid === session.sessionId
  const harnessStatus: SessionIconProps['status'] = isRunning
    ? 'running'
    : isBackground
      ? 'background'
      : isUnseen
        ? 'unseen'
        : session.isAutomation
          ? 'automation'
          : 'default'
  const HarnessIcon = session.provider === 'codex'
    ? CodexSessionIcon
    : session.provider === 'claude'
      ? ClaudeSessionIcon
      : null

  const handleForkSession = useCallback(async (mode: SessionForkMode) => {
    const toastId = toast.loading(t('sidebar.contextMenu.forkingToast'))
    try {
      const result = await window.app.forkSession({ sessionId: session.sessionId, mode })
      if (result.ok) {
        onSwitchSession(folderPath, result.sessionId)
        toast.success(
          t(mode === 'local' ? 'sidebar.contextMenu.forkedLocalToast' : 'sidebar.contextMenu.forkedToast'),
          { id: toastId },
        )
      } else {
        toast.error(result.error, { id: toastId })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { id: toastId })
    }
  }, [t, onSwitchSession, folderPath, session.sessionId])

  const menuItems = buildSessionMenuItems(session, folderPath, t, {
    onRename: () => onRenameSession({ sessionId: session.sessionId, title: session.title, folderPath }),
    onPin: () => onPinSession(session.sessionId, !session.isPinned, folderPath),
    onHide: () => onHideSession(session.sessionId, !session.isHidden, folderPath),
    onFork: handleForkSession,
    onDelete: () => onDeleteSession({
      sessionId: session.sessionId,
      title: session.title,
      folderPath,
      provider: (session.provider ?? 'claude') as 'claude' | 'codex',
    }),
  })

  const rowInner = (
          <div
            onClick={() => onSwitchSession(folderPath, session.sessionId)}
            className={cn(
              'group/session flex cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2.5 py-1.5 transition-colors',
              isSessionActive ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/80',
              session.isHidden && 'opacity-50',
            )}
          >
            <div className="relative flex shrink-0 items-center justify-center size-3">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onHideSession(session.sessionId, !session.isHidden, folderPath)
                }}
                className="absolute inset-0 flex items-center justify-center rounded text-sidebar-foreground/70 opacity-0 transition-opacity hover:text-sidebar-accent-foreground group-hover/session:opacity-100"
              >
                {session.isHidden ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              </button>
              <span className="pointer-events-none transition-opacity group-hover/session:opacity-0">
                {remoteSessionIds.includes(session.sessionId)
                  ? <Smartphone className="size-3 text-sidebar-foreground/70" />
                  : HarnessIcon && harnessStatus !== 'default'
                    ? <HarnessIcon status={harnessStatus} active={isSessionActive} renderLevel="compact" />
                    : isRunning
                      ? <SessionStatusSpinner lastEventAt={lastEventAt} />
                      : <MessageSquare className="size-3 text-sidebar-foreground/70" />
                }
              </span>
            </div>
            {animateTitle
              ? <SessionTitleAnimated sessionId={session.sessionId} fallback={session.title} className="text-[13px]" />
              : <PlainSessionTitle sessionId={session.sessionId} fallback={session.title} />
            }
            <div className="ml-auto flex shrink-0 items-center">
              {session.isWorktree && (
                <span
                  title="Worktree"
                  className="box-content w-0 overflow-hidden p-0.5 text-sidebar-foreground/70 opacity-0 transition-all group-hover/session:w-3 group-hover/session:opacity-100"
                >
                  <GitFork className="size-3" />
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onPinSession(session.sessionId, !session.isPinned, folderPath)
                }}
                className="box-content w-0 overflow-hidden rounded p-0.5 text-sidebar-foreground/70 opacity-0 transition-all hover:text-sidebar-accent-foreground group-hover/session:w-3 group-hover/session:opacity-100"
              >
                <Pin className="size-3" />
              </button>
            </div>
          </div>
  )

  return (
    <div>
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
