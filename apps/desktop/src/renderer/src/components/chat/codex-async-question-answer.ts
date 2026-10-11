import { useChatStore } from '@/stores/chat'
import { callSession } from '@/lib/session-client'
import { updatePerSession } from '@/stores/chat-store/helpers/store-helpers'
import type { SessionWriteTarget } from '@/stores/chat-store/types'
import { codexAsyncAnswerContent, type PendingCodexAsyncQuestion } from '@superone/shared/codex-async-question'

/** Keep the persisted side-channel reply and the live renderer transcript aligned. */
export async function answerAsyncQuestion(
  target: SessionWriteTarget,
  question: PendingCodexAsyncQuestion,
  answers: string[],
): Promise<void> {
  const { reply } = await callSession(target.projectPath, target.sessionId, 'session.answerAsyncQuestion', {
    messageId: question.messageId, itemId: question.item.id, answers,
  })
  const replyId = question.request.requestId
  const questions = question.item.questions
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
