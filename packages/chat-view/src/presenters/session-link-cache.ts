import type { SessionRef } from '@superone/shared/environment/refs'
import type { SessionLinkMetadataResult } from '@superone/shared/session-link'

const key = (ref: SessionRef) => JSON.stringify([ref.environmentId, ref.sessionId])
type Request = { ref: SessionRef; resolve(result: SessionLinkMetadataResult): void; promise: Promise<SessionLinkMetadataResult> }

/** One cache per authenticated host adapter. clear() retires pending route results. */
export function createSessionLinkCache(lookup: (refs: SessionRef[], signal: AbortSignal) => Promise<SessionLinkMetadataResult[]>) {
  const cache = new Map<string, { result: SessionLinkMetadataResult; expires: number }>()
  let controller = new AbortController()
  const pending = new Map<string, Request>()
  const requests = new Map<string, Request>()
  const listeners = new Set<() => void>()
  let version = 0
  let running = 0
  let scheduled = false
  const put = (id: string, result: SessionLinkMetadataResult) => {
    cache.delete(id)
    cache.set(id, { result, expires: Date.now() + (result.status === 'ok' ? 300_000 : 30_000) })
    if (cache.size > 512) cache.delete(cache.keys().next().value!)
  }
  const drain = () => {
    scheduled = false
    while (running < 2 && pending.size) {
      const batch = [...pending.entries()].slice(0, 50)
      for (const [id] of batch) pending.delete(id)
      const signal = controller.signal
      running++
      void Promise.resolve().then(() => signal.aborted ? [] : lookup(batch.map(([, entry]) => entry.ref), signal)).catch(() => []).then(results => {
        const byRef = new Map((Array.isArray(results) ? results : []).filter(result => result?.status === 'ok' ? result.metadata?.ref : result?.ref).map(result => [key(result.status === 'ok' ? result.metadata.ref : result.ref), result]))
        for (const [id, entry] of batch) {
          const result = byRef.get(id) ?? { status: 'unavailable' as const, ref: entry.ref }
          if (!signal.aborted) put(id, result)
          if (requests.get(id) === entry) requests.delete(id)
          entry.resolve(signal.aborted ? { status: 'unavailable', ref: entry.ref } : result)
        }
      }).finally(() => { if (!signal.aborted) { running--; drain() } })
    }
  }
  return {
    get(ref: SessionRef): Promise<SessionLinkMetadataResult> {
      const id = key(ref)
      const hit = cache.get(id)
      if (hit && hit.expires > Date.now()) return Promise.resolve(hit.result)
      const queued = requests.get(id)
      if (queued) return queued.promise
      let resolve!: Request['resolve']
      const promise = new Promise<SessionLinkMetadataResult>(done => { resolve = done })
      const request = { ref, resolve, promise }
      pending.set(id, request); requests.set(id, request)
      if (!scheduled) { scheduled = true; queueMicrotask(drain) }
      return promise
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => version,
    clear() {
      controller.abort(); controller = new AbortController(); running = 0; cache.clear()
      for (const entry of requests.values()) entry.resolve({ status: 'unavailable', ref: entry.ref })
      requests.clear(); pending.clear()
      version++; for (const listener of listeners) listener()
    },
  }
}
