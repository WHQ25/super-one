import { describe, expect, it, vi } from 'vitest'

import { MobileBroadcaster, sessionActivityEvent, type MobileTransport } from './mobile-broadcaster'
import { rememberAttachmentOrigin } from './attachment-echo'
import type { Session, SessionManager } from '../session/types'
import type { AgentEvent } from '@superone/shared/agent-types'

function makeFakeSession(props: { id: string; owner?: Session['owner']; subscribers?: string[] }): Session {
  const subscribers = new Set(props.subscribers ?? [])
  const owner = props.owner ?? { kind: 'local' }
  return {
    id: props.id,
    snapshot: { messages: [] },
    activityStatus: () => 'idle',
    realtimeActive: false,
    get owner() { return owner },
    get subscribers() { return subscribers },
  } as unknown as Session
}

function makeFakeManager(sessions: Map<string, Session>): SessionManager {
  return {
    getSession: (id: string) => sessions.get(id) ?? null,
  } as unknown as SessionManager
}

interface SentEntry { event: AgentEvent; targets?: string[] }
function makeFakeTransport(): MobileTransport & { sent: SentEntry[] } {
  const sent: SentEntry[] = []
  return {
    sent,
    async sendAgentEvent(event: AgentEvent, targets?: string[]) {
      sent.push({ event, targets })
    },
  }
}

const session = (sessionId: string) => ({ kind: 'session', environmentId: 'desktop-env', sessionId }) as const
const agent = (event: AgentEvent, source: 'session' | 'presence' = 'session') => ({ kind: 'agent', event, source }) as const

describe('MobileBroadcaster', () => {
  it('sends list, draft and environment topics to every phone (targets undefined)', async () => {
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map()), transport, 'desktop-env')
    broadcaster.deliver({ kind: 'environment', environmentId: 'desktop-env' }, agent({ type: 'provider_changed' } as AgentEvent, 'session'), ['dev-A', 'dev-B'])
    broadcaster.deliver({ kind: 'drafts', environmentId: 'desktop-env' }, agent({ type: 'draft_changed', draftId: 'd1', reason: 'saved',
      draft: { id: 'd1', attachments: [{ name: 'a.png', mimeType: 'image/png', data: 'AAAA' }] } } as unknown as AgentEvent), ['dev-A'])
    expect(transport.sent.map((entry) => entry.targets)).toEqual([undefined, undefined])
    expect(JSON.stringify(transport.sent[1].event)).not.toContain('AAAA')
  })

  it('sends a session event to the phones the topic reached, stamped with this environment', async () => {
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['s1', makeFakeSession({ id: 's1' })]])), transport, 'desktop-env')
    broadcaster.deliver(session('s1'), agent({ type: 'message_complete', sessionId: 's1' } as AgentEvent), ['dev-A', 'dev-B'])
    await Promise.resolve()
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0].targets).toEqual(['dev-A', 'dev-B'])
    expect(transport.sent[0].event.environmentId).toBe('desktop-env')
  })

  it('leaves out presence, settings and other machines\' sessions', async () => {
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['s1', makeFakeSession({ id: 's1' })]])), transport, 'desktop-env')
    broadcaster.deliver(session('s1'), agent({ type: 'remote_control_changed', sessionId: 's1' } as AgentEvent, 'presence'), ['dev-A'])
    broadcaster.deliver({ kind: 'session', environmentId: 'node-1', sessionId: 's1' }, agent({ type: 'message_complete', sessionId: 's1' } as AgentEvent), ['dev-A'])
    expect(transport.sent).toEqual([])
  })

  it('echoes a sent picture back to its sender without the bytes, and in full to everyone else', async () => {
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['s1', makeFakeSession({ id: 's1' })]])), transport, 'desktop-env')
    rememberAttachmentOrigin('user_1', 'phone')
    const event = {
      type: 'user_message_appended', sessionId: 's1',
      message: { id: 'user_1', role: 'user', status: 'complete', content: [{ type: 'text', text: 'look' }],
        createdAt: '', providerId: 'remote', attachments: [{ name: 'a.jpg', mimeType: 'image/jpeg', base64: 'AAAA' }] },
    } as AgentEvent
    await broadcaster.deliverSession(event, ['phone', 'tablet'])
    const toPhone = transport.sent.find((entry) => entry.targets?.includes('phone'))!
    const toTablet = transport.sent.find((entry) => entry.targets?.includes('tablet'))!
    expect(toPhone.targets).toEqual(['phone'])
    expect((toPhone.event as { message: { attachments: Array<{ base64: string }> } }).message.attachments[0].base64).toBe('')
    expect((toTablet.event as { message: { attachments: Array<{ base64: string }> } }).message.attachments[0].base64).toBe('AAAA')
    // The origin is consumed: a replay of the same message goes out in full.
    transport.sent.length = 0
    await broadcaster.deliverSession(event, ['phone', 'tablet'])
    expect(transport.sent).toHaveLength(1)
    expect(new Set(transport.sent[0].targets)).toEqual(new Set(['phone', 'tablet']))
  })

  it('drops session events no phone follows, and events for unknown sessions', async () => {
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['s1', makeFakeSession({ id: 's1' })]])), transport, 'desktop-env')
    await broadcaster.deliverSession({ type: 'message_complete', sessionId: 's1' } as AgentEvent, [])
    await broadcaster.deliverSession({ type: 'message_complete', sessionId: 'ghost' } as AgentEvent, ['dev-A'])
    expect(transport.sent).toHaveLength(0)
  })
})

it('summarizes pending requests for an unopened session and clears them after resolution', () => {
  let pending: AgentEvent[] = [{ type: 'permission_request', request: { requestId: 'p1', toolName: 'Bash' } } as AgentEvent]
  const s = {
    ...makeFakeSession({ id: 's1' }),
    snapshot: { id: 's1', projectPath: '/project', harnessId: 'codex', status: 'idle' },
    getPendingInteractions: () => pending,
  } as unknown as Session
  expect(sessionActivityEvent(s, { ...pending[0], sessionId: 's1' } as AgentEvent, null)).toEqual({
    type: 'session_activity', activity: {
      sessionId: 's1', projectPath: '/project', provider: 'codex', status: 'idle',
      pendingCount: 1, pendingReason: { en: 'Allow Bash?', zh: '允许 Bash？' },
    },
  })
  pending = []
  expect(sessionActivityEvent(s, { type: 'interaction_resolved', interactionType: 'permission', requestId: 'p1', sessionId: 's1' }, null))
    .toMatchObject({ type: 'session_activity', activity: { pendingCount: 0, pendingReason: { en: null, zh: null } } })
})

it('names a collaboration child\'s parent, so a phone that has not listed it nests it', () => {
  const s = {
    ...makeFakeSession({ id: 'child' }),
    snapshot: { id: 'child', projectPath: '/p', harnessId: 'claude', status: 'streaming' },
    getPendingInteractions: () => [],
  } as unknown as Session
  expect(sessionActivityEvent(s, { type: 'status_change', status: 'streaming', sessionId: 'child' }, 'parent'))
    .toMatchObject({ type: 'session_activity', activity: { sessionId: 'child', parentSessionId: 'parent' } })
})

it('carries the host read receipt on the summary', () => {
  const s = {
    ...makeFakeSession({ id: 'read' }),
    snapshot: { id: 'read', projectPath: '/p', harnessId: 'claude', status: 'idle',
      messages: [{ id: 'reply-1', role: 'assistant', status: 'complete' }] },
    seenCompletedMessageId: 'reply-1',
    getPendingInteractions: () => [],
  } as unknown as Session
  expect(sessionActivityEvent(s, { type: 'session_seen', messageId: 'reply-1', sessionId: 'read' }, null)).toEqual(expect.objectContaining({
    type: 'session_activity',
    activity: expect.objectContaining({ completedMessageId: 'reply-1', seenCompletedMessageId: 'reply-1' }),
  }))
})

it('reports backend liveness, not the send snapshot, which reads streaming until send() returns', () => {
  const s = {
    ...makeFakeSession({ id: 'background' }),
    snapshot: { id: 'background', projectPath: '/other', harnessId: 'codex', status: 'streaming',
      messages: [{ id: 'reply-1', role: 'assistant', status: 'complete' }] },
    getPendingInteractions: () => [],
  } as unknown as Session
  expect(sessionActivityEvent(s, { type: 'status_change', status: 'idle', sessionId: 'background' }, null)).toEqual(expect.objectContaining({
    type: 'session_activity', completed: true,
    activity: expect.objectContaining({ status: 'idle', completedMessageId: 'reply-1' }),
  }))
})

it('keeps a continuation turn live on a pending request, and says so for background work and voice', () => {
  let status: ReturnType<Session['activityStatus']> = 'streaming'
  let realtimeActive = false
  const s = {
    ...makeFakeSession({ id: 'queued' }),
    // A continuation turn: the awaited send already returned.
    snapshot: { id: 'queued', projectPath: '/p', harnessId: 'claude', status: 'ended', messages: [] },
    activityStatus: () => status,
    get realtimeActive() { return realtimeActive },
    getPendingInteractions: () => [],
  } as unknown as Session
  const summaries: unknown[] = []
  const summarize = (event: AgentEvent) => {
    const out = sessionActivityEvent(s, event, null)
    if (out?.type === 'session_activity') summaries.push([out.activity.status, !!out.activity.realtimeActive])
  }
  summarize({ type: 'permission_request', request: { requestId: 'p1', toolName: 'Bash' }, sessionId: 'queued' } as AgentEvent)
  status = 'background'
  summarize({ type: 'status_change', status: 'background', sessionId: 'queued' })
  status = 'idle'
  realtimeActive = true
  summarize({ type: 'realtime_started', version: 'v1', sessionId: 'queued' })
  expect(summaries).toEqual([['streaming', false], ['background', false], ['idle', true]])
})
