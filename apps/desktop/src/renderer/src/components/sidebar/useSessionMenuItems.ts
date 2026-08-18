import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { HarnessId, SessionForkMode, SessionHistoryEntry } from '@superone/shared/agent-types'
import { chatInputAPI } from '@/components/chat/chat-input-api'
import { buildSessionMenuItems } from '@/lib/session-menu-items'

export interface SessionMenuCallbacks {
  onSwitchSession: (folderPath: string, sessionId: string) => void
  onPinSession: (sessionId: string, pinned: boolean, folderPath: string) => void
  onHideSession: (sessionId: string, hidden: boolean, folderPath: string) => void
  onRenameSession: (target: { sessionId: string; title: string; folderPath: string }) => void
  onDeleteSession: (target: { sessionId: string; title: string; folderPath: string; provider: HarnessId }) => void
}

export function useSessionMenuItems(
  session: SessionHistoryEntry,
  folderPath: string,
  callbacks: SessionMenuCallbacks,
) {
  const { t } = useTranslation()

  const handleForkSession = useCallback(async (mode: SessionForkMode) => {
    const toastId = toast.loading(t('sidebar.contextMenu.forkingToast'))
    try {
      const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
      const remote = parseRemoteProjectKey(folderPath)
      const result = remote
        ? await window.environment.forkSession(remote.connectionId, {
            sessionId: session.sessionId,
            mode,
          })
        : await window.app.forkSession({ sessionId: session.sessionId, mode })
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
    onHide: () => callbacks.onHideSession(session.sessionId, !session.isHidden, folderPath),
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
  })
}
