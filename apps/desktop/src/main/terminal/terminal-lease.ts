import type { ControlLease, TerminalRef } from '@superone/shared/environment'
import { bindControlActor, type ControlLeaseService } from '@superone/runtime/lease'

export interface TerminalLeaseAuthority {
  environmentId: string
  leases: ControlLeaseService
}

type Writer = { kind: 'local' } | { kind: 'remote'; deviceId: string }
type ChangeListener = (owner: Writer) => void

/** Terminal writer hints derive from the domain's fenced leases; topic streams own reading interest. */
export class TerminalLease {
  readonly ref: TerminalRef
  private readonly listeners = new Set<ChangeListener>()
  private readonly off: () => void
  private notifiedDeviceId: string | null
  private disposed = false

  constructor(private readonly authority: TerminalLeaseAuthority, terminalId: string) {
    this.ref = { environmentId: authority.environmentId, terminalId }
    this.notifiedDeviceId = this.ownerDeviceId
    this.off = authority.leases.onChange((resource, lease) => {
      if (!('terminalId' in resource) || resource.environmentId !== this.ref.environmentId || resource.terminalId !== terminalId) return
      const owner = this.writer(lease)
      const deviceId = owner.kind === 'remote' ? owner.deviceId : null
      if (deviceId === this.notifiedDeviceId) return
      this.notifiedDeviceId = deviceId
      for (const listener of this.listeners) listener(owner)
    })
  }

  private writer(lease: ControlLease | null): Writer {
    if (!lease || lease.delegate?.startsWith('window:')) return { kind: 'local' }
    return { kind: 'remote', deviceId: lease.delegate?.replace(/^phone:/, '') ?? `node:${lease.holderClientId}` }
  }

  get owner(): Writer { return this.writer(this.authority.leases.get(this.ref)) }
  get ownerDeviceId(): string | null { const owner = this.owner; return owner.kind === 'remote' ? owner.deviceId : null }

  /** Presentation hint only. Mutations use an authenticated actor and a fenced proof. */
  isWritableBy(who: string): boolean {
    const owner = this.owner
    return who === 'local' ? owner.kind === 'local' : owner.kind === 'remote' && owner.deviceId === who
  }

  private actor(clientSessionId: string, delegate: string, yields: boolean) {
    return bindControlActor(this.authority.leases, {
      clientSessionId, delegate, yields, holderClientId: `desktop:${this.ref.environmentId}`,
    })
  }

  /** Local IPC uses the sender's webContents id, never a renderer-supplied identity. */
  assertWindow(windowId: number): ControlLease {
    const clientSessionId = `ipc:${windowId}`
    const actor = this.actor(clientSessionId, `window:${windowId}`, true)
    const lease = actor.acquire({ resource: this.ref, holderClientId: clientSessionId, ttlMs: 60_000 })
    actor.assertValid({ ...lease, holderClientId: clientSessionId })
    return lease
  }

  reclaimLocal(windowId = 0): void {
    this.authority.leases.revoke(this.ref)
    this.assertWindow(windowId)
  }

  /** Aggregate pairing disconnect retires only this device's current native grant. */
  handleDeviceDisconnected(deviceId: string): void {
    const lease = this.authority.leases.get(this.ref)
    if (lease?.delegate !== `phone:${deviceId}`) return
    this.actor(`phone:${deviceId}`, `phone:${deviceId}`, false).release(lease.leaseId, lease.generation, `phone:${deviceId}`)
  }

  onChange(listener: ChangeListener): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.off()
    this.listeners.clear()
    this.authority.leases.revoke(this.ref)
  }
}
