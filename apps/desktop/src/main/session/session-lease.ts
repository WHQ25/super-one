import type { ControlLease, SessionControlHolder, SessionRef } from '@superone/shared/environment'
import type { ControlLeaseService } from '@superone/runtime/lease'
import { controlActorFor, currentControlScope } from './control-context'
import { SessionLockedError, type SendProviderOrigin, type SessionLifecycleEvent } from './types'

/** Paired names of the clients that can hold this desktop's leases. */
export interface ControlHolderNames {
  controller(clientSessionId: string): string | null
  phone(deviceId: string): string | null
}

export interface SessionLeaseAuthority { environmentId: string; leases: ControlLeaseService; names?: ControlHolderNames }

/**
 * The delegate of a lease this desktop's own principal holds (`window:<id>`,
 * `phone:<device>`); null for a controller desktop's lease, whose delegates
 * are devices it relays, not this desktop's.
 */
export function hostDelegate(lease: ControlLease | null, environmentId: string): string | null {
  return lease?.holderClientId === `desktop:${environmentId}` ? lease.delegate ?? null : null
}

/**
 * The authenticated client holding `lease`: a window (`ipc:<id>`) or phone
 * (`phone:<device>`) of this desktop, or a controller desktop's client session.
 */
export function holderClientOf(lease: ControlLease, environmentId: string): string {
  const delegate = hostDelegate(lease, environmentId)
  return delegate === null ? lease.holderClientId : delegate.replace(/^window:/, 'ipc:')
}

/** Who holds `lease`, told apart by its holder and delegate and named by their pairings. */
export function controlHolderOf(lease: ControlLease, environmentId: string, names?: ControlHolderNames): SessionControlHolder {
  const delegate = hostDelegate(lease, environmentId)
  if (delegate === null) return { kind: 'controller', label: names?.controller(lease.holderClientId) ?? null }
  if (delegate.startsWith('window:')) return { kind: 'window', label: null }
  return { kind: 'phone', label: names?.phone(delegate.replace(/^phone:/, '')) ?? null }
}

/** Every frontend mutation uses the domain's lease; observing a session grants no authority. */
export class SessionLease {
  private authority: SessionLeaseAuthority | undefined
  private off: (() => void) | undefined
  private readonly listeners = new Set<(event: SessionLifecycleEvent) => void>()
  private notifiedProof: string | null = null
  private closed = false

  constructor(readonly sessionId: string, authority?: SessionLeaseAuthority) { if (authority) this.bind(authority) }

  bind(authority: SessionLeaseAuthority): void {
    if (this.authority === authority || this.authority?.leases === authority.leases) return
    this.off?.()
    this.authority = authority
    this.off = authority.leases.onChange(resource => {
      if ('sessionId' in resource && resource.environmentId === authority.environmentId && resource.sessionId === this.sessionId) this.changed()
    })
    this.changed()
  }

  get resource(): SessionRef {
    if (!this.authority) throw new Error('desktop control leases are not ready')
    return { environmentId: this.authority.environmentId, sessionId: this.sessionId }
  }
  get current(): ControlLease | null { return this.authority ? this.authority.leases.get(this.resource) : null }
  get isExternal(): boolean { const lease = this.current; return !!lease && !lease.delegate?.startsWith('window:') }
  /** Who holds the session's lease now, named; null while nobody does. */
  get holder(): SessionControlHolder | null {
    const lease = this.current
    return lease && this.authority ? controlHolderOf(lease, this.authority.environmentId, this.authority.names) : null
  }
  /** The phone of this desktop driving the session, if one is. */
  get phoneDeviceId(): string | null {
    const delegate = this.authority ? hostDelegate(this.current, this.authority.environmentId) : null
    return delegate?.startsWith('phone:') ? delegate.slice(6) : null
  }

  onLifecycle(listener: (event: SessionLifecycleEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private emit(event: SessionLifecycleEvent): void {
    for (const listener of this.listeners) {
      try { listener(event) } catch (error) { console.warn('[session-lease] lifecycle listener failed', error) }
    }
  }
  private changed(): void {
    const lease = this.current
    const proof = lease ? JSON.stringify([lease.leaseId, lease.generation, lease.holderClientId, lease.delegate]) : null
    if (proof === this.notifiedProof) return
    this.notifiedProof = proof
    this.emit({ type: 'control_changed', sessionId: this.sessionId, lease })
  }

  private actor(clientSessionId: string) {
    if (!this.authority) throw new Error('desktop control leases are not ready')
    return controlActorFor(this.authority.leases, this.authority.environmentId, clientSessionId)
  }

  /** Only a host that just created a new resource may seed its request's grant. */
  grantCreatedSession(): void {
    const scope = currentControlScope()
    if (!scope) return
    const proof = this.actor(scope.clientSessionId).acquire({ resource: this.resource, holderClientId: scope.clientSessionId, ttlMs: 60_000 })
    scope.proofs.set(this.sessionId, proof)
  }

  /** Trusted host work has no frontend scope; every frontend mutation has one. */
  assertMutation(): void {
    const scope = currentControlScope()
    if (!scope) return
    if (this.closed) throw Object.assign(new Error('session control closed'), { code: 'failed_precondition' })
    const actor = this.actor(scope.clientSessionId)
    let proof = scope.proofs.get(this.sessionId)
    if (!proof) {
      if (!scope.acquire) throw Object.assign(new Error('session control proof required'), { code: 'failed_precondition' })
      proof = actor.acquire({ resource: this.resource, holderClientId: scope.clientSessionId, ttlMs: 60_000 })
      scope.proofs.set(this.sessionId, proof)
    }
    actor.assertValid({ resource: this.resource, holderClientId: scope.clientSessionId, leaseId: proof.leaseId, generation: proof.generation })
  }
  assertSend(origin: SendProviderOrigin): void {
    if (origin === 'host') return
    if (!currentControlScope() && origin === 'local' && this.isExternal) {
      throw new SessionLockedError(this.sessionId, 'remote-owned', this.current?.delegate)
    }
    this.assertMutation()
  }

  /** A backend is host-owned; capture the caller's proof before crossing it. */
  captureMutation(): () => void {
    this.assertMutation()
    const scope = currentControlScope()
    if (!scope) return () => { if (this.closed) throw new Error('session control closed') }
    const authority = this.authority!, actor = this.actor(scope.clientSessionId)
    const proof = { ...scope.proofs.get(this.sessionId)! }
    const resource = this.resource
    return () => {
      if (this.closed || this.authority !== authority) throw new Error('session control closed or rebound')
      actor.assertValid({ resource, holderClientId: scope.clientSessionId, leaseId: proof.leaseId, generation: proof.generation })
    }
  }

  /** Keep the admitted call's exact grant alive, never reacquire after takeover. */
  retainVoice(deviceId?: string): () => void {
    this.assertMutation()
    const lease = this.current
    if (!this.authority) return () => {}
    if (!lease || (deviceId ? lease.delegate !== `phone:${deviceId}` : !lease.delegate?.startsWith('window:'))) {
      throw Object.assign(new Error('Voice requires this endpoint\'s session control'), { code: 'lease_required' })
    }
    const timer = setInterval(() => {
      try { this.authority!.leases.renew({ ...lease, ttlMs: 60_000 }) }
      catch { clearInterval(timer) }
    }, 20_000)
    timer.unref?.()
    return () => { clearInterval(timer) }
  }

  /** Trusted host reactions release only the currently authenticated delegate. */
  releaseDelegate(delegate: string): boolean {
    const lease = this.current
    if (!lease || hostDelegate(lease, this.authority!.environmentId) !== delegate) return false
    this.authority!.leases.release(lease.leaseId, lease.generation, lease.holderClientId, delegate)
    return true
  }
  revoke(): void { this.authority?.leases.revoke(this.resource) }
  /**
   * This desktop's user takes the session from a phone or controller desktop
   * (Disconnect): their lease ends and the asking window holds it, so a
   * controller sees it in use and must take it over on purpose.
   */
  takeBack(): void {
    if (!this.isExternal) return
    this.revoke()
    this.assertMutation()
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.revoke()
    this.emit({ type: 'closed', sessionId: this.sessionId })
    this.off?.()
    this.listeners.clear()
  }
}
