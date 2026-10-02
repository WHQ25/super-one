import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { MCP_RESOURCE_REMINDER_REGEX } from '@superone/shared/mcp-app-mentions'
import type { ChatCoreSession } from './types'

type SendFailedEvent = Extract<AgentEvent, { type: 'user_message_send_failed' }>

function withSendFailure(message: ChatMessage, error: string): ChatMessage {
  return { ...message, metadata: { ...message.metadata, sendFailure: { error } } }
}

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
  const messageIndex = session.messages.findIndex((m) => m.id === id)
  if (messageIndex !== -1) {
    // A reply (including an interrupted or errored one) proves the send reached
    // the agent. A late host error belongs to that reply, not this user bubble.
    const nextUserIndex = session.messages.findIndex((m, index) => index > messageIndex && m.role === 'user')
    if (session.messages.some((m, index) => index > messageIndex
      && (nextUserIndex === -1 || index < nextUserIndex) && m.role === 'assistant')) return {}
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
