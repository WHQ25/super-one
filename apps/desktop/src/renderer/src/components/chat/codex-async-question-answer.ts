import { useChatStore } from '@/stores/chat'
import { updatePerSession } from '@/stores/chat-store/helpers/store-helpers'
import type { SessionWriteTarget } from '@/stores/chat-store/types'
import { codexAsyncAnswerContent } from '@superone/shared/codex-async-question'
import type { CodexAsyncUserInputQuestion } from '@superone/shared/agent-types'

/** Keep the persisted side-channel reply and the live renderer transcript aligned. */
export async function steerAsyncQuestionAnswer(
  target: SessionWriteTarget,
  replyId: string,
  reply: string,
  questions?: CodexAsyncUserInputQuestion[],
): Promise<void> {
  // Empty assistant id tells the existing steer endpoint to keep the current message.
  await window.app.codexSteer(target.sessionId, reply, '', replyId, reply)
  useChatStore.setState((state) => updatePerSession(state, target.projectPath, target.sessionId, (session) => ({
    ...(session.pendingAsyncQuestions ? { pendingAsyncQuestions: session.pendingAsyncQuestions.filter(q => q.request.requestId !== replyId) } : {}),
    messages: session.messages.some((message) => message.id === replyId)
      ? session.messages
      : [...session.messages, {
          id: replyId,
          role: 'user',
          status: 'complete',
          content: questions ? [{ type: 'text', text: reply, codexAsyncQuestions: questions }] : codexAsyncAnswerContent(replyId, reply, session.messages),
          createdAt: new Date().toISOString(),
          providerId: 'codex',
        }],
  })))
}
