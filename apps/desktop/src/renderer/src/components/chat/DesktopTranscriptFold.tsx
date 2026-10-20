import { useCallback } from 'react'
import { withCodexContents } from '@superone/shared/codex-content'
import type { ProcessFold } from '@superone/shared/agent-types'
import { TranscriptFoldPresenter, type TurnFoldPresenterProps } from '@superone/chat-view/presenters/TranscriptFold'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { useChatStore, useSessionScope } from '@/stores/chat'
import { patchRemoteSession } from '@/stores/chat-store/helpers/remote-reconnect'

/** A remote session's fold: main reads its next page and returns the row, which replaces the one shown. */
export function DesktopTranscriptFold({ fold }: TurnFoldPresenterProps) {
  const scope = useSessionScope()
  const load = useCallback(async (target: ProcessFold) => {
    const state = useChatStore.getState()
    const projectPath = scope?.projectPath ?? state.activeProject
    const remote = projectPath ? parseRemoteProjectKey(projectPath) : null
    const sessionId = scope?.sessionId ?? (projectPath ? state.projectSessions[projectPath]?._activeSessionId : null)
    if (!projectPath || !remote || !sessionId) throw new Error('Remote session unavailable')
    const loaded = await window.environment.loadTranscriptFold(remote.connectionId, { sessionId, messageId: target.messageId, fold: target.key })
    const [row] = withCodexContents([loaded])
    patchRemoteSession(projectPath, sessionId, (session) => {
      const index = session.messages.findIndex((message) => message.id === row.id)
      if (index < 0) return null
      const messages = [...session.messages]
      messages[index] = row
      return { ...session, messages }
    }, useChatStore.setState)
  }, [scope?.projectPath, scope?.sessionId])
  return <TranscriptFoldPresenter fold={fold} load={load} />
}
