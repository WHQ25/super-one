import { describe, expect, it } from 'vitest'

import { MobileBroadcaster, type MobileTransport } from './mobile-broadcaster'
import type { Session, SessionManager } from '../session/types'
import type { AgentEvent } from '../../shared/agent-types'

function makeFakeSession(props: { id: string; owner?: Session['owner']; subscribers?: string[] }): Session {
  const subscribers = new Set(props.subscribers ?? [])
  const owner = props.owner ?? { kind: 'local' }
  return {
    id: props.id,
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
