import { resolve } from 'node:path'
import type { OpenCodeResources } from '@superone/shared/agent-types'
import { getHarnessResourceCacheMeta } from '../database'
import { connectWithHarnessResourceCache } from '../harness/resource-cache'
import log from '../logger'

const pending = new Map<string, Promise<OpenCodeResources>>()

/** Desktop and mobile discovery must work before an OpenCode session exists. */
export function connectOpenCodeResources(cwd: string, force = false): Promise<OpenCodeResources> {
  const directory = resolve(cwd)
  const key = JSON.stringify([directory, force])
  const existing = pending.get(key)
  if (existing) return existing

  const request = connectWithHarnessResourceCache('opencode', {
    force,
    cacheKey: directory,
    // Providers and location catalogs can settle at different times on a cold
    // server. A partial result must not suppress discovery for the full TTL.
    isUsable: (resources) => resources.models.length > 0 && resources.agents.length > 0,
    // Agents and commands are location-specific; never fall back to another project.
    fallbackToCacheOnError: !force && getHarnessResourceCacheMeta('opencode')?.cacheKey === directory,
    probe: async () => {
      const { probeOpenCodeResources } = await import('./opencode-runtime')
      return probeOpenCodeResources({ cwd: directory })
    },
    onCacheHit: (hit) => log.info('[CONNECT_OPENCODE] cache fresh (ageMs=%d), skipping probe', hit.ageMs),
    onProbeError: (error) => log.warn('[CONNECT_OPENCODE] failed: %s', error instanceof Error ? error.message : String(error)),
  }).finally(() => { pending.delete(key) })
  pending.set(key, request)
  return request
}
