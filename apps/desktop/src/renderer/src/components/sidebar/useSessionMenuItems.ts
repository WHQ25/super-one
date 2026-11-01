import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { HarnessId, SessionForkMode, SessionHistoryEntry } from '@superone/shared/agent-types'
import { chatInputAPI } from '@/components/chat/chat-input-api'
import { buildSessionMenuItems, canSettleSession } from '@/lib/session-menu-items'
import { setSessionRead } from '@/lib/session-client'
import { useChatStore } from '@/stores/chat-store'
import { setUnseenCompleted } from '@/stores/chat-store/helpers/unseen-completed'
import { useRealtimeCallStore } from '@/stores/realtime-call'

export interface SessionMenuCallbacks {
  /**
   * `revealProject: false` marks a click on a row that is already rendered
   * under its project, so switching must not change the project's collapse
   * state. Callers outside a project subtree (pinned list) omit it and get the
   * default reveal.
   */
  onSwitchSession: (folderPath: string, sessionId: string, options?: { revealProject?: boolean }) => void
  onPinSession: (sessionId: string, pinned: boolean, folderPath: string) => void
  onSettleSession: (sessionId: string, settled: boolean, folderPath: string) => void
  onRenameSession: (target: { sessionId: string; title: string; folderPath: string }) => void
  onDeleteSession: (target: { sessionId: string; title: string; folderPath: string; provider: HarnessId }) => void
}

export function useSessionMenuItems(
  session: SessionHistoryEntry,
  folderPath: string,
  callbacks: SessionMenuCallbacks,
) {
  const { t } = useTranslation()
  const unread = useChatStore((s) => s.projectSessions[folderPath]?.unseenCompletedSessions.has(session.sessionId) ?? false)
  const status = useChatStore((s) => s.projectSessions[folderPath]?._sessions?.[session.sessionId]?.status)
  // realtime-call only holds the Codex voice session, so the session id is enough.
  const realtimeVoice = useRealtimeCallStore((s) => (
    s.sessionId === session.sessionId && s.state !== 'idle'
  ))
  const allowSettle = canSettleSession(status, { realtimeVoice, isSettled: session.isSettled === true })

  const handleMarkRead = useCallback(() => {
    useChatStore.setState((s) => setUnseenCompleted(s, folderPath, session.sessionId, !unread))
    void setSessionRead(folderPath, session.sessionId, unread).catch((err) => {
      console.warn('[sidebar] setSessionRead failed:', err)
    })
  }, [folderPath, session.sessionId, unread])

  const handleForkSession = useCallback(async (mode: SessionForkMode) => {
    const toastId = toast.loading(t('sidebar.contextMenu.forkingToast'))
    try {
      const { forkSession } = await import('@/lib/session-client')
      const result = await forkSession(folderPath, { sessionId: session.sessionId, mode })
      if (result.ok) {
        callbacks.onSwitchSession(folderPath, result.sessionId)
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
  }, [callbacks.onSwitchSession, folderPath, session.sessionId, t])

  return buildSessionMenuItems(session, folderPath, t, {
    onRename: () => callbacks.onRenameSession({ sessionId: session.sessionId, title: session.title, folderPath }),
    onPin: () => callbacks.onPinSession(session.sessionId, !session.isPinned, folderPath),
    onMarkRead: handleMarkRead,
    onSettle: () => callbacks.onSettleSession(session.sessionId, !session.isSettled, folderPath),
    onFork: handleForkSession,
    onDelete: () => callbacks.onDeleteSession({
      sessionId: session.sessionId,
      title: session.title,
      folderPath,
      provider: session.provider ?? 'claude',
    }),
    onAddToChat: () => {
      const title = (session.title || 'Untitled').trim()
      chatInputAPI.insertMention?.('session', session.sessionId, title)
    },
  }, { includeTags: false, unread, allowSettle })
}
