export type TransportMetric = {
  kind: 'rpc' | 'wire-in' | 'wire-out' | 'decoded' | 'encode' | 'decrypt' | 'milestone'
  name: string
  bytes?: number
  count?: number
  durationMs?: number
  transport?: 'lan' | 'relay'
}
export type LedgerRow = Required<Omit<TransportMetric, 'transport'>> & { transport?: 'lan' | 'relay' }
export type LedgerSnapshot = { moment: string; rows: LedgerRow[] }

/** Aggregates only labels and numbers, never payloads, paths, device IDs or keys. */
export class TransportLedger {
  private rows = new Map<string, LedgerRow>()
  private moment = 'idle'
  private started = performance.now()

  record(metric: TransportMetric): void {
    const key = `${metric.kind}:${metric.name}:${metric.transport ?? ''}`
    if (!this.rows.has(key) && this.rows.size >= 256) return
    const row = this.rows.get(key) ?? { ...metric, bytes: 0, count: 0, durationMs: 0 }
    row.count += metric.count ?? 1
    row.bytes += metric.bytes ?? 0
    row.durationMs += metric.durationMs ?? 0
    this.rows.set(key, row)
  }

  mark(moment: string): void { this.reset(); this.moment = moment }
  checkpoint(name: string): void { this.record({ kind: 'milestone', name, durationMs: performance.now() - this.started }) }
  reset(): void { this.rows.clear(); this.started = performance.now() }
  snapshot(): LedgerSnapshot { return { moment: this.moment, rows: [...this.rows.values()].map(row => ({ ...row })) } }
}

export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length
}
