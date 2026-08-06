/**
 * Node-side Claude model catalog.
 *
 * `harness.resources` is called on every remote project open, so the catalog is
 * cached: spawning the harness once per request would add seconds to session
 * startup. Empty results are never cached — a failed probe must be retried, not
 * remembered as "this node has no models".
 */

import { fetchClaudeModels } from '@superone/claude'
import type { ModelOption } from '@superone/shared/agent-types'

const CATALOG_TTL_MS = 5 * 60_000

interface CacheEntry {
  fetchedAt: number
  models: ModelOption[]
}

const cache = new Map<string, CacheEntry>()

export interface NodeClaudeModelCatalogOptions {
  /** Project directory the probe runs in. */
  cwd: string
  /** Harness binary; defaults to the Agent SDK bundled platform binary. */
  binaryPath?: string | null
  /** Injectable probe (tests). */
  fetchModels?: (opts: { cwd: string; binaryPath?: string | null }) => Promise<ModelOption[]>
  /** Injectable clock (tests). */
  now?: () => number
}

/** Models this node's Claude harness reports, cached per binary. */
export async function getNodeClaudeModelCatalog(
  opts: NodeClaudeModelCatalogOptions,
): Promise<ModelOption[]> {
  const now = opts.now ?? Date.now
  const key = opts.binaryPath ?? 'sdk-bundled'
  const hit = cache.get(key)
  if (hit && now() - hit.fetchedAt < CATALOG_TTL_MS) return hit.models

  const fetchModels = opts.fetchModels ?? fetchClaudeModels
  const models = await fetchModels({ cwd: opts.cwd, binaryPath: opts.binaryPath })
  if (models.length > 0) cache.set(key, { fetchedAt: now(), models })
  else cache.delete(key)
  return models
}

export function resetNodeClaudeModelCatalogForTests(): void {
  cache.clear()
}
