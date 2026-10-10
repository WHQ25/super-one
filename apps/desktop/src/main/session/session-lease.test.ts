import { describe, expect, it, vi } from 'vitest'
import { controlLeaseAuthority, acquirePhoneControl } from '../control-lease.test-fixtures'
import { SessionLease } from './session-lease'
import { runFencedSessionControl, runRpcControl, runWindowControl } from './control-context'

describe('desktop session leases', () => {
  it('yields a window grant to a phone and refuses another phone, window and stolen proof', () => {
    const authority = controlLeaseAuthority()
    const session = new SessionLease('s', authority)
    runWindowControl(1, () => session.assertMutation())
    const window = authority.leases.get(session.resource)!
    const phone = acquirePhoneControl(authority, 's', 'a')
    expect(phone.delegate).toBe('phone:a')
    expect(() => authority.leases.assertValid(window)).toThrow('stale lease')
    expect(() => acquirePhoneControl(authority, 's', 'b')).toThrow('held by another device')
    expect(() => runWindowControl(2, () => session.assertMutation())).toThrow('held by another device')
    expect(() => runFencedSessionControl('s', 'phone:b', phone, () => session.assertMutation())).toThrow('lease delegate mismatch')
    expect(() => runFencedSessionControl('s', 'phone:a', phone, () => session.assertMutation())).not.toThrow()
  })

  it('keeps the same proof across an await and refuses it after takeover', async () => {
    const authority = controlLeaseAuthority()
    const session = new SessionLease('s', authority)
    let resume!: () => void
    const wait = new Promise<void>((resolve) => { resume = resolve })
    const mutation = runWindowControl(1, async () => {
      session.assertMutation()
      await wait
      session.assertMutation()
    })
    acquirePhoneControl(authority, 's', 'a')
    resume()
    await expect(mutation).rejects.toThrow('stale lease')
    session.releaseDelegate('phone:a')
    runWindowControl(1, () => session.assertMutation())
  })

  it('requires explicit RPC control and isolates concurrent request identities', async () => {
    const authority = controlLeaseAuthority()
    const session = new SessionLease('s', authority)
    const phone = acquirePhoneControl(authority, 's', 'a')
    await Promise.all([
      runRpcControl('phone:a', { sessionId: 's', ...phone }, async () => { await Promise.resolve(); session.assertMutation() }),
      runRpcControl('phone:b', {}, async () => { await Promise.resolve(); expect(() => session.assertMutation()).toThrow('control proof required') }),
    ])
  })

  it('expires control, publishes its authority projection and keeps host work available', async () => {
    vi.useFakeTimers()
    try {
      const authority = controlLeaseAuthority()
      const session = new SessionLease('s', authority)
      acquirePhoneControl(authority, 's', 'a')
      session.assertMutation()
      const events: unknown[] = []
      session.onLifecycle((event) => events.push(event))
      await vi.advanceTimersByTimeAsync(60_001)
      expect(session.current).toBeNull()
      expect(events).toContainEqual(expect.objectContaining({ type: 'control_changed', lease: null }))
      runWindowControl(1, () => session.assertMutation())
      session.dispose()
      expect(authority.leases.get(session.resource)).toBeNull()
    } finally { vi.useRealTimers() }
  })
})
