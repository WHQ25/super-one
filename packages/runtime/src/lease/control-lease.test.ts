import { afterEach, describe, expect, it } from 'vitest'
import { openNodeDatabase, type NodeDatabase } from '../db'
import { ControlLeaseService } from './control-lease'

const dbs: NodeDatabase[] = []
afterEach(() => { for (const db of dbs.splice(0)) db.close() })

function leases(): ControlLeaseService {
  const db = openNodeDatabase(':memory:')
  dbs.push(db)
  return new ControlLeaseService(db)
}

const resource = { environmentId: 'env', sessionId: 's' }
const refusal = (fn: () => unknown) => { try { fn(); return null } catch (err) { return (err as { code?: string }).code } }

describe('ControlLeaseService delegates', () => {
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
})
