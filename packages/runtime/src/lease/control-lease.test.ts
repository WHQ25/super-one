import { afterEach, describe, expect, it, vi } from 'vitest'
import { openNodeDatabase, type NodeDatabase } from '../db'
import { ControlLeaseService } from './control-lease'

const dbs: NodeDatabase[] = []
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const db of dbs.splice(0)) db.close() })

function leases(): ControlLeaseService {
  const db = openNodeDatabase(':memory:')
  dbs.push(db)
  return new ControlLeaseService(db)
}

const resource = { environmentId: 'env', sessionId: 's' }
const refusal = (fn: () => unknown) => { try { fn(); return null } catch (err) { return (err as { code?: string }).code } }

describe('ControlLeaseService delegates', () => {
  it('notifies lease expiry and reschedules it on renewal', () => {
    vi.useFakeTimers()
    const service = leases()
    const changed = vi.fn()
    service.onChange(changed)
    const phone = service.acquire({ resource, holderClientId: 'desktop', delegate: 'phone-a', ttlMs: 1000 })
    vi.advanceTimersByTime(500)
    service.renew({ ...phone, ttlMs: 1000 })
    vi.advanceTimersByTime(500)
    expect(service.get(resource)).not.toBeNull()
    expect(changed).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(500)
    expect(service.get(resource)).toBeNull()
    expect(changed).toHaveBeenLastCalledWith(resource, null)
    service.dispose()
  })
  it('ends a race of two phones and the desktop window relaying them with one holder', () => {
    const service = leases()
    const window = service.acquire({ resource, holderClientId: 'desktop', yields: true })
    const phoneA = service.acquire({ resource, holderClientId: 'desktop', delegate: 'phone-a' })
    expect(refusal(() => service.acquire({ resource, holderClientId: 'desktop', delegate: 'phone-b' }))).toBe('failed_precondition')
    expect(refusal(() => service.acquire({ resource, holderClientId: 'desktop', yields: true }))).toBe('failed_precondition')

    // The window's lease was taken over: it is fenced off.
    expect(phoneA.generation).not.toBe(window.generation)
    expect(refusal(() => service.assertValid({ resource, holderClientId: 'desktop', leaseId: window.leaseId, generation: window.generation }))).toBe('lease_stale')
    expect(() => service.assertValid({ resource, holderClientId: 'desktop', leaseId: phoneA.leaseId, generation: phoneA.generation })).not.toThrow()
  })

  it('hands the session back once the phone leaves', () => {
    const service = leases()
    const phone = service.acquire({ resource, holderClientId: 'desktop', delegate: 'phone-a' })
    service.release(phone.leaseId, phone.generation, 'desktop')
    const window = service.acquire({ resource, holderClientId: 'desktop', yields: true })
    expect(window.leaseId).not.toBe(phone.leaseId)
  })

  it('renews the same delegate in place and refuses another client outright', () => {
    const service = leases()
    const first = service.acquire({ resource, holderClientId: 'desktop', delegate: 'phone-a' })
    expect(service.acquire({ resource, holderClientId: 'desktop', delegate: 'phone-a' }).leaseId).toBe(first.leaseId)
    expect(refusal(() => service.acquire({ resource, holderClientId: 'other-desktop', yields: true }))).toBe('failed_precondition')
  })

  it('retains the delegate when renewing and fences another delegate', () => {
    const service = leases()
    const phone = service.acquire({ resource, holderClientId: 'desktop', delegate: 'phone-a' })
    expect(service.renew({ ...phone, delegate: 'phone-a' })).toMatchObject({ delegate: 'phone-a' })
    expect(refusal(() => service.assertValid({ ...phone, resource, delegate: 'phone-b' }))).toBe('lease_stale')
    expect(refusal(() => service.renew({ ...phone, delegate: 'phone-b' }))).toBe('lease_stale')
    expect(refusal(() => service.release(phone.leaseId, phone.generation, 'desktop', 'phone-b'))).toBe('lease_stale')
    expect(service.get(resource)).toMatchObject({ leaseId: phone.leaseId, delegate: 'phone-a' })
  })

  it('publishes authoritative control changes and hides revoked, expired and prior-epoch leases', () => {
    const service = leases()
    const changes: unknown[] = []
    const off = service.onChange((ref, lease) => changes.push({ ref, lease }))
    const phone = service.acquire({ resource, holderClientId: 'desktop', delegate: 'phone-a' })
    expect(service.get(resource)).toEqual(phone)
    service.revoke(resource)
    expect(service.get(resource)).toBeNull()
    expect(changes).toEqual([{ ref: resource, lease: phone }, { ref: resource, lease: null }])
    off()
    service.acquire({ resource, holderClientId: 'desktop' })
    expect(changes).toHaveLength(2)
    const restarted = new ControlLeaseService(dbs.at(-1)!)
    expect(restarted.get(resource)).toBeNull()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)
    expect(service.get(resource)).toBeNull()
  })
})
