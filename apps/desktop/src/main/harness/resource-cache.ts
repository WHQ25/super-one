import type { HarnessId, HarnessResourcesMap } from '@superone/shared/agent-types'
import {
  getCachedHarnessResources,
  getHarnessResourceCacheAgeMs,
  setCachedHarnessResources,
} from '../database'

/** Default disk TTL for harness model/resource catalogs (24h). */
export const HARNESS_RESOURCES_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface FreshHarnessResourcesHit<H extends HarnessId> {
  resources: HarnessResourcesMap[H]
  ageMs: number
}

/**
 * Return cached harness resources when fresh and usable.
 * Returns null when the caller should probe the remote/runtime catalog.
 */
export function getFreshHarnessResources<H extends HarnessId>(
  harnessId: H,
  opts?: {
    force?: boolean
    ttlMs?: number
    /** Extra predicate — e.g. require `models.length > 0`. */
    isUsable?: (resources: HarnessResourcesMap[H]) => boolean
  },
): FreshHarnessResourcesHit<H> | null {
  if (opts?.force) return null
  const resources = getCachedHarnessResources(harnessId)
  if (!resources) return null
  if (opts?.isUsable && !opts.isUsable(resources)) return null
  const ageMs = getHarnessResourceCacheAgeMs(harnessId)
  const ttlMs = opts?.ttlMs ?? HARNESS_RESOURCES_CACHE_TTL_MS
  if (ageMs === null || ageMs >= ttlMs) return null
  return { resources, ageMs }
}

/**
 * Probe harness resources with a shared disk-cache contract:
 * fresh cache → return; else probe → write; on failure optionally fall back to stale cache.
 */
export async function connectWithHarnessResourceCache<H extends HarnessId>(
  harnessId: H,
  opts: {
    force?: boolean
    ttlMs?: number
    isUsable?: (resources: HarnessResourcesMap[H]) => boolean
    probe: () => Promise<HarnessResourcesMap[H]>
    /** When probe fails, return stale cache instead of throwing. */
    fallbackToCacheOnError?: boolean
    onCacheHit?: (hit: FreshHarnessResourcesHit<H>) => void
    onProbeError?: (error: unknown, cached: HarnessResourcesMap[H] | null) => void
  },
): Promise<HarnessResourcesMap[H]> {
  const hit = getFreshHarnessResources(harnessId, {
    force: opts.force,
    ttlMs: opts.ttlMs,
    isUsable: opts.isUsable,
  })
  if (hit) {
    opts.onCacheHit?.(hit)
    return hit.resources
  }

  const cached = getCachedHarnessResources(harnessId)
  try {
    const resources = await opts.probe()
    setCachedHarnessResources(harnessId, resources)
    return resources
  } catch (error) {
    opts.onProbeError?.(error, cached)
    if (opts.fallbackToCacheOnError && cached) return cached
    throw error
  }
}
