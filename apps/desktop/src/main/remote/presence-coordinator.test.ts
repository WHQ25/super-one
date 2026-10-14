import { describe, expect, it, vi } from 'vitest'
import { PresenceCoordinator } from './presence-coordinator'
import { acquirePhoneControl, controlLeaseAuthority } from '../control-lease.test-fixtures'
import { SessionLease } from '../session/session-lease'
import { runWindowControl } from '../session/control-context'
import type { Session } from '../session/types'

function fixture(harnessId: 'claude' | 'codex' | 'acp' = 'claude') {
  const authority = { ...controlLeaseAuthority(), names: {
    controller: (id: string) => id === 'controller-a' ? 'Desktop A' : null,
    phone: (id: string) => id === 'a' ? 'iPhone A' : null,
  } }
  const lease = new SessionLease('s', authority)
  const session = { id: 's', projectPath: '/project', lease,
    snapshot: { harnessId, acpAgentId: harnessId === 'acp' ? 'grok-build' : null, worktreePath: '/checkout', gitBranch: 'topic' },
    onLifecycle: lease.onLifecycle.bind(lease) } as unknown as Session
  const broadcast = vi.fn()
  const disposeSource = vi.fn()
  const presence = new PresenceCoordinator({ onSession: listener => { listener(session); return disposeSource } }, { broadcastToRenderer: broadcast })
  return { authority, lease, broadcast, presence, disposeSource }
}

describe('native session control presence', () => {
  it.each(['claude', 'codex', 'acp'] as const)('projects the authoritative %s proof and session identity', harnessId => {
    const f = fixture(harnessId)
    const grant = acquirePhoneControl(f.authority, 's', 'a')
    expect(f.broadcast).toHaveBeenCalledWith({ type: 'session_control_changed', projectPath: '/project', sessionId: 's', lease: grant,
      holder: { kind: 'phone', label: 'iPhone A' }, harnessId, acpAgentId: harnessId === 'acp' ? 'grok-build' : null, worktreePath: '/checkout', gitBranch: 'topic' })
    expect(f.broadcast).toHaveBeenCalledTimes(1)
    acquirePhoneControl(f.authority, 's', 'a')
    expect(f.broadcast).toHaveBeenCalledTimes(1)
    f.lease.releaseDelegate('phone:a')
    expect(f.broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ lease: null }))
    f.presence.dispose()
  })
  it('distinguishes a yielding window grant from a phone grant and revokes on expiry', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture()
      runWindowControl(7, () => f.lease.assertMutation())
      expect(f.broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ lease: expect.objectContaining({ delegate: 'window:7' }) }))
      expect(f.lease.isExternal).toBe(false)
      acquirePhoneControl(f.authority, 's', 'a')
      expect(f.lease.isExternal).toBe(true)
      await vi.advanceTimersByTimeAsync(60_001)
      expect(f.broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ lease: null }))
      expect(f.lease.isExternal).toBe(false)
      f.presence.dispose()
    } finally { vi.useRealTimers() }
  })
  it('tells the window, a phone and a controller desktop apart by the lease and names them', () => {
    const f = fixture()
    runWindowControl(7, () => f.lease.assertMutation())
    expect(f.broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ holder: { kind: 'window', label: null } }))
    const grant = f.authority.leases.acquire({ resource: f.lease.resource, holderClientId: 'controller-a', yields: 'holder', ttlMs: 60_000 })
    expect(f.broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ lease: grant, holder: { kind: 'controller', label: 'Desktop A' } }))
    // A phone the controller relays is the controller's, not one of this desktop's phones.
    f.authority.leases.revoke(f.lease.resource)
    f.authority.leases.acquire({ resource: f.lease.resource, holderClientId: 'controller-a', delegate: 'phone:a', ttlMs: 60_000 })
    expect(f.broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ holder: { kind: 'controller', label: 'Desktop A' } }))
    expect(f.lease.isExternal).toBe(true)
    f.presence.dispose()
  })
  it('retires a disposed session and the source without keeping control listeners', () => {
    const f = fixture()
    acquirePhoneControl(f.authority, 's', 'a')
    f.lease.dispose()
    expect(f.broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ lease: null }))
    const count = f.broadcast.mock.calls.length
    acquirePhoneControl(f.authority, 's', 'b')
    expect(f.broadcast).toHaveBeenCalledTimes(count)
    f.presence.dispose()
    expect(f.disposeSource).toHaveBeenCalledTimes(1)
  })
})
