import type { Kv } from '@superone/relay-client'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_ENTRIES = 128

/** Derived metadata only. Pairing credentials and draft outboxes use other keys. */
export class PersistedWorkspace {
  private values = new Map<string, unknown>()
  private writes: Promise<void> = Promise.resolve()
  private stopped = false
  private readonly key: string

  constructor(private kv: Kv, readonly pairingId: string) { this.key = `workspace-cache.v1.${pairingId}` }

  async load(): Promise<void> {
    try {
      const raw = await this.kv.get(this.key)
      if (!raw || this.stopped || new TextEncoder().encode(raw).length > MAX_BYTES) return
      const data = JSON.parse(raw) as { version: number; entries: Array<[string, unknown]> }
      if (data.version === 1 && Array.isArray(data.entries)) {
        this.values = new Map(data.entries.filter(row => Array.isArray(row) && row.length === 2 && typeof row[0] === 'string').slice(-MAX_ENTRIES))
      }
    } catch { /* corrupt/obsolete cache is a miss */ }
  }

  get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined }

  set(key: string, value: unknown): void {
    if (this.stopped) return
    const encode = () => JSON.stringify({ version: 1, entries: [...this.values] })
    if (new TextEncoder().encode(JSON.stringify(value) ?? '').length > MAX_BYTES / 2) return
    this.values.delete(key)
    this.values.set(key, value)
    while (this.values.size > MAX_ENTRIES || new TextEncoder().encode(encode()).length > MAX_BYTES) {
      this.values.delete(this.values.keys().next().value!)
    }
    const serialized = encode()
    this.writes = this.writes.then(() => this.stopped ? undefined : this.kv.set(this.key, serialized)).catch(() => {})
  }

  flush(): Promise<void> { return this.writes }
  dispose(): void { this.stopped = true }
  async forget(): Promise<void> {
    this.dispose()
    this.values.clear()
    await this.writes
    await this.kv.set(this.key, '')
  }
}
