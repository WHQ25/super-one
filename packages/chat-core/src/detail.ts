/**
 * On-demand detail behind a summarized row (`remoteDetail`), independent of
 * how it travels. A frontend opens a row's detail: the client subscribes
 * through the injected transport, applies the revision-0 snapshot and then
 * the live `remote_detail` packets in revision order, and caches completed
 * text. Packets are a common-prefix offset plus the new suffix
 * (docs/architecture/mobile-remote-control.md, "Hidden detail").
 */

import type { DetailTarget, DetailUpdate } from '@superone/shared/environment/detail'

export type { DetailTarget, DetailUpdate }

export interface DetailTransport {
  /** Register interest and resolve with the revision-0 snapshot; later packets arrive through `deliver`. */
  subscribe(target: DetailTarget, subscriptionId: string): Promise<DetailUpdate>
  unsubscribe(target: DetailTarget, subscriptionId: string): void
}

export interface DetailClientOptions {
  newId(): string
  /** Retained text, in UTF-16 code units, across every cached detail. */
  maxCachedChars?: number
}

export interface DetailOpenOptions {
  /** The row is done: cached complete text is reused and the stream closes after the snapshot. */
  complete: boolean
  onText(text: string): void
  onError(message: string): void
  onSettled(): void
}

export interface DetailClient {
  /** A `remote_detail` packet from the session stream. */
  deliver(update: DetailUpdate): void
  /** Open the details of `targets` (joined in order); returns the close. */
  open(targets: readonly DetailTarget[], options: DetailOpenOptions): () => void
  cached(target: DetailTarget): { text: string; complete: boolean } | undefined
}

export const DETAIL_CACHE_MAX_CHARS = 1_000_000

/** Apply one packet; an offset past the text means packets were lost. */
export function applyDetailUpdate(text: string, update: Pick<DetailUpdate, 'offset' | 'text'>): string {
  if (update.offset > text.length) throw new Error('Detail stream interrupted. Please reopen it.')
  return text.slice(0, update.offset) + update.text
}

export function detailCacheKey(target: DetailTarget): string {
  return JSON.stringify([target.environmentId, target.sessionId, target.detailRef])
}

export function createDetailClient(transport: DetailTransport, options: DetailClientOptions): DetailClient {
  const maxChars = options.maxCachedChars ?? DETAIL_CACHE_MAX_CHARS
  const listeners = new Map<string, (update: DetailUpdate) => void>()
  const cache = new Map<string, { text: string; complete: boolean }>()
  let cachedChars = 0

  const read = (target: DetailTarget) => {
    const key = detailCacheKey(target)
    const entry = cache.get(key)
    if (entry) { cache.delete(key); cache.set(key, entry) }
    return entry
  }
  const write = (target: DetailTarget, text: string, complete: boolean): void => {
    const key = detailCacheKey(target)
    cachedChars -= cache.get(key)?.text.length ?? 0
    cache.delete(key)
    if (text.length <= maxChars) { cache.set(key, { text, complete }); cachedChars += text.length }
    while (cachedChars > maxChars) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cachedChars -= cache.get(oldest)!.text.length
      cache.delete(oldest)
    }
  }

  return {
    deliver(update) {
      listeners.get(update.subscriptionId)?.(update)
    },
    cached: read,
    open(targets, { complete, onText, onError, onSettled }) {
      let disposed = false
      const cleanups: Array<() => void> = []
      const texts = targets.map((target) => read(target)?.text ?? '')
      onText(texts.join('\n\n'))
      void Promise.all(targets.map(async (target, index) => {
        if (complete && read(target)?.complete) return
        // Each expansion owns its stream, so a late reply cannot reopen it.
        const subscriptionId = options.newId()
        let revision = -1
        let ready = false
        const buffered: DetailUpdate[] = []
        const apply = (update: DetailUpdate) => {
          if (disposed || update.revision <= revision) return
          texts[index] = applyDetailUpdate(texts[index]!, update)
          revision = update.revision
          write(target, texts[index]!, complete)
          onText(texts.join('\n\n'))
        }
        let released = false
        listeners.set(subscriptionId, (update) => {
          if (!ready) buffered.push(update)
          else {
            try { apply(update) } catch (error) { onError(error instanceof Error ? error.message : String(error)) }
          }
        })
        const release = () => {
          if (released) return
          released = true
          listeners.delete(subscriptionId)
          transport.unsubscribe(target, subscriptionId)
        }
        cleanups.push(release)
        const snapshot = await transport.subscribe(target, subscriptionId)
        if (disposed) return
        apply(snapshot)
        ready = true
        buffered.sort((a, b) => a.revision - b.revision).forEach(apply)
        if (complete) release()
      }))
        .catch((error) => {
          cleanups.forEach((cleanup) => cleanup())
          if (!disposed) onError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => { if (!disposed) onSettled() })
      return () => {
        disposed = true
        cleanups.forEach((cleanup) => cleanup())
      }
    },
  }
}
