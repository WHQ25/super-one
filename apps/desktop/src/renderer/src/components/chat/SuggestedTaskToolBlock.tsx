import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { suggestedTaskIdFromResult } from '@superone/shared/suggested-task'
import {
  SuggestedTaskCard,
  type SuggestedTaskActions,
  type SuggestedTaskCardProps,
} from '@superone/chat-view/presenters/SuggestedTaskCard'
import { isRemoteSession, useChatStore } from '@/stores/chat'
import { useSessionScope } from '@/stores/chat-store/session-scope'

type Props = Omit<SuggestedTaskCardProps, 'actions' | 'unavailableReason'> & { result?: string }

/** Desktop host adapter: launch and dismiss run in main, for this pane's local session only. */
export function SuggestedTaskToolBlock({ result, ...props }: Props) {
  const { t } = useTranslation()
  const scope = useSessionScope()
  const projectPath = useChatStore((state) => scope?.projectPath ?? state.activeProject)
  const sessionId = useChatStore((state) => (
    scope?.sessionId ?? (projectPath ? state.projectSessions[projectPath]?._activeSessionId ?? null : null)
  ))
  const local = useChatStore((state) => Boolean(projectPath && sessionId && !isRemoteSession(state, projectPath, sessionId)))
  const taskId = suggestedTaskIdFromResult(result)
  const actions = useMemo<SuggestedTaskActions | undefined>(() => {
    if (!local || !sessionId || !taskId) return undefined
    return {
      launch: async () => {
        const reply = await window.agent.launchSuggestedTask(sessionId, taskId)
        return reply.ok ? undefined : reply.error
      },
      dismiss: async () => {
        const reply = await window.agent.dismissSuggestedTask(sessionId, taskId)
        return reply.ok ? undefined : reply.error
      },
    }
  }, [local, sessionId, taskId])
  return (
    <SuggestedTaskCard
      {...props}
      actions={actions}
      unavailableReason={t('chat.toolBlock.suggestedTask.unavailable')}
    />
  )
}
