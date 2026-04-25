import { describe, expect, it, vi } from 'vitest'

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

function makeFakeTransport(): MobileTransport & { sent: AgentEvent[] } {
  const sent: AgentEvent[] = []
  return {
    sent,
    async broadcastAgentEvent(e: AgentEvent) { sent.push(e) },
  }
}

describe('MobileBroadcaster', () => {
  it('always broadcasts events without sessionId (e.g. provider_changed)', async () => {
    const sessions = new Map<string, Session>()
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(sessions), transport)
    await broadcaster.broadcast({ type: 'provider_changed' } as AgentEvent)
    expect(transport.sent).toHaveLength(1)
  })

  it('broadcasts session events when session has at least one subscriber', async () => {
    const session = makeFakeSession({ id: 's1', subscribers: ['dev-A'] })
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['s1', session]])), transport)
    await broadcaster.broadcast({ type: 'message_complete', sessionId: 's1' } as AgentEvent)
    expect(transport.sent).toHaveLength(1)
  })

  it('broadcasts session events when session is remotely owned (even without subscribers)', async () => {
    const session = makeFakeSession({ id: 's1', owner: { kind: 'remote', deviceId: 'dev-A' } })
    const transport = makeFakeTransport()
    const broadcaster = new MobileBroadcaster(makeFakeManager(new Map([['s1', session]])), transport)
    await broadcaster.broadcast({ type: 'message_complete', sessionId: 's1' } as AgentEvent)
    expect(transport.sent).toHaveLength(1)
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
