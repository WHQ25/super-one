/**
 * Grok Build credits → the shared usage-gauge shape.
 *
 * Source is the `_x.ai/billing` ACP extension, which `grok agent stdio` answers
 * from the account's coding-credits pool (`GetGrokCreditsConfig`) enriched with
 * the subscription tier from remote settings. This is the pool that actually
 * runs out mid-session — distinct from the developer `api.x.ai` rate limits an
 * `XAI_API_KEY` would report.
 *
 * The response is `{ config: {...}, subscription_tier }`: the outer object is
 * snake_case, the inner config camelCase, and every money value is a `Cent`
 * wrapper (`{ val }`) that proto3 flattens to `{}` when zero. Reads here accept
 * both cases so a wire tweak degrades to a missing row, not a crash.
 */

import type { ClaudeRateLimitWindow, ProviderRateLimits } from '@superone/shared/agent-types'

const TITLE = 'Grok Build'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function pick(source: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!source) return undefined
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key]
  }
  return undefined
}

function num(source: Record<string, unknown> | null, ...keys: string[]): number | null {
  const value = pick(source, ...keys)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(source: Record<string, unknown> | null, ...keys: string[]): string | null {
  const value = pick(source, ...keys)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** A `Cent` wrapper in USD cents. `{}` is a real zero (proto3 omits it), absent is unknown. */
function cents(source: Record<string, unknown> | null, ...keys: string[]): number | null {
  const wrapper = asRecord(pick(source, ...keys))
  if (!wrapper) return null
  return num(wrapper, 'val') ?? 0
}

function epochSeconds(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

/** Mirrors Grok's own `CreditBalance::usage_label`. */
function periodLabel(periodType: string | null): string {
  if (periodType?.includes('WEEKLY')) return 'Weekly limit'
  if (periodType?.includes('MONTHLY')) return 'Monthly limit'
  return 'Usage'
}

export function parseGrokBilling(raw: unknown): ProviderRateLimits | null {
  const envelope = asRecord(raw)
  if (!envelope) return null
  // The agent may answer bare or wrapped; the Grok TUI unwraps the same way.
  const body = asRecord(envelope.result) ?? envelope
  const config = asRecord(pick(body, 'config'))
  if (!config) return null

  const period = asRecord(pick(config, 'currentPeriod', 'current_period'))
  const periodEnd = str(period, 'end')
    ?? str(config, 'billingPeriodEnd', 'billing_period_end')

  const limitCents = cents(config, 'monthlyLimit', 'monthly_limit')
  const usedCents = cents(config, 'used')
  const usedPercent = num(config, 'creditUsagePercent', 'credit_usage_percent')
    ?? (limitCents && limitCents > 0 && usedCents != null
      ? (usedCents / limitCents) * 100
      : null)
    // proto3 / grok agent omit a 0% `creditUsagePercent` at the start of a new
    // period. If we still have a period, that is occupancy 0, not "no data".
    ?? (period || periodEnd ? 0 : null)
  // No occupancy signal at all — an empty gauge is worse than no gauge.
  if (usedPercent == null) return null

  const windows: ClaudeRateLimitWindow[] = [{
    label: periodLabel(str(period, 'type', 'period_type')),
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetsAt: epochSeconds(periodEnd),
  }]

  // On-demand overflow only exists once the user set a cap; `extraUsage` renders
  // it as the same "$used / $limit" row Claude uses for its extra-usage spend.
  const onDemandCap = cents(config, 'onDemandCap', 'on_demand_cap')
  const onDemandUsed = cents(config, 'onDemandUsed', 'on_demand_used')
  const extraUsage = onDemandCap && onDemandCap > 0
    ? { usedDollars: (onDemandUsed ?? 0) / 100, limitDollars: onDemandCap / 100 }
    : null

  const prepaid = cents(config, 'prepaidBalance', 'prepaid_balance')

  return {
    title: TITLE,
    planType: str(body, 'subscription_tier', 'subscriptionTier'),
    windows,
    extraUsage,
    ...(prepaid && prepaid > 0 ? { creditBalanceDollars: prepaid / 100 } : {}),
    fetchedAt: Date.now(),
  }
}
