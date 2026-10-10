import { afterEach, describe, it, expect, vi } from 'vitest'
import { bindControlActor } from '@superone/runtime/lease'
import { terminalLeaseAuthority } from './terminal-lease.test-fixtures'
import { TerminalLease } from './terminal-lease'

afterEach(() => vi.useRealTimers())
function fixture() {
  const authority = terminalLeaseAuthority()
  const lease = new TerminalLease(authority, 't')
  const acquire = (deviceId: string) => {
    const actor = `phone:${deviceId}`
    return bindControlActor(authority.leases, { clientSessionId: actor,
      holderClientId: `desktop:${authority.environmentId}`, delegate: actor, yields: false })
      .acquire({ resource: lease.ref, holderClientId: actor, ttlMs: 60_000 })
  }
  return { lease, acquire }
}

describe('TerminalLease native writer projection', () => {
  it('allows a local window until a phone holds the resource', () => {
    const { lease, acquire } = fixture()
    expect(lease.isWritableBy('local')).toBe(true)
    acquire('a')
    expect(lease.ownerDeviceId).toBe('a')
    expect(lease.isWritableBy('a')).toBe(true)
    expect(lease.isWritableBy('b')).toBe(false)
    expect(lease.isWritableBy('local')).toBe(false)
    expect(() => acquire('b')).toThrow()
  })
  it('explicit local reclaim preempts the exact phone grant', () => {
    const { lease, acquire } = fixture()
    acquire('a')
    lease.reclaimLocal(7)
    expect(lease.ownerDeviceId).toBeNull()
    expect(lease.isWritableBy('local')).toBe(true)
  })
  it('disconnect releases only the matching delegate', () => {
    const { lease, acquire } = fixture()
    acquire('a')
    lease.handleDeviceDisconnected('b')
    expect(lease.ownerDeviceId).toBe('a')
    lease.handleDeviceDisconnected('a')
    expect(lease.ownerDeviceId).toBeNull()
  })
  it('notifies a reader when the native grant expires', () => {
    vi.useFakeTimers()
    const { lease, acquire } = fixture()
    const changed = vi.fn()
    lease.onChange(changed)
    acquire('a')
    vi.advanceTimersByTime(60_000)
    expect(lease.isWritableBy('a')).toBe(false)
    expect(changed).toHaveBeenLastCalledWith({ kind: 'local' })
  })
  it('same-delegate renewal does not publish an owner transition', () => {
    const { lease, acquire } = fixture()
    const changed = vi.fn()
    lease.onChange(changed)
    acquire('a')
    acquire('a')
    lease.reclaimLocal(7)
    expect(changed).toHaveBeenCalledTimes(2)
  })
})
