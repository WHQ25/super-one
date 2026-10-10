import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControlLease } from '@superone/shared/environment/lease'
import { PhoneControlLeases } from './control-leases'

afterEach(() => vi.useRealTimers())
const resource = { environmentId: 'desk', sessionId: 's' }
const grant = (id = 'l'): ControlLease => ({ leaseId: id, resource, holderClientId: 'desktop:desk', delegate: 'phone:a', generation: '1', expiresAt: new Date(Date.now() + 60_000).toISOString() })

describe('phone control grants', () => {
  it('invalidates only the exact grant and immediately cancels its renewal', async () => {
    vi.useFakeTimers()
    let next = 0
    const lost = vi.fn()
    const control = new PhoneControlLeases(vi.fn(async () => grant(`l${++next}`)) as never, lost)
    const old = await control.acquire(resource)
    const current = await control.acquire(resource)
    control.invalidate(resource, old)
    expect(control.proof(resource).leaseId).toBe(current.leaseId)
    expect(lost).not.toHaveBeenCalled()
    control.invalidate(resource, current)
    control.invalidate(resource, current)
    expect(lost).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    expect(() => control.proof(resource)).toThrow('control is required')
    control.close()
  })

  it('refuses an acquire receipt whose grant was revoked before it arrived', async () => {
    let reply!: (value: ControlLease) => void
    const control = new PhoneControlLeases(vi.fn(() => new Promise<ControlLease>(resolve => { reply = resolve })) as never)
    const waiting = control.acquire(resource)
    control.invalidate(resource, grant())
    reply(grant())
    await expect(waiting).rejects.toMatchObject({ code: 'lease_stale' })
    expect(() => control.proof(resource)).toThrow('control is required')
    control.close()
  })

  it('releases an old operation proof without discarding the newer grant or its renewal', async () => {
    vi.useFakeTimers()
    let acquisitions = 0
    const rpc = vi.fn(async (method: string) => method === 'session.acquireControl' ? grant(`l${++acquisitions}`) : null)
    const control = new PhoneControlLeases(rpc as never)
    const old = await control.acquire(resource)
    await control.acquire(resource)
    await control.release(resource, { leaseId: old.leaseId, generation: old.generation })
    expect(control.proof(resource)).toEqual({ leaseId: 'l2', generation: '1' })
    expect(rpc).toHaveBeenLastCalledWith('session.releaseControl', { leaseId: 'l1', generation: '1' }, { environmentId: 'desk' })
    expect(vi.getTimerCount()).toBe(1)
    control.close()
  })
  it('renews the admitted proof and never reacquires after revocation', async () => {
    vi.useFakeTimers()
    const rpc = vi.fn(async (method: string) => {
      if (method === 'session.acquireControl') return grant()
      throw Object.assign(new Error('stale lease'), { code: 'lease_stale' })
    })
    const lost = vi.fn()
    const control = new PhoneControlLeases(rpc as never, lost)
    await control.acquire(resource)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(rpc).toHaveBeenLastCalledWith('session.renewControl', { leaseId: 'l', generation: '1', ttlMs: 60_000 }, { environmentId: 'desk' })
    expect(() => control.proof(resource)).toThrow('control is required')
    expect(lost).toHaveBeenCalledOnce()
    await expect(control.call(resource, 'session.send', { text: 'stale' })).rejects.toMatchObject({ code: 'lease_required' })
    expect(rpc.mock.calls.filter(([method]) => method === 'session.acquireControl')).toHaveLength(1)
    control.close()
  })

  it('captures the exact proof before a call and protects a newer grant from a late stale error', async () => {
    let reject!: (error: Error) => void
    let acquisitions = 0
    const rpc = vi.fn((method: string) => {
      if (method === 'session.acquireControl') return Promise.resolve(grant(`l${++acquisitions}`))
      return new Promise((_resolve, fail) => { reject = fail })
    })
    const control = new PhoneControlLeases(rpc as never)
    await control.acquire(resource)
    const sent = control.call(resource, 'session.send', { text: 'hi', leaseId: 'forged', sessionId: 'other' })
    const rejected = expect(sent).rejects.toMatchObject({ code: 'lease_stale' })
    expect(rpc).toHaveBeenLastCalledWith('session.send', { text: 'hi', sessionId: 's', leaseId: 'l1', generation: '1' }, { environmentId: 'desk' })
    await control.acquire(resource)
    reject(Object.assign(new Error('stale'), { code: 'lease_stale' }))
    await rejected
    expect(control.proof(resource)).toEqual({ leaseId: 'l2', generation: '1' })
    control.close()
  })

  it('clears timers with the connection and cannot install an acquisition that finishes after close', async () => {
    vi.useFakeTimers()
    let resolve!: (lease: ControlLease) => void
    const control = new PhoneControlLeases((() => new Promise<ControlLease>((done) => { resolve = done })) as never)
    const pending = control.acquire(resource)
    control.close()
    resolve(grant())
    await expect(pending).rejects.toThrow('superseded')
    expect(vi.getTimerCount()).toBe(0)
    expect(() => control.proof(resource)).toThrow('control is required')
  })
})
