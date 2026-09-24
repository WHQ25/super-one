import { statSync } from 'node:fs'
import type { HarnessId, HarnessResourcesMap } from '@superone/shared/agent-types'
import {
  getCachedHarnessResources,
  getHarnessResourceCacheMeta,
  setCachedHarnessResources,
} from '../database'

/** Default disk TTL for harness model/resource catalogs (24h). */
export const HARNESS_RESOURCES_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Identity of the harness binary a catalog is probed from. Upgrading,
 * reinstalling or swapping the binary on PATH changes it, so a row written by
 * another runtime is re-probed at once instead of waiting out the TTL.
 *
 * Size + mtime rather than a version string: only managed installs know their
 * version, while SDK-bundled, env and PATH binaries do not. The TTL still
 * applies on a match — catalogs also move server-side (Codex `/models`, Claude
 * plan gating) without a new binary.
 */
export function harnessRuntimeCacheKey(binaryPath: string): string | null {
  try {
    const stat = statSync(binaryPath)
    return `${binaryPath}|${stat.size}|${Math.trunc(stat.mtimeMs)}`
  } catch {
    return null
  }
}

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
    /** When set, a row written under a different key (or none) is a miss. */
    cacheKey?: string
    /** Extra predicate — e.g. require `models.length > 0`. */
    isUsable?: (resources: HarnessResourcesMap[H]) => boolean
  },
): FreshHarnessResourcesHit<H> | null {
  if (opts?.force) return null
  const resources = getCachedHarnessResources(harnessId)
  if (!resources) return null
  if (opts?.isUsable && !opts.isUsable(resources)) return null
  const meta = getHarnessResourceCacheMeta(harnessId)
  if (!meta) return null
  if (opts?.cacheKey !== undefined && meta.cacheKey !== opts.cacheKey) return null
  const ttlMs = opts?.ttlMs ?? HARNESS_RESOURCES_CACHE_TTL_MS
  if (meta.ageMs >= ttlMs) return null
  return { resources, ageMs: meta.ageMs }
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
    cacheKey?: string
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
    cacheKey: opts.cacheKey,
    isUsable: opts.isUsable,
  })
  if (hit) {
    opts.onCacheHit?.(hit)
    return hit.resources
  }

  const cached = getCachedHarnessResources(harnessId)
  try {
    const resources = await opts.probe()
    setCachedHarnessResources(harnessId, resources, opts.cacheKey ?? null)
    return resources
  } catch (error) {
    opts.onProbeError?.(error, cached)
    if (opts.fallbackToCacheOnError && cached) return cached
    throw error
  }
}
