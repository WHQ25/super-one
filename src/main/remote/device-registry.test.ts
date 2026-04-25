import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { DeviceRegistry } from './device-registry'
import type { Session, SessionManager } from '../session/types'

function makeFakeSession(id: string): Session {
  const subscribers = new Set<string>()
  let owner: Session['owner'] = { kind: 'local' }
  return {
    id,
    get owner() { return owner },
    get subscribers() { return subscribers },
    claim(o) { owner = o },
    release(deviceId) {
      if (owner.kind === 'remote' && owner.deviceId === deviceId) owner = { kind: 'local' }
    },
    subscribe(deviceId) { subscribers.add(deviceId) },
    unsubscribe(deviceId) { subscribers.delete(deviceId) },
  } as unknown as Session
}

function makeFakeManager(sessions: Session[]): SessionManager {
  return {
    forEachSession(fn) { sessions.forEach(fn) },
  } as unknown as SessionManager
}

describe('DeviceRegistry', () => {
  it('releases sessions owned by the disconnected device', () => {
    const s1 = makeFakeSession('s1')
    const s2 = makeFakeSession('s2')
    s1.claim({ kind: 'remote', deviceId: 'dev-A' })
    s2.claim({ kind: 'remote', deviceId: 'dev-B' })
    const registry = new DeviceRegistry(makeFakeManager([s1, s2]))

    registry.handleDeviceDisconnected('dev-A')

    expect(s1.owner.kind).toBe('local')
    expect(s2.owner).toEqual({ kind: 'remote', deviceId: 'dev-B' })
  })

  it('unsubscribes the disconnected device from every session it was viewing', () => {
    const s1 = makeFakeSession('s1')
    const s2 = makeFakeSession('s2')
    s1.subscribe('dev-A')
    s1.subscribe('dev-B')
    s2.subscribe('dev-A')
    const registry = new DeviceRegistry(makeFakeManager([s1, s2]))

    registry.handleDeviceDisconnected('dev-A')

    expect(s1.subscribers.has('dev-A')).toBe(false)
    expect(s1.subscribers.has('dev-B')).toBe(true)
    expect(s2.subscribers.has('dev-A')).toBe(false)
  })

  it('handles a device that is both owner and subscriber on the same session', () => {
    const s = makeFakeSession('s1')
    s.claim({ kind: 'remote', deviceId: 'dev-A' })
    s.subscribe('dev-A')
    const registry = new DeviceRegistry(makeFakeManager([s]))

    registry.handleDeviceDisconnected('dev-A')

    expect(s.owner.kind).toBe('local')
    expect(s.subscribers.size).toBe(0)
  })

  it('is no-op for an unknown device', () => {
    const s = makeFakeSession('s1')
    s.claim({ kind: 'remote', deviceId: 'dev-A' })
    s.subscribe('dev-A')
    const registry = new DeviceRegistry(makeFakeManager([s]))

    registry.handleDeviceDisconnected('dev-X')

    expect(s.owner).toEqual({ kind: 'remote', deviceId: 'dev-A' })
    expect(s.subscribers.has('dev-A')).toBe(true)
  })
})
