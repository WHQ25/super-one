import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { PresenceCoordinator, type PresenceTransport, type PresenceSessionSource } from './presence-coordinator'
import type { AgentEvent } from '../../shared/agent-types'
import type { Session, SessionLifecycleEvent } from '../session/types'

class FakeSession {
  readonly id: string
  readonly projectPath: string
  owner: { kind: 'local' } | { kind: 'remote'; deviceId: string } = { kind: 'local' }
  subscribers = new Set<string>()
  private listeners = new Set<(e: SessionLifecycleEvent) => void>()

  constructor(id: string, projectPath: string) {
    this.id = id
    this.projectPath = projectPath
  }

  onLifecycle(handler: (e: SessionLifecycleEvent) => void): () => void {
    this.listeners.add(handler)
    return () => { this.listeners.delete(handler) }
  }

  emit(evt: SessionLifecycleEvent): void {
    for (const cb of this.listeners) cb(evt)
  }

  hasListeners(): boolean {
    return this.listeners.size > 0
  }
}

function makeSource(): PresenceSessionSource & { add: (s: FakeSession) => void; sessions: FakeSession[] } {
  const sessions: FakeSession[] = []
  let handler: ((session: Session) => void) | null = null
  return {
    sessions,
    onSession(h) {
      handler = h
      for (const s of sessions) h(s as unknown as Session)
      return () => { handler = null }
    },
    add(s) {
      sessions.push(s)
      if (handler) handler(s as unknown as Session)
    },
    forEachSession(fn) {
      for (const s of sessions) fn(s as unknown as Session)
    },
  }
}

interface MobileSent { event: Record<string, unknown>; targets?: string[] }
function makeTransport(): PresenceTransport & { sent: AgentEvent[]; mobile: MobileSent[] } {
  const sent: AgentEvent[] = []
  const mobile: MobileSent[] = []
  return {
    sent,
    mobile,
    broadcastToRenderer(event) { sent.push(event) },
    sendToMobile(event, targets) { mobile.push({ event, targets }) },
  }
}

describe('PresenceCoordinator', () => {
  it('emits remote_session_start when owner switches local → remote', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({
      type: 'owner_changed', sessionId: 's1',
      previous: { kind: 'local' },
      current: { kind: 'remote', deviceId: 'dev-A' },
    })
    expect(transport.sent).toEqual([
      { type: 'remote_session_start', remoteProjectPath: '/proj/A', remoteSessionId: 's1' },
    ])
  })

  it('emits remote_session_end + session_disconnected to previous owner when owner switches remote → local', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({
      type: 'owner_changed', sessionId: 's1',
      previous: { kind: 'remote', deviceId: 'dev-A' },
      current: { kind: 'local' },
    })
    expect(transport.sent).toEqual([
      { type: 'remote_session_end', remoteProjectPath: '/proj/A', remoteSessionId: 's1' },
    ])
    expect(transport.mobile).toEqual([
      { event: { type: 'session_disconnected', sessionId: 's1' }, targets: ['dev-A'] },
    ])
  })

  it('emits remote_session_start with isSubscribe on subscriber_added', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({ type: 'subscriber_added', sessionId: 's1', deviceId: 'dev-B' })
    expect(transport.sent).toEqual([
      { type: 'remote_session_start', remoteProjectPath: '/proj/A', remoteSessionId: 's1', isSubscribe: true },
    ])
  })

  it('emits remote_session_end + session_disconnected to that device on subscriber_removed', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({ type: 'subscriber_removed', sessionId: 's1', deviceId: 'dev-B' })
    expect(transport.sent).toEqual([
      { type: 'remote_session_end', remoteProjectPath: '/proj/A', remoteSessionId: 's1', isSubscribe: true },
    ])
    expect(transport.mobile).toEqual([
      { event: { type: 'session_disconnected', sessionId: 's1' }, targets: ['dev-B'] },
    ])
  })

  it('attaches to sessions added later', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s1 = new FakeSession('s1', '/proj/A')
    const s2 = new FakeSession('s2', '/proj/B')
    source.add(s1)
    source.add(s2)
    s2.emit({ type: 'subscriber_added', sessionId: 's2', deviceId: 'dev-C' })
    expect(transport.sent).toEqual([
      { type: 'remote_session_start', remoteProjectPath: '/proj/B', remoteSessionId: 's2', isSubscribe: true },
    ])
  })

  it('detaches lifecycle listener when session closes', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    expect(s.hasListeners()).toBe(true)
    s.emit({ type: 'closed', sessionId: 's1' })
    expect(s.hasListeners()).toBe(false)
  })

  it('does not duplicate attach when same session is registered twice', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    source.add(s)
    s.emit({ type: 'subscriber_added', sessionId: 's1', deviceId: 'dev-X' })
    expect(transport.sent).toHaveLength(1)
  })

  it('treats remote → remote (different device) as a fresh start and notifies previous owner', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({
      type: 'owner_changed', sessionId: 's1',
      previous: { kind: 'remote', deviceId: 'dev-A' },
      current: { kind: 'remote', deviceId: 'dev-B' },
    })
    expect(transport.sent).toEqual([
      { type: 'remote_session_start', remoteProjectPath: '/proj/A', remoteSessionId: 's1' },
    ])
    expect(transport.mobile).toEqual([
      { event: { type: 'session_disconnected', sessionId: 's1' }, targets: ['dev-A'] },
    ])
  })

  it('does NOT send session_disconnected when the device is still active in another session', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const sessionA = new FakeSession('s-A', '/proj')
    const sessionB = new FakeSession('s-B', '/proj')
    source.add(sessionA)
    source.add(sessionB)
    sessionB.subscribers.add('dev-1')
    sessionA.subscribers.add('dev-1')
    sessionA.subscribers.delete('dev-1')
    sessionA.emit({ type: 'subscriber_removed', sessionId: 's-A', deviceId: 'dev-1' })

    expect(transport.sent).toEqual([
      { type: 'remote_session_end', remoteProjectPath: '/proj', remoteSessionId: 's-A', isSubscribe: true },
    ])
    expect(transport.mobile).toHaveLength(0)
  })

  it('does NOT send session_disconnected on owner_changed → local when device still owns another session', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const sessionA = new FakeSession('s-A', '/proj')
    const sessionB = new FakeSession('s-B', '/proj')
    source.add(sessionA)
    source.add(sessionB)
    sessionB.owner = { kind: 'remote', deviceId: 'dev-1' }
    sessionA.emit({
      type: 'owner_changed', sessionId: 's-A',
      previous: { kind: 'remote', deviceId: 'dev-1' },
      current: { kind: 'local' },
    })

    expect(transport.mobile).toHaveLength(0)
  })

  it('dispose stops receiving from new sessions', () => {
    const source = makeSource()
    const transport = makeTransport()
    const coord = new PresenceCoordinator(source, transport)
    coord.dispose()
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({ type: 'subscriber_added', sessionId: 's1', deviceId: 'dev-A' })
    expect(transport.sent).toHaveLength(0)
  })
})
