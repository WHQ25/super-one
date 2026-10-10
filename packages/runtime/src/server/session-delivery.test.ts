import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { EnvironmentEventEnvelope, SessionLoadResult, SessionStreamFrame } from '@superone/shared/environment'
import { ConnectionDelivery } from '../stream/delivery/connection-delivery'
import { deliveryPolicy } from '../stream/delivery-policy'
import { deliverFrame, deliverLoad, subscribeDetail } from './session-delivery'

let transcript: ChatMessage[] = []
const message = (thinking: string): ChatMessage => ({ id: 'm', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'claude', content: [{ type: 'thinking', thinking }] })
const sessions = { messages: () => transcript }
const load = (): SessionLoadResult => ({ sessionId: 's', state: {}, messages: transcript, before: null, cursor: { sequence: '1', epoch: 'e', version: 1 } })
const envelope = (event: AgentEvent, version: number): EnvironmentEventEnvelope => ({
  eventId: `e${version}`, environmentId: 'env', sequence: '1', aggregateType: 'session', aggregateId: 's', eventType: 'session.agent_event',
  eventVersion: 1, payload: { event }, timestamp: 0, sessionVersion: version, ephemeral: true,
} as EnvironmentEventEnvelope)
const frame = (...events: EnvironmentEventEnvelope[]): SessionStreamFrame => ({ sequence: '1', epoch: 'e', events })
const thinkingDelta = (text: string): AgentEvent => ({ type: 'content_delta', sessionId: 's', messageId: 'm', delta: { type: 'thinking', thinking: text } })

describe('node session delivery', () => {
  it('summarizes what a relay connection loads and streams, and expands rows on request', () => {
    const relay = new ConnectionDelivery(deliveryPolicy('relay', 'desktop'))
    transcript = [message('plan')]
    const loaded = deliverLoad(load(), relay)
    expect(loaded.summarized).toBe(true)
    expect(loaded.messages[0]!.content[0]).toMatchObject({ thinking: '', remoteDetail: '["m","thinking",0]' })

    expect(subscribeDetail(relay, sessions, { sessionId: 's', detailRef: '["m","thinking",0]', subscriptionId: 'sub' }))
      .toEqual({ subscriptionId: 'sub', revision: 0, offset: 0, text: 'plan' })

    transcript = [message('plan more')]
    const delivered = deliverFrame(frame(envelope(thinkingDelta(' more'), 2)), relay, sessions)
    expect((delivered.frame.events[0]!.payload as { event: AgentEvent }).event).toMatchObject({ remoteView: 'summary' })
    expect(delivered.frame.events[0]!.sessionVersion).toBe(2)
    expect(delivered.details).toEqual([{ sessionId: 's', update: { subscriptionId: 'sub', revision: 1, offset: 4, text: ' more' } }])
  })

  it('sends a LAN connection full rows and refuses detail it never summarized', () => {
    const lan = new ConnectionDelivery(deliveryPolicy('lan', 'desktop'))
    transcript = [message('plan')]
    expect(deliverLoad(load(), lan).messages).toEqual(transcript)
    const delivered = deliverFrame(frame(envelope(thinkingDelta('plan'), 2)), lan, sessions)
    expect((delivered.frame.events[0]!.payload as { event: AgentEvent }).event).toEqual(thinkingDelta('plan'))
    expect(() => subscribeDetail(lan, sessions, { sessionId: 's', detailRef: '["m","thinking",0]', subscriptionId: 'sub' }))
      .toThrow(expect.objectContaining({ code: 'failed_precondition' }))
    expect(() => subscribeDetail(lan, sessions, { sessionId: 's', detailRef: 'nope', subscriptionId: 'sub' }))
      .toThrow(expect.objectContaining({ code: 'invalid_argument' }))
  })
})
