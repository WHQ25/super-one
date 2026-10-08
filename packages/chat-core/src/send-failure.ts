import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { MCP_RESOURCE_REMINDER_REGEX } from '@superone/shared/mcp-app-mentions'
import { markSendFailure, withSendFailure, withoutSendFailure } from '@superone/shared/send-failure'
import type { ChatCoreSession } from './types'

export { failedMessageResend, markSendFailure, userMessageAnswered, withoutSendFailure } from '@superone/shared/send-failure'

type SendFailedEvent = Extract<AgentEvent, { type: 'user_message_send_failed' }>
type SendRetriedEvent = Extract<AgentEvent, { type: 'user_message_send_retried' }>

/**
 * The composer text a user message was sent from (paste segments included). The
 * stored copy of mentioned MCP resources is what the host read, not what was typed.
 */
export function userMessageText(message: ChatMessage): string {
  return message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').replace(MCP_RESOURCE_REMINDER_REGEX, '')
}

/** Put a sent message's text back in front of whatever has been typed since. */
export function mergeRestoredDraftText(restored: string, typed: string): string {
  return typed.trim() ? `${restored}\n${typed}` : restored
}

/**
 * Keep a send the host never took visible, with its failure, instead of losing it.
 * A queued send moves into the transcript: the queue only holds work still due to run.
 */
export function reduceUserMessageSendFailed(
  session: ChatCoreSession,
  event: SendFailedEvent,
): Partial<ChatCoreSession> {
  const id = event.clientMessageId
  if (session.messages.some((m) => m.id === id)) {
    const messages = markSendFailure(session.messages, id, event.error)
    // Nothing will answer this send; the pending-reply line must not keep spinning.
    return messages ? { messages, awaitingAssistantReply: false } : {}
  }
  const queued = session.queuedMessages.find((m) => m.id === id)
  if (!queued) return {}
  return {
    queuedMessages: session.queuedMessages.filter((m) => m.id !== id),
    messages: [...session.messages, withSendFailure(queued, event.error)],
  }
}

/** Another client's Resend went through: this client's copy of the row is no longer failed. */
export function reduceUserMessageSendRetried(
  session: ChatCoreSession,
  event: SendRetriedEvent,
): Partial<ChatCoreSession> {
  const failed = session.messages.find((m) => m.id === event.clientMessageId && m.metadata?.sendFailure)
  if (!failed) return {}
  return { messages: session.messages.map((m) => (m === failed ? withoutSendFailure(m) : m)) }
}
