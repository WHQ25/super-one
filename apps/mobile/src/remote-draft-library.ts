import type { Kv } from '@superone/relay-client'
import type { DraftChangedEvent, DraftListEntry, DraftOpenResult, DraftRemoteCommand, DraftUpsertRequest } from '@superone/shared/environment/draft-rpc'
import { randomId } from './ids'
import { hasPersistableDraftContent } from '@superone/shared/environment/draft-content'

type Pending = { input: DraftUpsertRequest; baseUpdatedAt?: string }
class DraftResponseError extends Error {}
type Ports = {
  kv: Kv
  key: string
  request(command: DraftRemoteCommand): Promise<unknown>
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
  private async request<T>(command: DraftRemoteCommand): Promise<T> {
    const result = await this.ports.request(command) as T & { error?: string; ok?: boolean }
    if (result?.error || result?.ok === false) throw new DraftResponseError(result.error ?? 'Could not synchronize draft')
    return result
  }
  stage(input: DraftUpsertRequest): Promise<unknown> {
    const previous = this.pending.get(input.id)
    this.pending.set(input.id, { input, baseUpdatedAt: previous?.baseUpdatedAt ?? this.records.get(input.id)?.updatedAt })
    this.ports.changed()
    return this.ready.then(() => this.persist())
  }
  refresh(): Promise<void> {
    return this.run(async () => {
      const { drafts } = await this.request<{ drafts: DraftListEntry[] }>({ type: 'list_drafts', requestId: randomId() })
      this.records = new Map(drafts.map((row) => [row.id, row]))
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
      const result = await this.request<DraftOpenResult>({ type: 'open_draft', draftId: id, requestId: randomId() })
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
        const opened = await this.request<DraftOpenResult>({ type: 'open_draft', requestId: randomId(), draftId: id, expectedUpdatedAt: item.baseUpdatedAt })
        this.leases.set(id, opened.leaseId)
      }
      const result = await this.request<DraftOpenResult>({ type: 'save_draft', requestId: randomId(), draft: item.input, leaseId: this.leases.get(id) })
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
      const opened = await this.request<DraftOpenResult>({ type: 'open_draft', requestId: randomId(), draftId: id, omitContent: true })
      this.leases.set(id, opened.leaseId)
      return { draftId: id, draftLeaseId: opened.leaseId }
    })
  }
  close(id: string): Promise<void> {
    return this.run(async () => {
      await this.flushOne(id)
      const leaseId = this.leases.get(id)
      if (leaseId) await this.request({ type: 'close_draft', requestId: randomId(), draftId: id, leaseId })
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
    await this.request({ type: 'delete_draft', requestId: randomId(), draftId: id, leaseId: this.leases.get(id) })
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
          await this.request({ type: 'close_draft', requestId: randomId(), draftId: id, leaseId: this.leases.get(id)! })
          this.leases.delete(id)
        }
      }
      if (activeId && !this.leases.has(activeId)) {
        const result = await this.request<DraftOpenResult>({ type: 'open_draft', requestId: randomId(), draftId: activeId })
        this.leases.set(activeId, result.leaseId)
        this.records.set(activeId, result.draft)
      }
      this.ports.changed()
    })
  }
  ingest(event: DraftChangedEvent): void {
    if (event.draft) this.records.set(event.draftId, event.draft)
    else this.records.delete(event.draftId)
    if (!event.draft?.controllerDeviceId) this.leases.delete(event.draftId)
    if (event.reason === 'disconnected' || event.reason === 'deleted') this.ports.revoked(event.draftId)
    this.ports.changed()
  }
}
