import type { Kv } from '@superone/relay-client'
import type { DraftChangedEvent, DraftListEntry, DraftOpenResult, DraftUpsertRequest } from '@superone/shared/environment/draft-rpc'
import { randomId } from './ids'
import { hasPersistableDraftContent } from '@superone/shared/environment/draft-content'

type Pending = { input: DraftUpsertRequest; baseUpdatedAt?: string }
class DraftResponseError extends Error {}
type Ports = {
  kv: Kv
  key: string
  rpc(method: string, payload: Record<string, unknown>): Promise<unknown>
  changed(): void
  revoked(id: string): void
}

function entry(input: DraftUpsertRequest): DraftListEntry {
  const now = new Date().toISOString()
  return { ...input, title: input.text.split('\n').find((line) => line.trim())?.trim().slice(0, 120) ?? '',
    docJson: input.docJson ?? null, attachments: input.attachments ?? [], projectPath: input.projectPath ?? null,
    harness: input.harness ?? null, model: input.model ?? null, permissionMode: input.permissionMode ?? null,
    settings: input.settings ?? {}, originSessionId: input.originSessionId ?? null,
    createdAt: input.createdAt ?? now, updatedAt: now, pendingSync: true }
}

/** A durable outbox per paired desktop. Operations are serialized so a save
 * started before navigation cannot land after close/delete and resurrect it. */
export class RemoteDraftLibrary {
  private records = new Map<string, DraftListEntry>()
  private recordRevision = 0
  private pending = new Map<string, Pending>()
  private leases = new Map<string, string>()
  private deleted = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()
  private writes: Promise<unknown> = Promise.resolve()
  readonly ready: Promise<void>
  constructor(private readonly ports: Ports) {
    this.ready = this.restore()
  }
  private async restore(): Promise<void> {
    const raw = await this.ports.kv.get(this.ports.key)
    if (raw) {
      try {
        const saved = JSON.parse(raw) as { pending: Pending[]; deleted: string[] }
        for (const item of saved.pending ?? []) if (item.input?.id && !this.pending.has(item.input.id)) this.pending.set(item.input.id, item)
        for (const id of saved.deleted ?? []) this.deleted.add(id)
      } catch { /* keep the running editor usable if an older outbox is malformed */ }
    }
    this.ports.changed()
  }
  get rows(): DraftListEntry[] {
    const rows = new Map(this.records)
    for (const [id, item] of this.pending) rows.set(id, { ...entry(item.input), createdAt: this.records.get(id)?.createdAt ?? item.input.createdAt ?? entry(item.input).createdAt })
    return [...rows.values()].filter((row) => !this.deleted.has(row.id) && hasPersistableDraftContent(row)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  get(id: string): DraftListEntry | undefined {
    if (this.deleted.has(id)) return undefined
    const pending = this.pending.get(id)
    return pending ? entry(pending.input) : this.records.get(id)
  }
  private persist(): Promise<unknown> {
    const value = JSON.stringify({ pending: [...this.pending.values()], deleted: [...this.deleted] })
    this.writes = this.writes.catch(() => {}).then(() => this.ports.kv.set(this.ports.key, value))
    return this.writes
  }
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(() => this.ready).then(task)
    this.queue = next
    return next
  }
  private async rpc<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    try { return await this.ports.rpc(method, payload) as T }
    catch (error) {
      if ((error as { code?: string } | null)?.code === 'failed_precondition') throw new DraftResponseError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }
  stage(input: DraftUpsertRequest): Promise<unknown> {
    const previous = this.pending.get(input.id)
    this.pending.set(input.id, { input, baseUpdatedAt: previous?.baseUpdatedAt ?? this.records.get(input.id)?.updatedAt })
    this.ports.changed()
    return this.ready.then(() => this.persist())
  }
  private async loadRecords(): Promise<void> {
    const revision = this.recordRevision
    const { drafts } = await this.rpc<{ drafts: DraftListEntry[] }>('draft.list')
    if (this.recordRevision === revision) this.records = new Map(drafts.map((row) => [row.id, row]))
  }
  refresh(): Promise<void> {
    return this.run(async () => {
      await this.loadRecords()
      this.ports.changed()
    })
  }
  open(id: string): Promise<DraftListEntry> {
    return this.run(async () => {
      try { await this.flushOne(id) } catch (error) {
        const pending = this.pending.get(id)
        if (!pending || !(error instanceof DraftResponseError) || !/changed|no longer exists|control was released|before editing/i.test(error.message)) throw error
        // Explicitly reopening a conflicting outbox row recovers a separate
        // draft. The desktop's newer content and the phone's edits both survive.
        this.pending.delete(id)
        id = randomId()
        this.pending.set(id, { input: { ...pending.input, id, originSessionId: null } })
        await this.persist()
        await this.flushOne(id)
      }
      const result = await this.rpc<DraftOpenResult>('draft.open', { draftId: id })
      this.leases.set(id, result.leaseId)
      this.records.set(id, result.draft)
      this.ports.changed()
      return result.draft
    })
  }
  private async flushOne(id: string): Promise<void> {
    while (this.pending.has(id)) {
      const item = this.pending.get(id)!
      if (!this.leases.has(id) && (item.baseUpdatedAt || this.records.has(id))) {
        const opened = await this.rpc<DraftOpenResult>('draft.open', { draftId: id, expectedUpdatedAt: item.baseUpdatedAt })
        this.leases.set(id, opened.leaseId)
      }
      const result = await this.rpc<DraftOpenResult>('draft.upsert', { ...item.input, leaseId: this.leases.get(id), open: true })
      this.leases.set(id, result.leaseId)
      this.records.set(id, result.draft)
      if (this.pending.get(id) === item) this.pending.delete(id)
      else this.pending.get(id)!.baseUpdatedAt = result.draft.updatedAt
      await this.persist()
      this.ports.changed()
    }
  }
  flush(id: string): Promise<void> { return this.run(() => this.flushOne(id)) }
  prepareSend(id: string): Promise<{ draftId: string; draftLeaseId: string }> {
    return this.run(async () => {
      await this.flushOne(id)
      // Lease only: the composer already holds this draft, bytes and all.
      const opened = await this.rpc<DraftOpenResult>('draft.open', { draftId: id, omitContent: true })
      this.leases.set(id, opened.leaseId)
      return { draftId: id, draftLeaseId: opened.leaseId }
    })
  }
  close(id: string): Promise<void> {
    return this.run(async () => {
      await this.flushOne(id)
      const leaseId = this.leases.get(id)
      if (leaseId) await this.rpc('draft.close', { draftId: id, leaseId })
      this.leases.delete(id)
      const draft = this.get(id)
      if (draft && !hasPersistableDraftContent(draft)) this.records.delete(id)
      this.ports.changed()
    })
  }
  remove(id: string): Promise<void> {
    const pending = this.pending.get(id)
    this.pending.delete(id)
    this.deleted.add(id)
    this.ports.changed()
    return this.run(async () => {
      await this.persist()
      try { await this.deleteOne(id) } catch (error) {
        if (error instanceof DraftResponseError) {
          this.deleted.delete(id)
          if (pending) this.pending.set(id, pending)
          await this.persist()
          this.ports.changed()
        }
        throw error
      }
    })
  }
  private async deleteOne(id: string): Promise<void> {
    await this.rpc('draft.delete', { draftId: id, leaseId: this.leases.get(id) })
    this.records.delete(id); this.leases.delete(id); this.deleted.delete(id)
    await this.persist()
    this.ports.changed()
  }
  reconnect(activeId: string | null): Promise<void> {
    return this.run(async () => {
      this.leases.clear()
      for (const id of this.deleted) await this.deleteOne(id)
      for (const id of this.pending.keys()) {
        await this.flushOne(id)
        if (id !== activeId) {
          await this.rpc('draft.close', { draftId: id, leaseId: this.leases.get(id)! })
          this.leases.delete(id)
        }
      }
      // A `draft_changed` pushed while the phone was away (a draft sent or
      // deleted on the desktop) is gone; only the host's list still knows.
      await this.loadRecords()
      if (activeId && !this.leases.has(activeId)) {
        const result = await this.rpc<DraftOpenResult>('draft.open', { draftId: activeId })
        this.leases.set(activeId, result.leaseId)
        this.records.set(activeId, result.draft)
      }
      this.ports.changed()
    })
  }
  ingest(event: DraftChangedEvent): void {
    this.recordRevision++
    if (event.draft) this.records.set(event.draftId, event.draft)
    else this.records.delete(event.draftId)
    if (!event.draft?.controllerDeviceId) this.leases.delete(event.draftId)
    if (event.reason === 'disconnected' || event.reason === 'deleted') this.ports.revoked(event.draftId)
    this.ports.changed()
  }

  /** Replace host rows at a topic snapshot cut; phone outbox edits remain separate. */
  ingestSnapshot(drafts: DraftListEntry[]): void {
    this.recordRevision++
    const next = new Map(drafts.map(draft => [draft.id, draft]))
    const revoked: string[] = []
    for (const id of this.leases.keys()) {
      const previousOwner = this.records.get(id)?.controllerDeviceId
      const owner = next.get(id)?.controllerDeviceId
      if (!owner || (previousOwner && previousOwner !== owner)) {
        this.leases.delete(id)
        revoked.push(id)
      }
    }
    this.records = next
    for (const id of revoked) this.ports.revoked(id)
    this.ports.changed()
  }
}
