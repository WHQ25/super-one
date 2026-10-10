import type { AgentEvent, ChatMessage, ChatMessageContext, ContentBlock, ImageAttachment } from './agent-types'
import { parseInputRequestError } from './input-request'

/** Transport / connectivity failures from remote node RPC, relay, or environment host. */
const TRANSPORT_ERROR_RE =
  /not connected|disconnected|connection replaced|websocket closed|rpc timeout|heartbeat|connection blocked|network offline|connection removed|environment is not connected|failed_precondition/i

/** True when a send failed because the host could not be reached, not because it refused. */
export function isTransportSendError(error: string): boolean {
  return TRANSPORT_ERROR_RE.test(error)
}

/**
 * `Session.send` result for a user message id the host already took (admitted,
 * queued, answered or running): nothing is sent again. A Resend from a stale
 * client lands here instead of running the task twice.
 */
export interface DuplicateSend {
  duplicate: true
}

export function isDuplicateSend(value: unknown): value is DuplicateSend {
  return typeof value === 'object' && value !== null && (value as { duplicate?: unknown }).duplicate === true
}

/**
 * Agent events only the agent itself produces — reply text, tool work, a
 * question to the user — so seeing one proves the input reached it.
 * Lifecycle events a runner emits on its own (`message_start`,
 * `status_change`, `provider_session_id`, setting changes, a `message_error`
 * for a failed start) prove nothing. This is a safety net: the delivery
 * point itself is the runner's explicit input-accepted signal.
 */
const AGENT_OUTPUT_EVENT_TYPES: ReadonlySet<AgentEvent['type']> = new Set<AgentEvent['type']>([
  'content_delta',
  'tool_input_delta',
  'tool_progress',
  'codex_item_delta',
  'codex_item_patch',
  'permission_request',
  'ask_user_question',
  'plan_approval',
  'codex_plan_approval',
  'slash_command_output',
])

/** Whether `event` is output only the agent produces, so its input was delivered. */
export function isAgentOutputEvent(event: AgentEvent): boolean {
  return AGENT_OUTPUT_EVENT_TYPES.has(event.type)
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

export interface FailedMessageResend {
  clientMessageId: string
  content: string
  userMessageContent: ContentBlock[]
  contexts?: ChatMessageContext[]
  images?: ImageAttachment[]
}

/**
 * A failed row sent again from what the transcript kept, for when the original
 * request is gone (a reload, a reconnect). Same id, so the host reuses its row.
 * Null when the row is not a failed send, or its form submission was refused
 * for good (an answered or expired request cannot be resent).
 */
export function failedMessageResend(message: ChatMessage): FailedMessageResend | null {
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
