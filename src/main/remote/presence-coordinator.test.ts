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
  readonly snapshot: { harnessId: 'claude' | 'codex' }
  owner: { kind: 'local' } | { kind: 'remote'; deviceId: string } = { kind: 'local' }
  subscribers = new Set<string>()
  private listeners = new Set<(e: SessionLifecycleEvent) => void>()

  constructor(id: string, projectPath: string, harnessId: 'claude' | 'codex' = 'claude') {
    this.id = id
    this.projectPath = projectPath
    this.snapshot = { harnessId }
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

function makeSource(): PresenceSessionSource & { add: (s: FakeSession) => void } {
  const sessions: FakeSession[] = []
  let handler: ((session: Session) => void) | null = null
  return {
    onSession(h) {
      handler = h
      for (const s of sessions) h(s as unknown as Session)
      return () => { handler = null }
    },
    add(s) {
      sessions.push(s)
      if (handler) handler(s as unknown as Session)
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
      { type: 'remote_session_start', remoteProjectPath: '/proj/A', remoteSessionId: 's1', harnessId: 'claude' },
    ])
  })

  it('carries harnessId=codex when the session is a codex session', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s-codex', '/proj/A', 'codex')
    source.add(s)
    s.emit({
      type: 'owner_changed', sessionId: 's-codex',
      previous: { kind: 'local' },
      current: { kind: 'remote', deviceId: 'dev-A' },
    })
    expect(transport.sent).toEqual([
      { type: 'remote_session_start', remoteProjectPath: '/proj/A', remoteSessionId: 's-codex', harnessId: 'codex' },
    ])
  })

  it('owner_changed remote→local with reason desktop_kick sends session_kicked to previous owner', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({
      type: 'owner_changed', sessionId: 's1',
      previous: { kind: 'remote', deviceId: 'dev-A' },
      current: { kind: 'local' },
      reason: 'desktop_kick',
    })
    expect(transport.sent).toEqual([
      { type: 'remote_session_end', remoteProjectPath: '/proj/A', remoteSessionId: 's1' },
    ])
    expect(transport.mobile).toEqual([
      { event: { type: 'session_kicked', sessionId: 's1' }, targets: ['dev-A'] },
    ])
  })

  it('owner_changed remote→local with reason self_leave is silent on mobile', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({
      type: 'owner_changed', sessionId: 's1',
      previous: { kind: 'remote', deviceId: 'dev-A' },
      current: { kind: 'local' },
      reason: 'self_leave',
    })
    expect(transport.mobile).toEqual([])
  })

  it('owner_changed remote→local with reason self_switch is silent on mobile', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({
      type: 'owner_changed', sessionId: 's1',
      previous: { kind: 'remote', deviceId: 'dev-A' },
      current: { kind: 'local' },
      reason: 'self_switch',
    })
    expect(transport.mobile).toEqual([])
  })

  it('owner_changed remote→local with reason session_closed sends session_closed to mobile', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({
      type: 'owner_changed', sessionId: 's1',
      previous: { kind: 'remote', deviceId: 'dev-A' },
      current: { kind: 'local' },
      reason: 'session_closed',
    })
    expect(transport.mobile).toEqual([
      { event: { type: 'session_closed', sessionId: 's1' }, targets: ['dev-A'] },
    ])
  })

  it('owner_changed remote→local with reason transport_disconnect is silent on mobile', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({
      type: 'owner_changed', sessionId: 's1',
      previous: { kind: 'remote', deviceId: 'dev-A' },
      current: { kind: 'local' },
      reason: 'transport_disconnect',
    })
    expect(transport.mobile).toEqual([])
  })

  it('emits remote_session_start with isSubscribe on subscriber_added', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({ type: 'subscriber_added', sessionId: 's1', deviceId: 'dev-B' })
    expect(transport.sent).toEqual([
      { type: 'remote_session_start', remoteProjectPath: '/proj/A', remoteSessionId: 's1', isSubscribe: true, harnessId: 'claude' },
    ])
  })

  it('subscriber_removed with desktop_kick reason sends session_kicked', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({ type: 'subscriber_removed', sessionId: 's1', deviceId: 'dev-B', reason: 'desktop_kick' })
    expect(transport.sent).toEqual([
      { type: 'remote_session_end', remoteProjectPath: '/proj/A', remoteSessionId: 's1', isSubscribe: true },
    ])
    expect(transport.mobile).toEqual([
      { event: { type: 'session_kicked', sessionId: 's1' }, targets: ['dev-B'] },
    ])
  })

  it('subscriber_removed with self_leave reason is silent on mobile', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({ type: 'subscriber_removed', sessionId: 's1', deviceId: 'dev-B', reason: 'self_leave' })
    expect(transport.mobile).toEqual([])
  })

  it('subscriber_removed with self_switch reason is silent on mobile', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({ type: 'subscriber_removed', sessionId: 's1', deviceId: 'dev-B', reason: 'self_switch' })
    expect(transport.mobile).toEqual([])
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
      { type: 'remote_session_start', remoteProjectPath: '/proj/B', remoteSessionId: 's2', isSubscribe: true, harnessId: 'claude' },
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

  it('treats remote → remote (different device) as a fresh start; previous owner gets session_kicked when reason is desktop_kick', () => {
    const source = makeSource()
    const transport = makeTransport()
    new PresenceCoordinator(source, transport)
    const s = new FakeSession('s1', '/proj/A')
    source.add(s)
    s.emit({
      type: 'owner_changed', sessionId: 's1',
      previous: { kind: 'remote', deviceId: 'dev-A' },
      current: { kind: 'remote', deviceId: 'dev-B' },
      reason: 'desktop_kick',
    })
    expect(transport.sent).toEqual([
      { type: 'remote_session_start', remoteProjectPath: '/proj/A', remoteSessionId: 's1', harnessId: 'claude' },
    ])
    expect(transport.mobile).toEqual([
      { event: { type: 'session_kicked', sessionId: 's1' }, targets: ['dev-A'] },
    ])
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
