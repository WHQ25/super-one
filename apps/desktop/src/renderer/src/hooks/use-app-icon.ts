import { useEffect, useState } from 'react'

/** Bump when main-process icon extraction improves so HMR/reload drops bad entries. */
const CACHE_EPOCH = 4
type CacheEntry = { uri: string | null; at: number }
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<string | null>>()
/** Misses expire so a cold-start / helper race does not blank icons forever. */
const NEGATIVE_CACHE_MS = 15_000

function cacheKey(bundleId: string): string {
  return `${CACHE_EPOCH}:${bundleId}`
}

function readCache(bundleId: string): string | null | undefined {
  const key = cacheKey(bundleId)
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.uri != null) return entry.uri
  if (Date.now() - entry.at < NEGATIVE_CACHE_MS) return null
  cache.delete(key)
  return undefined
}

async function lookup(bundleId: string): Promise<string | null> {
  if (!bundleId) return null
  const key = cacheKey(bundleId)
  const hit = readCache(bundleId)
  if (hit !== undefined) return hit

  let promise = inflight.get(key)
  if (!promise) {
    const resolve = window.app?.resolveComputerUseAppIcon
    if (!resolve) {
      console.warn(
        '[computer-use] useAppIcon: window.app.resolveComputerUseAppIcon missing — restart app to pick up preload',
        bundleId,
      )
      window.app?.trace?.('computer-use.icon', 'preload_missing', { bundleId }, bundleId)
      // Do not cache — preload may become available after a full reload.
      return null
    }
    promise = resolve(bundleId)
      .then((uri) => {
        cache.set(key, { uri, at: Date.now() })
        window.app?.trace?.('computer-use.icon', 'resolved', {
          bundleId,
          ok: !!uri,
          chars: uri?.length ?? 0,
        }, bundleId)
        if (!uri) {
          console.warn('[computer-use] useAppIcon: main returned null for', bundleId)
        }
        return uri
      })
      .catch((err) => {
        console.warn('[computer-use] useAppIcon: IPC failed for', bundleId, err)
        window.app?.trace?.('computer-use.icon', 'ipc_error', {
          bundleId,
          error: err instanceof Error ? err.message : String(err),
        }, bundleId)
        // Transient IPC failure — do not poison the cache.
        return null
      })
      .finally(() => {
        inflight.delete(key)
      })
    inflight.set(key, promise)
  }
  return promise
}

/**
 * Resolve a macOS app icon data URI for a bundle id (main-process cache + renderer cache).
 * Returns undefined while loading / when unavailable so callers can fall back to a glyph.
 */
export function useAppIcon(bundleId?: string | null): string | undefined {
  const [uri, setUri] = useState<string | undefined>(() => {
    if (!bundleId) return undefined
    const cached = readCache(bundleId)
    return cached ?? undefined
  })

  useEffect(() => {
    if (!bundleId) {
      setUri(undefined)
      return
    }
    const cached = readCache(bundleId)
    if (cached !== undefined) {
      // Hit (success or still-valid miss). Misses expire via NEGATIVE_CACHE_MS on next mount.
      setUri(cached ?? undefined)
      return
    }
    let cancelled = false
    window.app?.trace?.('computer-use.icon', 'lookup_start', { bundleId }, bundleId)
    void lookup(bundleId).then((next) => {
      if (!cancelled) setUri(next ?? undefined)
    })
    return () => {
      cancelled = true
    }
  }, [bundleId])

  return uri
}
