import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { compactChatCoreState } from '@superone/chat-core'
import { SESSION_DURABLE_EVENT } from '@superone/shared/environment'
import { agentEventCoalesceKey, coalesceAgentEventBatch } from '@superone/shared/agent-event-batcher'
import type { DetailUpdate } from '@superone/shared/environment/detail'
import type { EnvironmentEventEnvelope, SessionLoadResult, SessionStreamFrame } from '@superone/shared/environment'
import type { ConnectionDelivery } from '../stream/delivery/connection-delivery'
import { detailMessageId } from '../stream/delivery/projection'
import { summarizesTranscripts } from '../stream/delivery-policy'
import type { SessionHostPort } from './rpc-context'

/**
 * What one node connection receives of its sessions, under the connection's
 * delivery policy (`ConnectionDelivery`): a session it loads over the relay
 * comes summarized, with bodies behind `remoteDetail`; its live events are
 * projected and shaped the same way; rows it expands get detail packets as
 * the session changes. Persisted transcripts and the event log stay complete.
 */

type Messages = Pick<SessionHostPort, 'messages'>

/** A load or history page as this connection receives it; loading over a summarizing link summarizes the session. */
export function deliverLoad(result: SessionLoadResult, delivery: ConnectionDelivery | undefined): SessionLoadResult {
  if (!delivery) return result
  if (summarizesTranscripts(delivery.policy) && !delivery.views.has(result.sessionId)) delivery.views.open(result.sessionId, true)
  const messages = delivery.messages(result.messages, result.sessionId)
  const activeTurn = result.activeTurn && delivery.messages(result.activeTurn, result.sessionId)
  const state = { ...result.state }
  if (Array.isArray(state.queuedMessages)) {
    const queued = delivery.shape({ type: 'queued_messages_changed', sessionId: result.sessionId, messages: state.queuedMessages } as AgentEvent).find(event => event.type === 'queued_messages_changed')
    if (queued?.type === 'queued_messages_changed') state.queuedMessages = queued.messages
  }
  if (Array.isArray(state.pendingPermissions)) {
    state.pendingPermissions = state.pendingPermissions.map(request => delivery.shape({ type: 'permission_request', sessionId: result.sessionId, request } as AgentEvent).find(event => event.type === 'permission_request')).flatMap(event => event?.type === 'permission_request' ? [event.request] : [])
  }
  const delivered = { ...result, state: delivery.policy.surface === 'phone' ? compactChatCoreState(state) : state,
    messages, ...(activeTurn ? { activeTurn } : {}) }
  return delivery.views.has(result.sessionId) ? { ...delivered, summarized: true } : delivered
}

/**
 * A stream frame as this connection receives it, and the detail packets the
 * frame's sessions changed. An event the policy drops leaves no envelope; the
 * frame's cursor still covers it. Adjacent additive deltas of one session fold
 * into the later envelope, whose `sessionVersion` covers both.
 */
export function deliverFrame(
  frame: SessionStreamFrame,
  delivery: ConnectionDelivery,
  sessions: Messages,
): { frame: SessionStreamFrame; details: Array<{ sessionId: string; update: DetailUpdate }> } {
  const changed = new Set<string>()
  const events = frame.events.flatMap((envelope): EnvironmentEventEnvelope[] => {
    const event = agentEventOf(envelope, sessions)
    if (!event) return [envelope]
    const sessionId = envelope.aggregateId
    const summarized = delivery.views.has(sessionId)
    if (summarized) changed.add(sessionId)
    const shaped = delivery.event(event, sessionId, summarized ? sessions.messages(sessionId) : [])
    return shaped.map((next) => ({ ...envelope, eventType: SESSION_DURABLE_EVENT.agentEvent,
      payload: envelope.eventType === SESSION_DURABLE_EVENT.userMessage ? { event: next } : { ...(envelope.payload as object), event: next } }))
  })
  const details = [...changed].flatMap((sessionId) =>
    delivery.details(sessionId, sessions.messages(sessionId)).flatMap((event) =>
      event.type === 'remote_detail'
        ? [{ sessionId, update: { subscriptionId: event.subscriptionId, revision: event.revision, offset: event.offset, text: event.text } }]
        : []))
  return { frame: { ...frame, events: foldDeltas(events) }, details }
}

function foldDeltas(envelopes: EnvironmentEventEnvelope[]): EnvironmentEventEnvelope[] {
  const out: EnvironmentEventEnvelope[] = []
  for (const envelope of envelopes) {
    const prev = out.at(-1)
    const prevEvent = prev && agentEventOf(prev)
    const event = agentEventOf(envelope)
    const key = event && envelope.ephemeral && agentEventCoalesceKey(event)
    if (key && prevEvent && prev.ephemeral && prev.aggregateId === envelope.aggregateId && agentEventCoalesceKey(prevEvent) === key) {
      const folded = coalesceAgentEventBatch([prevEvent, event])
      if (folded.length === 1) {
        out[out.length - 1] = { ...envelope, payload: { ...(envelope.payload as object), event: folded[0] } }
        continue
      }
    }
    out.push(envelope)
  }
  return out
}

/** Expand one row of a session this connection loaded summarized: its revision-0 detail. */
export function subscribeDetail(
  delivery: ConnectionDelivery,
  sessions: Messages,
  input: { sessionId: string; detailRef: string; subscriptionId: string },
): DetailUpdate {
  let messageId: string
  try {
    messageId = detailMessageId(input.detailRef)
  } catch (err) {
    throw Object.assign(err as Error, { code: 'invalid_argument' })
  }
  const message = sessions.messages(input.sessionId).find((candidate) => candidate.id === messageId)
  if (!message) throw Object.assign(new Error('Detail not found'), { code: 'not_found' })
  try {
    return delivery.views.subscribe(input.sessionId, input.subscriptionId, input.detailRef, message)
  } catch (err) {
    throw Object.assign(err as Error, { code: 'failed_precondition' })
  }
}

function agentEventOf(envelope: EnvironmentEventEnvelope, sessions?: Messages): AgentEvent | undefined {
  if (envelope.aggregateType !== 'session') return undefined
  if (envelope.eventType === SESSION_DURABLE_EVENT.userMessage && sessions) {
    const payload = envelope.payload as { message?: ChatMessage; blockId?: string } | null
    const original = payload?.message
    const message = original?.role === 'user' && typeof original.id === 'string' && Array.isArray(original.content)
      ? original : sessions.messages(envelope.aggregateId).find(row => row.id === payload?.blockId)
    if (message) return { type: 'user_message_appended', sessionId: envelope.aggregateId, message }
  }
  const event = (envelope.payload as { event?: AgentEvent } | null)?.event
  return event && typeof event === 'object' && typeof event.type === 'string' ? event : undefined
}
