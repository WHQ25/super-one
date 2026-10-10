import { afterEach, describe, expect, it } from 'vitest'
import { configureRemoteContent, remoteContentPorts } from '../stream/delivery/remote-content'
import { createDefaultChatCoreSession } from '@superone/chat-core'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { EnvironmentEventEnvelope, SessionLoadResult, SessionStreamFrame } from '@superone/shared/environment'
import { ConnectionDelivery } from '../stream/delivery/connection-delivery'
import { deliveryPolicy } from '../stream/delivery-policy'
import { deliverFrame, deliverLoad, subscribeDetail } from './session-delivery'

let transcript: ChatMessage[] = []
const contentPorts = remoteContentPorts()
afterEach(() => configureRemoteContent(contentPorts))
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
  it('omits only exact phone reducer defaults and restores the same state without dropping host fields', () => {
    const { messages: _messages, ...defaults } = createDefaultChatCoreSession()
    const state = { ...defaults, status: 'streaming', pendingPermissions: [{ requestId: 'p', toolName: 'Bash', input: {} }],
      streamingTokens: { input: 0, output: 2 }, cwd: '/app', hostFact: false, selectedEffort: null }
    const raw = { ...load(), state }
    const phone = deliverLoad(raw, new ConnectionDelivery(deliveryPolicy('relay', 'phone')))
    expect({ ...defaults, ...phone.state }).toEqual(state)
    expect(phone.state).not.toHaveProperty('queuedMessages')
    expect(phone.state).not.toHaveProperty('todos')
    expect(phone.state).toMatchObject({ status: 'streaming', streamingTokens: { input: 0, output: 2 }, cwd: '/app', hostFact: false, selectedEffort: null })
    expect(deliverLoad(raw, new ConnectionDelivery(deliveryPolicy('relay', 'desktop'))).state).toEqual(state)
    expect(raw.state).toEqual(state)
  })
  it('projects a native user record with its original metadata and removes redundant attachment bytes', () => {
    configureRemoteContent({ ...contentPorts, withAttachmentPreviews: message => ({ ...message,
      attachments: message.attachments?.map(attachment => ({ ...attachment, base64: '', preview: true })) }) })
    const phone = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))
    const user: ChatMessage = { id: 'user', role: 'user', status: 'complete', createdAt: '2026-10-10T00:00:00Z', providerId: 'claude',
      content: [{ type: 'text', text: 'Look at this' }], contexts: [{ type: 'text', text: 'selected context' } as never],
      attachments: [{ id: 'image', name: 'screen.png', mimeType: 'image/png', base64: 'private-image-bytes' }] }
    transcript = [user]
    const record = { ...envelope({ type: 'status_change', status: 'idle' }, 1), eventType: 'session.user_message',
      payload: { message: user, blockId: user.id, text: 'Look at this', attachments: user.attachments } }
    const delivered = deliverFrame(frame(record), phone, sessions).frame.events[0]!
    expect(delivered).toMatchObject({ eventType: 'session.agent_event', payload: { event: { type: 'user_message_appended', message: {
      id: 'user', createdAt: user.createdAt, contexts: user.contexts, attachments: [expect.objectContaining({ id: 'image', base64: '' })],
    } } } })
    expect(JSON.stringify(delivered.payload)).not.toContain('private-image-bytes')
    expect(delivered.payload).not.toHaveProperty('message')
  })
  it('projects an active turn outside the loaded history page once and preserves the raw host snapshot', () => {
    const relay = new ConnectionDelivery(deliveryPolicy('relay', 'phone'))
    const raw: SessionLoadResult = { ...load(), messages: [], activeTurn: [message('full active thought')], state: { pendingPermissions: [{ requestId: 'edit', toolName: 'Edit', input: { file_path: 'a.ts', old_string: 'old', new_string: 'new' } }], queuedMessages: [] } }
    const delivered = deliverLoad(raw, relay)
    expect(delivered.activeTurn?.[0].content[0]).toMatchObject({ thinking: '', remoteDetail: '["m","thinking",0]' })
    expect(delivered.state.pendingPermissions).toEqual([expect.objectContaining({ toolDiff: '-old\n+new' })])
    expect(raw.activeTurn?.[0].content[0]).toEqual({ type: 'thinking', thinking: 'full active thought' })
    expect(raw.state.pendingPermissions).toEqual([expect.not.objectContaining({ toolDiff: expect.anything() })])
  })

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

  it('folds adjacent deltas of a session into the later envelope, and leaves a summarized tool input out', () => {
    const lan = new ConnectionDelivery(deliveryPolicy('lan', 'desktop'))
    transcript = [message('ab')]
    const folded = deliverFrame(frame(envelope(thinkingDelta('a'), 2), envelope(thinkingDelta('b'), 3)), lan, sessions)
    expect(folded.frame.events).toHaveLength(1)
    expect(folded.frame.events[0]).toMatchObject({ eventId: 'e3', sessionVersion: 3, payload: { event: { delta: { thinking: 'ab' } } } })

    const relay = new ConnectionDelivery(deliveryPolicy('relay', 'desktop'))
    deliverLoad(load(), relay)
    const input: AgentEvent = { type: 'tool_input_delta', sessionId: 's', messageId: 'm', toolUseId: 't', partialJson: '{"a"' } as AgentEvent
    expect(deliverFrame(frame(envelope(input, 4)), relay, sessions).frame.events).toEqual([])
    expect(deliverFrame(frame(envelope(input, 4)), lan, sessions).frame.events).toHaveLength(1)
  })
})
