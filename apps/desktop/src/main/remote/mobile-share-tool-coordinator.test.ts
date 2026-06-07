import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { MobileShareToolCoordinator, type MobileShareToolControl } from './mobile-share-tool-coordinator'
import type { PresenceSessionSource } from './presence-coordinator'
import type { Session, SessionLifecycleEvent } from '../session/types'

class FakeSession {
  readonly id: string
  subscribers = new Set<string>()
  private listeners = new Set<(e: SessionLifecycleEvent) => void>()

  constructor(id: string) { this.id = id }

  onLifecycle(handler: (e: SessionLifecycleEvent) => void): () => void {
    this.listeners.add(handler)
    return () => { this.listeners.delete(handler) }
  }

  subscribe(deviceId: string): void {
    this.subscribers.add(deviceId)
    this.emit({ type: 'subscriber_added', sessionId: this.id, deviceId })
  }

  unsubscribe(deviceId: string): void {
    this.subscribers.delete(deviceId)
    this.emit({ type: 'subscriber_removed', sessionId: this.id, deviceId })
  }

  close(): void {
    this.subscribers.clear()
    this.emit({ type: 'closed', sessionId: this.id })
  }

  hasListeners(): boolean { return this.listeners.size > 0 }

  private emit(evt: SessionLifecycleEvent): void {
    for (const cb of this.listeners) cb(evt)
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
      handler?.(s as unknown as Session)
    },
  }
}

function makeControl() {
  const enabled: string[] = []
  const disabled: string[] = []
  const control: MobileShareToolControl = {
    enable: (id) => enabled.push(id),
    disable: (id) => disabled.push(id),
  }
  return { control, enabled, disabled }
}

describe('MobileShareToolCoordinator', () => {
  it('enables the tool only when the first device subscribes', () => {
    const source = makeSource()
    const { control, enabled } = makeControl()
    new MobileShareToolCoordinator(source, control)

    const s = new FakeSession('s1')
    source.add(s)
    s.subscribe('dev-A')
    s.subscribe('dev-B')

    expect(enabled).toEqual(['s1'])
  })

  it('disables the tool only when the last device unsubscribes', () => {
    const source = makeSource()
    const { control, disabled } = makeControl()
    new MobileShareToolCoordinator(source, control)

    const s = new FakeSession('s1')
    source.add(s)
    s.subscribe('dev-A')
    s.subscribe('dev-B')

    s.unsubscribe('dev-A')
    expect(disabled).toEqual([])

    s.unsubscribe('dev-B')
    expect(disabled).toEqual(['s1'])
  })

  it('disables and detaches the session listener when the session closes', () => {
    const source = makeSource()
    const { control, disabled } = makeControl()
    new MobileShareToolCoordinator(source, control)

    const s = new FakeSession('s1')
    source.add(s)
    s.subscribe('dev-A')
    s.close()

    expect(disabled).toEqual(['s1'])
    expect(s.hasListeners()).toBe(false)
  })
})
