import { describe, expect, it, vi } from 'vitest'
import type { ControlLease } from '@superone/shared/environment'
import { RoutedPhoneControl } from './routed-phone-control'
import { RoutedPhoneGrants } from './routed-phone-grants'

const resource = { environmentId: 'node', sessionId: 's' }
function fixture() {
  const control = new RoutedPhoneControl()
  const grants = new RoutedPhoneGrants(control)
  const lease: ControlLease = { resource, leaseId: 'l', generation: '1', delegate: 'phone:a',
    holderClientId: 'root', expiresAt: new Date(Date.now() + 60_000).toISOString() }
  const remember = (value = lease) => control.remember('phone:a', 'node', 'session', 's', value)
  return { control, grants, lease, remember }
}

describe('routed grant retirement', () => {
  it('refuses a proof revoked before its admission receipt and ignores loss for an older proof', async () => {
    const f = fixture()
    f.grants.invalidateProof({ type: 'control_lost', resource, leaseId: 'l', generation: '1' })
    await expect(f.grants.attach(f.remember(), { active: true }, async () => {})).rejects.toMatchObject({ code: 'lease_stale' })
    const grant = f.remember({ ...f.lease, leaseId: 'next', generation: '2' })
    const owner = { active: true, push: vi.fn() }
    await f.grants.attach(grant, owner, async () => {})
    f.grants.invalidateProof({ type: 'control_lost', resource, leaseId: 'l', generation: '1' })
    expect(f.control.isCurrent(grant)).toBe(true)
    expect(owner.push).not.toHaveBeenCalled()
    f.grants.invalidateProof({ type: 'control_lost', resource, leaseId: 'next', generation: '2' })
    expect(owner.push).toHaveBeenCalledTimes(1)
    expect(f.control.isCurrent(grant)).toBe(false)
  })
  it('keeps a proof used by another live link and releases it when its last link leaves', async () => {
    const f = fixture()
    const a = { active: true }, b = { active: true }
    const release = vi.fn(async () => {})
    const first = f.remember()
    await f.grants.attach(first, a, release)
    const second = f.remember({ ...f.lease, expiresAt: new Date(Date.now() + 90_000).toISOString() })
    expect(second).toBe(first)
    await f.grants.attach(second, b, release)
    f.grants.detach(a)
    await f.grants.run(resource, async () => {})
    expect(release).not.toHaveBeenCalled()
    expect(f.control.isCurrent(second)).toBe(true)
    f.grants.detach(b)
    await f.grants.run(resource, async () => {})
    expect(release).toHaveBeenCalledTimes(1)
    expect(f.control.isCurrent(second)).toBe(false)
  })
  it('releases an acquire receipt that arrives after its connection left', async () => {
    const f = fixture()
    const release = vi.fn(async () => {})
    const grant = f.remember()
    await expect(f.grants.attach(grant, { active: false }, release)).rejects.toMatchObject({ code: 'unavailable' })
    expect(release).toHaveBeenCalledTimes(1)
    expect(f.control.isCurrent(grant)).toBe(false)
  })
  it('orders pending retirement before reacquire, so an old proof cannot release the replacement', async () => {
    const f = fixture()
    const owner = { active: true }
    let resume!: () => void
    const gate = new Promise<void>(resolve => { resume = resolve })
    const release = vi.fn(() => gate)
    await f.grants.attach(f.remember(), owner, release)
    f.grants.detach(owner)
    const acquire = vi.fn(async () => {
      const grant = f.remember({ ...f.lease, leaseId: 'new', generation: '2' })
      await f.grants.attach(grant, { active: true }, release)
      return grant
    })
    const replacing = f.grants.run(resource, acquire)
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    expect(acquire).not.toHaveBeenCalled()
    resume()
    expect(f.control.isCurrent(await replacing)).toBe(true)
    expect(release).toHaveBeenCalledTimes(1)
  })
  it('kicks exact session proofs on every owning connection before waiting for the authority', async () => {
    const f = fixture()
    const a = { active: true, push: vi.fn() }, b = { active: true, push: vi.fn() }
    const grant = f.remember()
    await f.grants.attach(grant, a, async () => {})
    await f.grants.attach(grant, b, async () => {})
    await f.grants.releaseSessions('other')
    expect(a.push).not.toHaveBeenCalled()
    await f.grants.releaseSessions('s')
    const event = { type: 'client', event: { type: 'control_lost', resource, leaseId: 'l', generation: '1' } }
    expect(a.push).toHaveBeenCalledWith(event)
    expect(b.push).toHaveBeenCalledWith(event)
    expect(f.control.isCurrent(grant)).toBe(false)
  })
})
