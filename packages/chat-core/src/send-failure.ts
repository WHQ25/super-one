import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { ChatCoreSession } from './types'

type SendFailedEvent = Extract<AgentEvent, { type: 'user_message_send_failed' }>

function withSendFailure(message: ChatMessage, error: string): ChatMessage {
  return { ...message, metadata: { ...message.metadata, sendFailure: { error } } }
}

/** The composer text a user message was sent from (paste segments included). */
export function userMessageText(message: ChatMessage): string {
  return message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
}

/** Put a sent message's text back in front of whatever has been typed since. */
export function mergeRestoredDraftText(restored: string, typed: string): string {
  return typed.trim() ? `${restored}\n${typed}` : restored
}

/** Drop the failure row before the message is sent again. */
export function withoutSendFailure(message: ChatMessage): ChatMessage {
  if (!message.metadata?.sendFailure) return message
  const { sendFailure: _, ...metadata } = message.metadata
  return { ...message, metadata }
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
    return {
      messages: session.messages.map((m) => (m.id === id ? withSendFailure(m, event.error) : m)),
      // Nothing will answer this send; the pending-reply line must not keep spinning.
      awaitingAssistantReply: false,
    }
  }
  const queued = session.queuedMessages.find((m) => m.id === id)
  if (!queued) return {}
  return {
    queuedMessages: session.queuedMessages.filter((m) => m.id !== id),
    messages: [...session.messages, withSendFailure(queued, event.error)],
  }
}
