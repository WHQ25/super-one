import type { ControlLease, MutatingControlContext } from '@superone/shared/environment/lease'
import type { SessionRef, TerminalRef } from '@superone/shared/environment/refs'
import type { PhoneRpcOptions } from './phone-protocol'

type Resource = SessionRef | TerminalRef
type Rpc = <T>(method: string, payload: unknown, options?: PhoneRpcOptions) => Promise<T>
type Held = { lease: ControlLease; timer: ReturnType<typeof setTimeout> | null }
const key = (ref: Resource) => JSON.stringify([ref.environmentId, 'sessionId' in ref ? 'session' : 'terminal', 'sessionId' in ref ? ref.sessionId : ref.terminalId])
const family = (ref: Resource) => 'sessionId' in ref ? 'session' : 'terminal'
const identity = (ref: Resource) => 'sessionId' in ref ? { sessionId: ref.sessionId } : { terminalId: ref.terminalId }

/** One protocol connection's explicit control grants. Renewal never reacquires a revoked grant. */
export class PhoneControlLeases {
  private readonly held = new Map<string, Held>()
  private readonly acquisitions = new Map<string, number>()
  private readonly revoked = new Map<string, true>()
  private closed = false

  constructor(private readonly rpc: Rpc, private readonly onLost: (resource: Resource, error: Error) => void = () => {}) {}

  async acquire(resource: Resource, options: { reclaim?: boolean } = {}): Promise<ControlLease> {
    if (this.closed) throw new Error('connection closed')
    const resourceKey = key(resource)
    const generation = (this.acquisitions.get(resourceKey) ?? 0) + 1
    this.acquisitions.set(resourceKey, generation)
    const lease = await this.rpc<ControlLease>(`${family(resource)}.acquireControl`, { ...identity(resource), ttlMs: 60_000, ...options }, { environmentId: resource.environmentId })
    if (this.closed || this.acquisitions.get(resourceKey) !== generation) throw new Error('control acquisition superseded')
    if (this.revoked.has(JSON.stringify([resourceKey, lease.leaseId, lease.generation]))) throw Object.assign(new Error('control lease revoked'), { code: 'lease_stale' })
    if (key(lease.resource) !== resourceKey || !lease.leaseId || !lease.generation || !(Date.parse(lease.expiresAt) > Date.now())) throw new Error('invalid control grant')
    this.forget(resource)
    const held = { lease, timer: null }
    this.held.set(resourceKey, held)
    this.schedule(resource, held)
    return lease
  }

  proof(resource: Resource): MutatingControlContext {
    const held = this.held.get(key(resource))
    if (!held || this.closed) throw Object.assign(new Error('session or terminal control is required'), { code: 'lease_required' })
    if (Date.parse(held.lease.expiresAt) <= Date.now()) {
      const error = Object.assign(new Error('control lease expired'), { code: 'lease_stale' })
      this.lose(resource, held, error)
      throw error
    }
    return { leaseId: held.lease.leaseId, generation: held.lease.generation }
  }

  async call<T>(resource: Resource, method: string, payload: Record<string, unknown> = {}, options: Omit<PhoneRpcOptions, 'environmentId'> = {}): Promise<T> {
    const proof = this.proof(resource)
    const held = this.held.get(key(resource))!
    try { return await this.rpc<T>(method, { ...payload, ...identity(resource), ...proof }, { ...options, environmentId: resource.environmentId }) }
    catch (error) {
      if ((error as { code?: string } | null)?.code === 'lease_stale') this.lose(resource, held, error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  async release(resource: Resource, proof?: MutatingControlContext): Promise<void> {
    const held = this.held.get(key(resource))
    if (!proof || (held?.lease.leaseId === proof.leaseId && held.lease.generation === proof.generation)) {
      this.acquisitions.set(key(resource), (this.acquisitions.get(key(resource)) ?? 0) + 1)
      this.forget(resource)
    }
    const releasing = proof ?? held?.lease
    if (!releasing) return
    await this.rpc(`${family(resource)}.releaseControl`, { leaseId: releasing.leaseId, generation: releasing.generation }, { environmentId: resource.environmentId })
  }

  /** An authenticated host revoked this exact grant, possibly before its acquire receipt arrived. */
  invalidate(resource: Resource, proof: MutatingControlContext): void {
    if (this.closed) return
    const receipt = JSON.stringify([key(resource), proof.leaseId, proof.generation])
    this.revoked.set(receipt, true)
    if (this.revoked.size > 256) this.revoked.delete(this.revoked.keys().next().value!)
    const held = this.held.get(key(resource))
    if (held?.lease.leaseId === proof.leaseId && held.lease.generation === proof.generation) {
      this.lose(resource, held, Object.assign(new Error('control lease revoked'), { code: 'lease_stale' }))
    }
  }

  close(): void {
    this.closed = true
    for (const held of this.held.values()) if (held.timer) clearTimeout(held.timer)
    this.held.clear()
    this.acquisitions.clear()
    this.revoked.clear()
  }

  private forget(resource: Resource): void {
    const held = this.held.get(key(resource))
    if (held?.timer) clearTimeout(held.timer)
    this.held.delete(key(resource))
  }

  private lose(resource: Resource, held: Held, error: Error): void {
    if (this.held.get(key(resource)) !== held) return
    this.forget(resource)
    this.onLost(resource, error)
  }

  private schedule(resource: Resource, held: Held): void {
    held.timer = setTimeout(() => {
      held.timer = null
      void this.rpc<ControlLease>(`${family(resource)}.renewControl`, { leaseId: held.lease.leaseId, generation: held.lease.generation, ttlMs: 60_000 }, { environmentId: resource.environmentId }).then((lease) => {
        if (this.closed || this.held.get(key(resource)) !== held) return
        if (lease.leaseId !== held.lease.leaseId || lease.generation !== held.lease.generation || key(lease.resource) !== key(resource) || !(Date.parse(lease.expiresAt) > Date.now())) throw new Error('invalid renewed control grant')
        held.lease = lease
        this.schedule(resource, held)
      }).catch((error: unknown) => this.lose(resource, held, error instanceof Error ? error : new Error(String(error))))
    }, Math.max(1, Math.floor((Date.parse(held.lease.expiresAt) - Date.now()) / 2)))
  }
}
