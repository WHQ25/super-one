import type { ControlLease, ControlLostEvent, SessionRef, TerminalRef } from '@superone/shared/environment'
import type { RpcContext } from '@superone/runtime/server'
import { RoutedPhoneControl, type RoutedGrant } from './routed-phone-control'

export interface RoutedGrantOwner {
  active: boolean
  push?: NonNullable<RpcContext['streams']>['push']
}
type Binding = { grant: RoutedGrant; owners: Set<RoutedGrantOwner>; timer?: ReturnType<typeof setTimeout>; release(): Promise<unknown> }
type ResourceRef = SessionRef | TerminalRef

/** Serialize acquire/release at one authority so a late socket close cannot release a replacement's proof. */
export class RoutedPhoneGrants {
  private readonly bindings = new Map<RoutedGrant, Binding>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly revoked = new Set<string>()
  constructor(readonly control: RoutedPhoneControl, private readonly changed?: (resource: ResourceRef, lease: ControlLease | null) => void) {}

  private proof(lease: Pick<ControlLease, 'resource' | 'leaseId' | 'generation'>): string {
    const ref = lease.resource
    return JSON.stringify([ref.environmentId, 'sessionId' in ref ? 'session' : 'terminal',
      'sessionId' in ref ? ref.sessionId : ref.terminalId, lease.leaseId, lease.generation])
  }
  invalidateProof(event: ControlLostEvent): void {
    this.revoked.add(this.proof(event))
    if (this.revoked.size > 256) this.revoked.delete(this.revoked.values().next().value!)
    for (const grant of this.bindings.keys()) if (this.proof(grant.lease) === this.proof(event)) this.invalidate(grant)
  }
  renewed(grant: RoutedGrant): void {
    const binding = this.bindings.get(grant)
    if (!binding) return
    if (binding.timer) clearTimeout(binding.timer)
    binding.timer = setTimeout(() => this.invalidate(grant), Math.max(0, Date.parse(grant.lease.expiresAt) - Date.now()))
    binding.timer.unref?.()
  }

  async run<T>(resource: ResourceRef, task: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([resource.environmentId, 'sessionId' in resource ? 'session' : 'terminal',
      'sessionId' in resource ? resource.sessionId : resource.terminalId])
    const previous = this.queues.get(key) ?? Promise.resolve()
    const result = previous.catch(() => {}).then(task)
    this.queues.set(key, result)
    try { return await result }
    finally { if (this.queues.get(key) === result) this.queues.delete(key) }
  }

  /** Called within run, immediately after the authoritative acquire receipt. */
  async attach(grant: RoutedGrant, owner: RoutedGrantOwner, release: Binding['release']): Promise<void> {
    if (this.revoked.has(this.proof(grant.lease))) {
      this.control.forget(grant)
      throw Object.assign(new Error('Phone control was revoked during admission'), { code: 'lease_stale' })
    }
    for (const old of this.bindings.keys()) if (old.key === grant.key && old !== grant) this.invalidate(old)
    let binding = this.bindings.get(grant)
    if (!binding) {
      binding = { grant, owners: new Set(), release }
      this.bindings.set(grant, binding)
    }
    if (owner.active) {
      binding.owners.add(owner)
      this.renewed(grant)
      this.changed?.(grant.lease.resource, grant.lease)
    }
    else {
      if (!binding.owners.size) await this.retire(binding, false)
      throw Object.assign(new Error('Phone connection closed'), { code: 'unavailable' })
    }
  }

  detach(owner: RoutedGrantOwner): void {
    owner.active = false
    for (const binding of this.bindings.values()) {
      if (!binding.owners.delete(owner) || binding.owners.size) continue
      void this.run(binding.grant.lease.resource, async () => {
        if (!binding.owners.size) await this.retire(binding, false)
      }).catch(() => {})
    }
  }

  async release(grant: RoutedGrant): Promise<unknown> {
    return this.run(grant.lease.resource, async () => {
      this.control.assertCurrent(grant)
      const binding = this.bindings.get(grant)
      if (!binding) throw Object.assign(new Error('Phone control grant changed'), { code: 'lease_stale' })
      return this.retire(binding, true)
    })
  }

  async releaseSessions(sessionId?: string): Promise<void> {
    await Promise.all([...this.bindings.values()].filter(({ grant }) => 'sessionId' in grant.lease.resource
      && (!sessionId || grant.lease.resource.sessionId === sessionId)).map(binding =>
      this.run(binding.grant.lease.resource, () => this.retire(binding, true))))
  }

  invalidate(grant: RoutedGrant): void {
    const binding = this.bindings.get(grant)
    this.bindings.delete(grant)
    this.control.forget(grant)
    if (!binding) return
    if (binding.timer) clearTimeout(binding.timer)
    this.changed?.(grant.lease.resource, null)
    for (const owner of binding.owners) if (owner.active) {
      try { owner.push?.({ type: 'client', event: { type: 'control_lost', resource: grant.lease.resource,
        leaseId: grant.lease.leaseId, generation: grant.lease.generation } }) } catch { /* closed wire */ }
    }
    binding.owners.clear()
  }

  private async retire(binding: Binding, notify: boolean): Promise<unknown> {
    const { grant } = binding
    if (this.bindings.get(grant) !== binding || !this.control.isCurrent(grant)) {
      this.invalidate(grant)
      return
    }
    if (notify) this.invalidate(grant)
    else {
      this.bindings.delete(grant); this.control.forget(grant); binding.owners.clear()
      if (binding.timer) clearTimeout(binding.timer)
      this.changed?.(grant.lease.resource, null)
    }
    // Exact upstream proof: a disconnected/restarted authority may refuse it.
    return binding.release().catch(error => {
      if ((error as { code?: string }).code !== 'lease_stale') throw error
    })
  }
}
