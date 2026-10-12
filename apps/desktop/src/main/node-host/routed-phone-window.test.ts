import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { EnvironmentEventEnvelope, SessionStreamFrame } from '@superone/shared/environment'
import type { TranscriptWindowResult } from '@superone/shared/environment/transcript-window'
import { ConnectionDelivery, deliveryPolicy } from '@superone/runtime/stream'
import { RoutedPhoneDelivery } from './routed-phone-delivery'

const result = (version = 1): TranscriptWindowResult => ({
  sessionId: 's', schema: 1, messages: [], older: null, newer: null, total: 0,
  state: { status: 'streaming' }, cursor: { sequence: String(version), version, epoch: 'epoch' },
})
const envelope = (event: AgentEvent, version: number): EnvironmentEventEnvelope => ({
  eventId: `e${version}`, environmentId: 'source', sequence: String(version), aggregateType: 'session', aggregateId: 's',
  eventType: 'session.agent_event', eventVersion: 1, payload: { event }, timestamp: 0, sessionVersion: version,
} as EnvironmentEventEnvelope)
const frame = (...events: EnvironmentEventEnvelope[]): SessionStreamFrame => ({ sequence: '9', epoch: 'epoch', events })
const types = (out: SessionStreamFrame) => out.events.map((e) => (e.payload as { event: AgentEvent }).event)

describe('routed transcript windows', () => {
  it('relays only this phone\'s window patches in place of content events', () => {
    const views = new RoutedPhoneDelivery(), delivery = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))
    const served = views.window('source', result(), delivery, 'phone-a')
    expect(served).toMatchObject({ summarized: true, state: { status: 'streaming' } })
    expect(views.has('source', 's')).toBe(true)
    const patch = { messages: [], total: 1 }
    const out = views.frame('source', frame(
      envelope({ type: 'content_delta', messageId: 'a', delta: { type: 'text', text: 'hi' } }, 2),
      envelope({ type: 'status_change', status: 'streaming' }, 3),
      envelope({ type: 'transcript_window', holder: 'phone-b', patch }, 3),
      envelope({ type: 'transcript_window', holder: 'phone-a', patch }, 3),
    ), delivery, () => {})
    const events = types(out)
    // The mapper opens the turn for the withheld delta; that start carries no content.
    expect(events.map((e) => e.type)).toEqual(['message_start', 'status_change', 'transcript_window'])
    expect(events[0]).toMatchObject({ message: { id: 'a', content: [] } })
    expect(events[2]).not.toHaveProperty('holder')
  })

  it('keeps content events for a session loaded the legacy way', () => {
    const views = new RoutedPhoneDelivery(), delivery = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))
    views.window('source', result(), delivery, 'phone-a')
    views.load('source', { sessionId: 's', state: {}, messages: [], before: null, cursor: { sequence: '2', version: 2, epoch: 'epoch' } }, delivery)
    const out = views.frame('source', frame(envelope({ type: 'content_delta', messageId: 'a', delta: { type: 'text', text: 'hi' } }, 3)), delivery, () => {})
    expect(types(out).map((e) => e.type)).toContain('content_delta')
  })
})
