import type { ChatMessage, ChatMessageContext, ContentBlock, ImageAttachment } from './agent-types'
import { parseInputRequestError } from './input-request'

/** Transport / connectivity failures from remote node RPC, relay, or environment host. */
const TRANSPORT_ERROR_RE =
  /not connected|disconnected|connection replaced|websocket closed|rpc timeout|heartbeat|connection blocked|network offline|connection removed|environment is not connected|failed_precondition/i

/** True when a send failed because the host could not be reached, not because it refused. */
export function isTransportSendError(error: string): boolean {
  return TRANSPORT_ERROR_RE.test(error)
}

/**
 * `sendSessionMessage` result when the node accepted the message but following its
 * turn broke off (connection lost mid-stream). Not a send failure: reconnect
 * recovery picks the turn back up, and a resend would run it twice.
 */
export interface RemoteSendDetached {
  streamDetached: true
  error: string
}

export function isRemoteSendDetached(value: unknown): value is RemoteSendDetached {
  return typeof value === 'object' && value !== null && (value as { streamDetached?: unknown }).streamDetached === true
}

export function withSendFailure(message: ChatMessage, error: string): ChatMessage {
  return { ...message, metadata: { ...message.metadata, sendFailure: { error } } }
}

/** Drop the failure row before the message is sent again. */
export function withoutSendFailure(message: ChatMessage): ChatMessage {
  if (!message.metadata?.sendFailure) return message
  const { sendFailure: _, ...metadata } = message.metadata
  return { ...message, metadata }
}

/**
 * Whether a reply follows the user message `id`. A reply (including an
 * interrupted or errored one) proves the send reached the agent, so a later
 * error belongs to that reply, not to the user bubble.
 */
export function userMessageAnswered(messages: readonly ChatMessage[], id: string): boolean {
  const index = messages.findIndex((m) => m.id === id)
  if (index === -1) return false
  const nextUserIndex = messages.findIndex((m, i) => i > index && m.role === 'user')
  return messages.some((m, i) => i > index && (nextUserIndex === -1 || i < nextUserIndex) && m.role === 'assistant')
}

/** `messages` with the failure on user row `id`; null when the row is gone or already answered. */
export function markSendFailure(messages: readonly ChatMessage[], id: string, error: string): ChatMessage[] | null {
  if (!messages.some((m) => m.id === id) || userMessageAnswered(messages, id)) return null
  return messages.map((m) => (m.id === id ? withSendFailure(m, error) : m))
}

/**
 * A failed row sent again from what the transcript kept, for when the original
 * request is gone (a reload, a reconnect). Same id, so the host reuses its row.
 * Null when the row is not a failed send, or its form submission was refused
 * for good (an answered or expired request cannot be resent).
 */
export function failedMessageResend(message: ChatMessage): {
  clientMessageId: string
  content: string
  userMessageContent: ContentBlock[]
  contexts?: ChatMessageContext[]
  images?: ImageAttachment[]
} | null {
  const failure = message.metadata?.sendFailure
  if (!failure || parseInputRequestError(failure.error)) return null
  return {
    clientMessageId: message.id,
    content: message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''),
    userMessageContent: message.content,
    ...(message.contexts?.length ? { contexts: message.contexts } : {}),
    ...(message.attachments?.length ? { images: message.attachments } : {}),
  }
}
