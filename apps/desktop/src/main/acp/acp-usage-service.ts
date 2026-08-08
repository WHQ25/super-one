/**
 * Cached account credits for the ACP usage gauge.
 *
 * Billing is account-scoped, but the only way to ask for it is a live ACP
 * runtime (`_x.ai/billing` rides the session connection and its grok.com auth).
 * So: read through whichever session still has a runtime, and keep the last
 * answer so the panel stays populated after idle release tears runtimes down.
 */

import log from '../logger'
import type { ProviderRateLimits } from '@superone/shared/agent-types'
import type { Session as SessionContract } from '../session/types'

const MIN_FETCH_INTERVAL_MS = 60 * 1000

interface CacheEntry {
  data: ProviderRateLimits
  lastFetchMs: number
}

const cache = new Map<string, CacheEntry>()

/** Cache key: the agent's account, approximated by agent id (one login per agent). */
function cacheKey(agentId: string): string {
  return agentId
}

export function clearAcpRateLimitCache(): void {
  cache.clear()
}

export async function getAcpRateLimits(
  agentId: string,
  session: SessionContract | null | undefined,
  force = false,
): Promise<ProviderRateLimits | null> {
  const key = cacheKey(agentId)
  const cached = cache.get(key)
  const nowMs = Date.now()
  if (!force && cached && nowMs - cached.lastFetchMs < MIN_FETCH_INTERVAL_MS) return cached.data
  if (!session) return cached?.data ?? null

  try {
    const fresh = await session.getRateLimits()
    if (!fresh) return cached?.data ?? null
    cache.set(key, { data: fresh, lastFetchMs: nowMs })
    return fresh
  } catch (err) {
    log.debug('[acp-usage] rate limit fetch failed agent=%s:', agentId, err)
    return cached?.data ?? null
  }
}
