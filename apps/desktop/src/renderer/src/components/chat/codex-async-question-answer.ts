import { useChatStore } from '@/stores/chat'
import { updatePerSession } from '@/stores/chat-store/helpers/store-helpers'
import type { SessionWriteTarget } from '@/stores/chat-store/types'

/** Keep the persisted side-channel reply and the live renderer transcript aligned. */
export async function steerAsyncQuestionAnswer(
  target: SessionWriteTarget,
  replyId: string,
  reply: string,
): Promise<void> {
  // Empty assistant id tells the existing steer endpoint to keep the current message.
  await window.app.codexSteer(target.sessionId, reply, '', replyId, reply)
  useChatStore.setState((state) => updatePerSession(state, target.projectPath, target.sessionId, (session) => ({
    messages: session.messages.some((message) => message.id === replyId)
      ? session.messages
      : [...session.messages, {
          id: replyId,
          role: 'user',
          status: 'complete',
          content: [{ type: 'text', text: reply }],
          createdAt: new Date().toISOString(),
          providerId: 'codex',
        }],
  })))
}
