import { describe, expect, it } from 'vitest'

import { MobileBroadcaster, type MobileTransport } from './mobile-broadcaster'
import type { Session, SessionManager } from '../session/types'
import type { AgentEvent } from '@superone/shared/agent-types'

function makeFakeSession(props: { id: string; owner?: Session['owner']; subscribers?: string[] }): Session {
  const subscribers = new Set(props.subscribers ?? [])
  const owner = props.owner ?? { kind: 'local' }
  return {
    id: props.id,
    snapshot: { messages: [] },
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

describe('MobileBroadcaster', () => {
  it('broadcasts events without sessionId to all peers (targets undefined)', async () => {
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map()), transport)
    await broadcaster.broadcast({ type: 'provider_changed' } as AgentEvent)
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0].targets).toBeUndefined()
  })

  it('routes session events only to subscribers (single subscriber)', async () => {
    const session = makeFakeSession({ id: 's1', subscribers: ['dev-A'] })
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['s1', session]])), transport)
    await broadcaster.broadcast({ type: 'message_complete', sessionId: 's1' } as AgentEvent)
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0].targets).toEqual(['dev-A'])
  })

  it('routes session events to all subscribers (multiple)', async () => {
    const session = makeFakeSession({ id: 's1', subscribers: ['dev-A', 'dev-B'] })
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['s1', session]])), transport)
    await broadcaster.broadcast({ type: 'message_complete', sessionId: 's1' } as AgentEvent)
    expect(transport.sent).toHaveLength(1)
    expect(new Set(transport.sent[0].targets)).toEqual(new Set(['dev-A', 'dev-B']))
  })

  it('does NOT route session X events to subscribers of session Y (the cross-talk case)', async () => {
    const sessionX = makeFakeSession({ id: 'X', subscribers: ['dev-A'] })
    const sessionY = makeFakeSession({ id: 'Y', subscribers: ['dev-B'] })
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(
      makeFakeManager(new Map<string, Session>([['X', sessionX], ['Y', sessionY]])),
      transport,
    )
    await broadcaster.broadcast({ type: 'message_complete', sessionId: 'X' } as AgentEvent)
    await broadcaster.broadcast({ type: 'message_complete', sessionId: 'Y' } as AgentEvent)
    expect(transport.sent).toHaveLength(2)
    expect(transport.sent[0].targets).toEqual(['dev-A'])
    expect(transport.sent[1].targets).toEqual(['dev-B'])
  })

  it('routes to remote owner when session is remotely owned without subscribers', async () => {
    const session = makeFakeSession({ id: 's1', owner: { kind: 'remote', deviceId: 'dev-A' } })
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['s1', session]])), transport)
    await broadcaster.broadcast({ type: 'message_complete', sessionId: 's1' } as AgentEvent)
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0].targets).toEqual(['dev-A'])
  })

  it('merges remote owner with subscribers without duplicates', async () => {
    const session = makeFakeSession({
      id: 's1',
      owner: { kind: 'remote', deviceId: 'dev-A' },
      subscribers: ['dev-A', 'dev-B'],
    })
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['s1', session]])), transport)
    await broadcaster.broadcast({ type: 'message_complete', sessionId: 's1' } as AgentEvent)
    expect(transport.sent).toHaveLength(1)
    expect(new Set(transport.sent[0].targets)).toEqual(new Set(['dev-A', 'dev-B']))
  })

  it('drops session events when session is local-owned with no subscribers', async () => {
    const session = makeFakeSession({ id: 's1' })
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['s1', session]])), transport)
    await broadcaster.broadcast({ type: 'message_complete', sessionId: 's1' } as AgentEvent)
    expect(transport.sent).toHaveLength(0)
  })

  it('drops events for unknown sessions', async () => {
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map()), transport)
    await broadcaster.broadcast({ type: 'message_complete', sessionId: 'ghost' } as AgentEvent)
    expect(transport.sent).toHaveLength(0)
  })
})

it('broadcasts pending summaries for an unopened session and clears them after resolution', async () => {
  const transport = makeFakeTransport()
  let pending: AgentEvent[] = [{ type: 'permission_request', request: { requestId: 'p1', toolName: 'Bash' } } as AgentEvent]
  const session = {
    ...makeFakeSession({ id: 's1' }),
    snapshot: { id: 's1', projectPath: '/project', harnessId: 'codex', status: 'idle' },
    getPendingInteractions: () => pending,
  } as unknown as Session
  const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['s1', session]])), transport)
  await broadcaster.broadcast({ ...pending[0], sessionId: 's1' } as AgentEvent)
  expect(transport.sent).toEqual([{
    event: { type: 'session_activity', activity: {
      sessionId: 's1', projectPath: '/project', provider: 'codex', status: 'idle',
      pendingCount: 1, pendingReason: { en: 'Allow Bash?', zh: '允许 Bash？' },
    } }, targets: undefined,
  }])
  pending = []
  await broadcaster.broadcast({ type: 'interaction_resolved', interactionType: 'permission', requestId: 'p1', sessionId: 's1' })
  expect(transport.sent[1].event).toMatchObject({ type: 'session_activity', activity: { pendingCount: 0, pendingReason: { en: null, zh: null } } })
})

it('broadcasts idle completion even while the send snapshot still reports streaming', async () => {
  const transport = makeFakeTransport()
  const session = {
    ...makeFakeSession({ id: 'background' }),
    snapshot: { id: 'background', projectPath: '/other', harnessId: 'codex', status: 'streaming',
      messages: [{ id: 'reply-1', role: 'assistant', status: 'complete' }] },
    getPendingInteractions: () => [],
  } as unknown as Session
  const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['background', session]])), transport)
  await broadcaster.broadcast({ type: 'status_change', status: 'idle', sessionId: 'background' })
  expect(transport.sent).toEqual([{ targets: undefined, event: expect.objectContaining({
    type: 'session_activity', completed: true,
    activity: expect.objectContaining({ status: 'idle', completedMessageId: 'reply-1' }),
  }) }])
})
