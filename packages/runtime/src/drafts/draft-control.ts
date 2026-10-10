import { randomUUID } from 'node:crypto'
import type { DraftStore } from './store'
import { hasPersistableDraftContent } from '@superone/shared/environment/draft-content'
import { type DraftChangedEvent, type DraftListEntry, type DraftOpenResult, type DraftUpsertRequest } from '@superone/shared/environment/draft-rpc'

/** One authority for local IPC and mobile writes; stale lease packets cannot
 * re-acquire control after the desktop has disconnected a composer. */
const precondition = (message: string) => Object.assign(new Error(message), { code: 'failed_precondition' })

export class DraftControl implements DraftStore {
  private owners = new Map<string, { deviceId: string; leaseId: string }>()
  private listeners = new Set<(event: DraftChangedEvent) => void>()
  constructor(private readonly store: DraftStore) {}

  watch(listener: (event: DraftChangedEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  get(id: string): DraftListEntry | undefined {
    const draft = this.store.get(id)
    return draft && { ...draft, controllerDeviceId: this.owners.get(id)?.deviceId ?? null }
  }
  list(projectPath?: string): DraftListEntry[] {
    return this.store.list(projectPath).map((draft) => ({ ...draft, controllerDeviceId: this.owners.get(draft.id)?.deviceId ?? null }))
  }
  private emit(id: string, reason: DraftChangedEvent['reason']): void {
    const event: DraftChangedEvent = { type: 'draft_changed', draftId: id, draft: this.get(id) ?? null, reason }
    for (const listener of this.listeners) listener(event)
  }
  private assertWritable(id: string, deviceId?: string, leaseId?: string): void {
    const owner = this.owners.get(id)
    if (leaseId && (!owner || owner.deviceId !== deviceId || owner.leaseId !== leaseId)) {
      throw precondition('Draft control was released. Open the draft again.')
    }
    if (owner && (owner.deviceId !== deviceId || owner.leaseId !== leaseId)) {
      throw precondition('This draft is Read Only while another device is editing it.')
    }
  }
  assertControl(id: string, deviceId: string, leaseId: string): void {
    this.assertWritable(id, deviceId, leaseId)
  }
  upsert(input: DraftUpsertRequest): DraftListEntry { return this.write(input) }
  private write(input: DraftUpsertRequest, deviceId?: string, leaseId?: string): DraftListEntry {
    this.assertWritable(input.id, deviceId, leaseId)
    if (input.originSessionId) {
      for (const id of this.owners.keys()) {
        if (id !== input.id && this.store.get(id)?.originSessionId === input.originSessionId) this.assertWritable(id, deviceId, leaseId)
      }
    }
    this.store.upsert(input)
    this.emit(input.id, 'saved')
    return this.get(input.id)!
  }
  open(id: string, deviceId: string, expectedUpdatedAt?: string): DraftOpenResult {
    const draft = this.get(id)
    if (!draft) throw precondition('Draft no longer exists')
    if (expectedUpdatedAt && draft.updatedAt !== expectedUpdatedAt) throw precondition('Draft changed on another device. Your edits are kept on this phone.')
    const owner = this.owners.get(id)
    if (owner && owner.deviceId !== deviceId) this.assertWritable(id)
    const lease = owner ?? { deviceId, leaseId: randomUUID() }
    this.owners.set(id, lease)
    this.emit(id, 'opened')
    return { draft: this.get(id)!, leaseId: lease.leaseId }
  }
  save(input: DraftUpsertRequest, deviceId: string, leaseId?: string): DraftOpenResult {
    // Only a newly minted id may be created without a lease.
    if (!leaseId && this.get(input.id)) {
      const owner = this.owners.get(input.id)
      if (owner?.deviceId === deviceId) leaseId = owner.leaseId
      else throw precondition('Open the draft before editing it')
    }
    this.write(input, deviceId, leaseId)
    return this.open(input.id, deviceId)
  }
  close(id: string, deviceId: string, leaseId: string): void {
    this.assertWritable(id, deviceId, leaseId)
    this.release(id, 'closed', true)
  }
  disconnect(id: string): void {
    this.release(id, 'disconnected', true)
  }
  private release(id: string, reason: 'closed' | 'disconnected', discardEmpty = false): void {
    if (!this.owners.delete(id)) return
    const draft = this.store.get(id)
    if (discardEmpty && draft && !hasPersistableDraftContent(draft)) this.store.delete(id)
    this.emit(id, reason)
  }
  releaseDevice(deviceId: string): void {
    for (const [id, owner] of this.owners) {
      if (owner.deviceId === deviceId) {
        this.release(id, 'closed')
      }
    }
  }
  delete(id: string, deviceId?: string, leaseId?: string): boolean {
    this.assertWritable(id, deviceId, leaseId)
    const deleted = this.store.delete(id)
    this.owners.delete(id)
    if (deleted) this.emit(id, 'deleted')
    return deleted
  }
}
