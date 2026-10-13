import { describe, expect, it, vi } from 'vitest'
import { controlLeaseAuthority, acquirePhoneControl } from '../control-lease.test-fixtures'
import { SessionLease } from './session-lease'
import { Session } from './session'
import { runFencedSessionControl, runRpcControl, runWindowControl } from './control-context'

describe('desktop session leases', () => {
  it('passes the original OAuth proof into async backend work and refuses it after takeover', async () => {
    const authority = controlLeaseAuthority(), lease = new SessionLease('s', authority)
    let resume!: () => void
    const wait = new Promise<void>(resolve => { resume = resolve })
    const nativeMutation = vi.fn()
    const session = { lease, assertStarted: () => {}, touchRuntimeActivity: () => {}, backend: {
      authenticateMcp: async (_name: string, assertControl?: () => void) => { await wait; assertControl?.(); nativeMutation() },
    } } as unknown as Session
    const flow = runWindowControl(1, () => Session.prototype.authenticateMcp.call(session, 'fixture'))
    const refused = expect(flow).rejects.toThrow('stale lease')
    acquirePhoneControl(authority, 's', 'a')
    resume()
    await refused
    expect(nativeMutation).not.toHaveBeenCalled()
    lease.dispose()
  })
  it('fences a captured mutation proof even after entering host-owned backend work', () => {
    const authority = controlLeaseAuthority(), session = new SessionLease('s', authority)
    const captured = runWindowControl(1, () => session.captureMutation())
    expect(() => captured()).not.toThrow()
    acquirePhoneControl(authority, 's', 'a')
    expect(() => captured()).toThrow('stale lease')
    expect(() => session.assertMutation()).not.toThrow()
  })
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

  it('renews the call grant across navigation, but never reacquires a revoked grant', async () => {
    vi.useFakeTimers()
    try {
      const authority = controlLeaseAuthority()
      const session = new SessionLease('s', authority)
      const phone = acquirePhoneControl(authority, 's', 'a')
      const release = runFencedSessionControl('s', 'phone:a', phone, () => session.retainVoice('a'))
      expect(() => session.retainVoice('b')).toThrow('session control')
      await vi.advanceTimersByTimeAsync(90_000)
      expect(session.current).toMatchObject({ leaseId: phone.leaseId, generation: phone.generation })
      session.revoke()
      runWindowControl(2, () => session.assertMutation())
      const window = session.current!
      await vi.advanceTimersByTimeAsync(20_000)
      expect(session.current).toEqual(window)
      release()
    } finally { vi.useRealTimers() }
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
