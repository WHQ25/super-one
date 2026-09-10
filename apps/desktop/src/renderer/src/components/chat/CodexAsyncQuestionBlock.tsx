import type { CodexAgentMessageItem } from '@superone/shared/agent-types'
import { codexAsyncAnswerId, codexAsyncReplyText, formatCodexAsyncQuestionReply } from '@superone/shared/codex-async-question'
import { CodexAsyncQuestionForm } from '@superone/chat-view/presenters/CodexAsyncQuestionForm'
import { steerAsyncQuestionAnswer } from './codex-async-question-answer'
import { useActiveSession, useChatStore, useIsRemoteLocked, useSessionScope } from '@/stores/chat'

export { formatCodexAsyncQuestionReply } from '@superone/shared/codex-async-question'

export function CodexAsyncQuestionBlock({ item }: { item: CodexAgentMessageItem }) {
  const scope = useSessionScope()
  const projectPath = useChatStore((state) => scope?.projectPath ?? state.activeProject)
  const sessionId = useActiveSession((session) => scope?.sessionId ?? session._activeSessionId)
  const remoteLocked = useIsRemoteLocked()
  const replyId = codexAsyncAnswerId(item.id)
  const savedReply = useActiveSession((session) => session.messages.find((message) => message.id === replyId))
  return <CodexAsyncQuestionForm key={`${sessionId}:${item.id}`} questions={item.questions ?? []}
    submittedReply={codexAsyncReplyText(savedReply)} disabled={remoteLocked || !sessionId || !projectPath}
    onSubmit={async (answers) => {
      if (!sessionId || !projectPath) throw new Error('No active session')
      await steerAsyncQuestionAnswer({ projectPath, sessionId }, replyId, formatCodexAsyncQuestionReply(item.questions ?? [], answers))
    }} />
}
