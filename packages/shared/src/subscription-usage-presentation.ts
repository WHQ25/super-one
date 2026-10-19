import { USAGE_FRESH_MS, type UsageWindow } from './subscription-usage'
import type { ClaudeExtraUsage, ClaudeResetGrant } from './agent-types'

/** Copy inputs only; each surface supplies its normal translator. No provider or UI dependencies. */
export function usageForecastCopy(window: UsageWindow, now = Date.now()): { key: string; time?: string } | null {
  const forecast = window.forecast
  if (!forecast) return null
  if (forecast.status === 'learning') return null
  if (now - forecast.sampledAt > USAGE_FRESH_MS || (window.resetsAt != null && window.resetsAt * 1000 <= now)) return { key: 'stale' }
  if (window.usedPercent >= 100) return { key: 'exhausted' }
  if (forecast.status === 'idle') return { key: 'idle' }
  if (forecast.status !== 'ready' || forecast.exhaustsAt == null) return null
  if (window.resetsAt == null || forecast.exhaustsAt <= now || forecast.exhaustsAt >= window.resetsAt * 1000) return null
  return { key: 'eta', time: formatUsageDuration(forecast.exhaustsAt - now) }
}

export function formatUsageDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.ceil(milliseconds / 300_000) * 5)
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
  return `${Math.floor(minutes / 1440)}d${Math.floor(minutes % 1440 / 60) ? ` ${Math.floor(minutes % 1440 / 60)}h` : ''}`
}

/** `$used / $limit`, and the spent share of a capped allowance for a bar. */
export function extraUsageCopy(extra: ClaudeExtraUsage): { value: string; usedPercent: number | null } {
  const used = `$${extra.usedDollars.toFixed(2)}`
  if (extra.limitDollars == null) return { value: used, usedPercent: null }
  return { value: `${used} / $${extra.limitDollars.toFixed(2)}`, usedPercent: Math.min(100, extra.usedDollars / extra.limitDollars * 100) }
}

/** Resets still usable at `now` and the soonest deadline among them (Unix seconds); `null` when none are left. */
export function availableResetGrants(grants: readonly ClaudeResetGrant[] | undefined, now = Date.now()): { count: number; nextExpiresAt: number | null } | null {
  let count = 0
  let nextExpiresAt: number | null = null
  for (const grant of grants ?? []) {
    if (grant.expiresAt != null && grant.expiresAt * 1000 <= now) continue
    count += grant.resetsLeft
    if (grant.expiresAt != null && (nextExpiresAt == null || grant.expiresAt < nextExpiresAt)) nextExpiresAt = grant.expiresAt
  }
  return count > 0 ? { count, nextExpiresAt } : null
}
