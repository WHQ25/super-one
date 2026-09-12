import { randomUUID } from 'node:crypto'
import type { DraftStore } from '@superone/runtime/drafts'
import { hasPersistableDraftContent, withoutDraftAttachmentBytes } from '@superone/shared/environment/draft-content'
import { DRAFT_ATTACHMENTS_MAX_BYTES, type DraftChangedEvent, type DraftListEntry, type DraftOpenResult, type DraftRemoteCommand, type DraftUpsertRequest } from '@superone/shared/environment/draft-rpc'

/** One authority for local IPC and mobile writes; stale lease packets cannot
 * re-acquire control after the desktop has disconnected a composer. */
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
      throw new Error('Draft control was released. Open the draft again.')
    }
    if (owner && (owner.deviceId !== deviceId || owner.leaseId !== leaseId)) {
      throw new Error('This draft is Read Only while another device is editing it.')
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
    if (!draft) throw new Error('Draft no longer exists')
    if (expectedUpdatedAt && draft.updatedAt !== expectedUpdatedAt) throw new Error('Draft changed on another device. Your edits are kept on this phone.')
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
      else throw new Error('Open the draft before editing it')
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
  /**
   * The mobile wire. Attachment bytes travel only in a full `open_draft` reply —
   * the one that loads a composer. Rows, saves and lease-only opens carry the
   * attachment list without its data; see `withoutDraftAttachmentBytes`.
   */
  handle(command: DraftRemoteCommand, deviceId: string): unknown {
    switch (command.type) {
      case 'list_drafts': return { drafts: this.list(command.projectPath).map(withoutDraftAttachmentBytes) }
      case 'open_draft': {
        const opened = this.open(command.draftId, deviceId, command.expectedUpdatedAt)
        return command.omitContent ? { ...opened, draft: withoutDraftAttachmentBytes(opened.draft) } : opened
      }
      case 'save_draft': {
        const input = command.draft
        if (!input || typeof input.id !== 'string' || !input.id || typeof input.text !== 'string' || !input.projectPath) throw new Error('Draft id, text and project are required')
        if (input.attachments?.some((a) => typeof a.data !== 'string' || typeof a.name !== 'string' || typeof a.mimeType !== 'string')) throw new Error('Invalid draft attachment')
        if ((input.attachments?.reduce((size, a) => size + a.data.length, 0) ?? 0) > DRAFT_ATTACHMENTS_MAX_BYTES) throw new Error('Draft attachments exceed 8 MB. Remove an attachment to synchronize this draft.')
        const saved = this.save(input, deviceId, command.leaseId)
        return { ...saved, draft: withoutDraftAttachmentBytes(saved.draft) }
      }
      case 'close_draft': this.close(command.draftId, deviceId, command.leaseId); return { ok: true }
      case 'delete_draft': this.delete(command.draftId, deviceId, command.leaseId); return { ok: true }
    }
  }
}
