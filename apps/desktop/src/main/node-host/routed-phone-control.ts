import type { ControlLease } from '@superone/shared/environment'

const fail = (code: string, message: string) => Object.assign(new Error(message), { code })
const key = (actor: string, environmentId: string, kind: string, id: string) => JSON.stringify([actor, environmentId, kind, id])
export type RoutedGrant = { actor: string; key: string; lease: ControlLease }

/** The desktop's node credential is shared; each delegated grant belongs to exactly one paired phone. */
export class RoutedPhoneControl {
  private readonly grants = new Map<string, RoutedGrant>()

  remember(actor: string, environmentId: string, kind: 'session' | 'terminal', id: string, lease: ControlLease): RoutedGrant {
    const resourceId = 'sessionId' in lease.resource ? lease.resource.sessionId : lease.resource.terminalId
    if (lease.delegate !== actor || lease.resource.environmentId !== environmentId || resourceId !== id
      || ('sessionId' in lease.resource ? 'session' : 'terminal') !== kind || !lease.leaseId || !lease.generation
      || !(Date.parse(lease.expiresAt) > Date.now())) throw fail('identity_conflict', 'Invalid delegated control grant')
    this.prune()
    const grantKey = key(actor, environmentId, kind, id)
    const current = this.grants.get(grantKey)
    if (current?.lease.leaseId === lease.leaseId && current.lease.generation === lease.generation) {
      current.lease = lease
      return current
    }
    const grant = { actor, key: grantKey, lease }
    this.grants.set(grantKey, grant)
    return grant
  }

  capture(actor: string, environmentId: string, kind: 'session' | 'terminal', payload: Record<string, unknown>, byProof = false): RoutedGrant {
    const grant = byProof
      ? [...this.grants.values()].find(candidate => candidate.actor === actor && candidate.lease.resource.environmentId === environmentId
        && ('sessionId' in candidate.lease.resource ? 'session' : 'terminal') === kind
        && candidate.lease.leaseId === payload.leaseId && candidate.lease.generation === payload.generation)
      : this.grants.get(key(actor, environmentId, kind, String(payload[kind === 'session' ? 'sessionId' : 'terminalId'] ?? '')))
    if (!grant || !payload.leaseId || !payload.generation) throw fail('lease_required', 'Explicit phone control is required')
    if (grant.lease.leaseId !== payload.leaseId || grant.lease.generation !== payload.generation) throw fail('lease_stale', 'Phone control grant changed')
    this.assertCurrent(grant)
    return grant
  }

  assertCurrent(grant: RoutedGrant): void {
    if (!this.isCurrent(grant)) throw fail('lease_stale', 'Phone control grant expired or changed')
  }
  isCurrent(grant: RoutedGrant): boolean { return this.grants.get(grant.key) === grant && Date.parse(grant.lease.expiresAt) > Date.now() }
  renewed(grant: RoutedGrant, lease: ControlLease): void {
    this.assertCurrent(grant)
    if (lease.leaseId !== grant.lease.leaseId || lease.generation !== grant.lease.generation || lease.delegate !== grant.actor
      || JSON.stringify(lease.resource) !== JSON.stringify(grant.lease.resource) || !(Date.parse(lease.expiresAt) > Date.now())) throw fail('lease_stale', 'Invalid renewed phone control grant')
    grant.lease = lease
  }
  forget(grant: RoutedGrant): void { if (this.grants.get(grant.key) === grant) this.grants.delete(grant.key) }
  clear(): void { this.grants.clear() }
  owns(actor: string, environmentId: string, kind: 'session' | 'terminal', id: string): boolean {
    const grant = this.grants.get(key(actor, environmentId, kind, id))
    return !!grant && Date.parse(grant.lease.expiresAt) > Date.now()
  }
  private prune(): void { for (const grant of this.grants.values()) if (Date.parse(grant.lease.expiresAt) <= Date.now()) this.forget(grant) }
}
