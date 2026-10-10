import type { MobileRpcClient } from './runtime-session-rpc'
import type { MobileLogEntry } from '@superone/shared/agent-types'

export type DiagnosticFields = NonNullable<MobileLogEntry['fields']>

/** Kept while offline as well: what happened during a disconnect is the point. */
const CAPACITY = 1_000
const BATCH = 200

let held: Array<MobileLogEntry & { seq: number }> = []
let nextSeq = 0

/** Payload-free facts only — never message content, paths of files read, or secrets. */
export function recordDiagnostic(tag: string, fields?: DiagnosticFields): void {
  held.push({ seq: nextSeq++, at: new Date().toISOString(), tag, ...(fields ? { fields } : {}) })
  if (held.length > CAPACITY) held = held.slice(-CAPACITY)
}

/**
 * Send what is held to the desktop's `mobile.log`, oldest first, forgetting a
 * line only once the desktop has written it. False when the desktop did not take
 * a batch — an older one never answers the command — so the caller stops until
 * the next connection instead of asking again every interval.
 */
export async function uploadDiagnostics(client: Pick<MobileRpcClient, 'rpc'>): Promise<boolean> {
  while (held.length) {
    const batch = held.slice(0, BATCH)
    const last = batch[batch.length - 1].seq
    try {
      const result = await client.rpc('client.appendLog', { entries: batch.map(({ seq: _seq, ...entry }) => entry) }) as { written?: unknown } | null
      if (typeof result?.written !== 'number') return false
    } catch {
      return false
    }
    held = held.filter(entry => entry.seq > last)
  }
  return true
}

/** Upload now, then on an interval, for as long as one connection lasts. */
export function startDiagnosticUpload(client: Pick<MobileRpcClient, 'rpc'>, intervalMs = 30_000): { flush(): void; stop(): void } {
  let stopped = false
  let running = false
  const stop = () => { stopped = true; clearInterval(timer) }
  const flush = () => {
    if (stopped || running) return
    running = true
    void uploadDiagnostics(client).then(ok => { if (!ok) stop() }).finally(() => { running = false })
  }
  const timer = setInterval(flush, intervalMs)
  flush()
  return { flush, stop }
}
