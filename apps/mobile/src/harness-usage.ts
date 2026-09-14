import type { RelayClient } from '@superone/relay-client'
import type { ClaudeRateLimitWindow, CodexRateLimitResetOutcome, HarnessId, RemoteCommand, RemoteUsage } from '@superone/shared/agent-types'
import { randomId } from './ids'

/** The credential a session bills, named the way the composer selection does. */
export type UsageTarget = {
  projectPath: string
  provider: HarnessId
  sessionId: string | null
  apiProviderId: string | null
  acpAgentId: string | null
}

/** Same meter for the same credential: a session switch on one account keeps its reading. */
export function usageTargetKey(target: UsageTarget | null): string | null {
  if (!target) return null
  return JSON.stringify([target.projectPath, target.provider, target.apiProviderId ?? '', target.acpAgentId ?? ''])
}

/** Past this age an open panel asks the host for a fresh reading instead of its cache. */
export const USAGE_STALE_MS = 5 * 60_000

export function usageIsStale(usage: RemoteUsage | null, now = Date.now()): boolean {
  return usage?.fetchedAt == null || now - usage.fetchedAt > USAGE_STALE_MS
}

/** The window a compact gauge shows: the short one when the meter has it, else the first. */
export function usageBadgeWindow(usage: RemoteUsage | null): ClaudeRateLimitWindow | null {
  if (!usage?.windows.length) return null
  return usage.windows.find((window) => window.label === '5h') ?? usage.windows[0]
}

export function remainingPercent(usedPercent: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)))
}

/** A host error or an older desktop without `get_usage` both read as "no meter". */
export async function fetchHarnessUsage(
  client: Pick<RelayClient, 'request'>,
  target: UsageTarget,
  force = false,
): Promise<RemoteUsage | null> {
  const result = await client.request({
    type: 'get_usage', requestId: randomId(), ...target, force,
  } as RemoteCommand).catch(() => null) as { usage?: RemoteUsage | null; error?: string } | null
  if (!result || result.error) return null
  return result.usage ?? null
}

/**
 * Redeem a Codex reset credit; `null` covers the host failing, an API-key
 * session, or a desktop without the command. Re-read the meter afterwards.
 */
export async function consumeRateLimitReset(
  client: Pick<RelayClient, 'request'>,
  target: Pick<UsageTarget, 'projectPath' | 'apiProviderId'>,
  creditId: string | null = null,
): Promise<CodexRateLimitResetOutcome | null> {
  const result = await client.request({
    type: 'consume_rate_limit_reset', requestId: randomId(),
    projectPath: target.projectPath, apiProviderId: target.apiProviderId, creditId,
  } as RemoteCommand).catch(() => null) as { outcome?: CodexRateLimitResetOutcome | null; error?: string } | null
  if (!result || result.error) return null
  return result.outcome ?? null
}

export type MeterTone = 'success' | 'warning' | 'error'

/** Desktop gauge thresholds on the remaining share: green above 30%, amber to 10%, red below. */
export function usageTone(usedPercent: number): MeterTone {
  const remaining = remainingPercent(usedPercent)
  return remaining <= 10 ? 'error' : remaining <= 30 ? 'warning' : 'success'
}

/** `null` when the window has no reset time; `'soon'` once it has passed. */
export function formatResetIn(resetsAtSeconds: number | null | undefined, now = Date.now()): string | 'soon' | null {
  if (!resetsAtSeconds) return null
  const diffMs = resetsAtSeconds * 1000 - now
  if (diffMs <= 0) return 'soon'
  const totalMin = Math.round(diffMs / 60_000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const minutes = totalMin % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${Math.max(1, minutes)}m`
}

/** Whole minutes since the host read the meter; `null` when it never said. */
export function updatedAgoMinutes(fetchedAt: number | null | undefined, now = Date.now()): number | null {
  if (fetchedAt == null) return null
  return Math.max(0, Math.floor((now - fetchedAt) / 60_000))
}

export type LiveRateLimit = {
  status: 'allowed_warning' | 'rejected'
  resetsAt?: number
  utilization?: number
}

/** The live `rate_limit` event still applies until the reset it names has passed. */
export function activeRateLimit<T extends LiveRateLimit>(info: T | null | undefined, now = Date.now()): T | null {
  if (!info) return null
  if (info.resetsAt != null && info.resetsAt * 1000 <= now) return null
  return info
}
