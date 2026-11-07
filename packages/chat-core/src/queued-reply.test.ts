import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { EnvironmentEventEnvelope } from '@superone/shared/environment/events'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

function fixture(provider: 'codex' | 'claude' = 'codex', skipUserMessage = true) {
  const state = createDefaultChatCoreSession()
  const mapper = createNodeSessionEventMapper({ sessionId: 'session', providerId: provider, skipUserMessage })
  let sequence = 0
  const apply = (event: AgentEvent) => Object.assign(state, applyEventToSession(state, event))
  const envelope = (eventType: string, payload: unknown) => {
    sequence += 1
    mapper.map({ eventId: `event-${sequence}`, sequence: String(sequence), timestamp: sequence,
      aggregateType: 'session', aggregateId: 'session', environmentId: 'node', eventVersion: 1,
      eventType, payload } as EnvironmentEventEnvelope).forEach(apply)
  }
  const emit = (event: AgentEvent) => envelope('session.agent_event', { event })
  const message = (id: string, role: ChatMessage['role'], status: ChatMessage['status']): ChatMessage => ({
    id, role, status, providerId: provider, createdAt: '2026-11-07T06:35:17.000Z',
    content: [{ type: 'text', text: id }],
  })
  emit({ type: 'message_start', message: message('assistant', 'assistant', 'streaming') })
  emit({ type: 'status_change', status: 'streaming' })
  const queued = message('queued', 'user', 'complete')
  emit({ type: 'queued_messages_changed', messages: [queued] })
  const consume = () => {
    envelope('session.user_message', { blockId: queued.id, text: 'queued' })
    emit({ type: 'queued_message_consumed', clientMessageId: queued.id })
    emit({ type: 'queued_messages_changed', messages: [] })
  }
  return { state, emit, consume, message }
}

describe('queued input reply state', () => {
  it.each(['codex', 'claude'] as const)('does not wait for a new message when remote %s steering joins the active reply', provider => {
    const { state, emit, consume } = fixture(provider)
    consume()
    expect(state.queuedMessages).toEqual([])
    expect(state.messages.map(message => message.id)).toEqual(['assistant', 'queued'])
    expect(state.awaitingAssistantReply).toBe(false)

    // Codex and Claude Insert Soon can keep the original assistant message id.
    emit({ type: 'content_delta', messageId: 'assistant', delta: { type: 'text', text: 'Continuing after steer' } })
    expect(state.awaitingAssistantReply).toBe(false)
    expect(state.messages.filter(message => message.role === 'assistant')).toHaveLength(1)
  })

  it('does not duplicate an observer user echo when the queued input joins an active reply', () => {
    const { state, consume } = fixture('codex', false)
    consume()
    expect(state.messages.filter(message => message.id === 'queued')).toHaveLength(1)
    expect(state.awaitingAssistantReply).toBe(false)
  })

  it('keeps waiting for a normal queued turn after the previous reply completes', () => {
    const { state, emit, consume, message } = fixture()
    emit({ type: 'message_complete', messageId: 'assistant', metadata: { queuedTurnCount: 1 } })
    consume()
    expect(state.status).toBe('streaming')
    expect(state.awaitingAssistantReply).toBe(true)
    emit({ type: 'message_start', message: message('next-assistant', 'assistant', 'streaming') })
    expect(state.awaitingAssistantReply).toBe(false)
  })

  it('does not rearm waiting if the queued reply starts before the consume event', () => {
    const { state, emit, consume, message } = fixture()
    emit({ type: 'message_complete', messageId: 'assistant' })
    emit({ type: 'message_start', message: message('next-assistant', 'assistant', 'streaming') })
    consume()
    expect(state.awaitingAssistantReply).toBe(false)
  })

  it('waits when the session is streaming but no assistant message has started', () => {
    const { state, consume } = fixture()
    state.messages = []
    consume()
    expect(state.awaitingAssistantReply).toBe(true)
  })

  it('ignores a stale earlier streaming row when the latest reply has ended', () => {
    const { state, consume, message } = fixture()
    state.messages.push(message('latest-assistant', 'assistant', 'complete'))
    consume()
    expect(state.awaitingAssistantReply).toBe(true)
  })
})
