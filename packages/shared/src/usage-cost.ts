import type { CatalogModelCost } from './model-catalog-types'

/** Token breakdown matching usage_daily / UsagePage rows. */
export interface UsageTokenBreakdown {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

/** Cost split by token class (USD). Missing catalog rates contribute 0 for that class. */
export interface UsageCostBreakdown {
  total: number
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

const PER_MILLION = 1_000_000

/**
 * Estimate API-equivalent USD cost from models.dev (or equivalent) rates.
 *
 * Rates are $/million tokens. When `cost` is missing, returns `null` (unpriced model).
 * When `cacheRead` / `cacheWrite` are omitted on the price entry, those token classes
 * contribute $0 (caller policy: do not fall back to input price).
 */
export function estimateUsageCostBreakdown(
  tokens: UsageTokenBreakdown,
  cost: CatalogModelCost | null | undefined,
): UsageCostBreakdown | null {
  if (!cost) return null

  const input = (tokens.inputTokens / PER_MILLION) * cost.input
  const output = (tokens.outputTokens / PER_MILLION) * cost.output
  const cacheRead = ((tokens.cacheReadTokens ?? 0) / PER_MILLION) * (cost.cacheRead ?? 0)
  const cacheCreation = ((tokens.cacheCreationTokens ?? 0) / PER_MILLION) * (cost.cacheWrite ?? 0)

  return {
    input,
    output,
    cacheRead,
    cacheCreation,
    total: input + output + cacheRead + cacheCreation,
  }
}

/** Convenience: total USD only, or null when the model has no catalog cost. */
export function estimateUsageCostUsd(
  tokens: UsageTokenBreakdown,
  cost: CatalogModelCost | null | undefined,
): number | null {
  return estimateUsageCostBreakdown(tokens, cost)?.total ?? null
}

/** Compact USD formatter for usage UI ($0.00 / $0.0012 / $12.34). */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '—'
  const abs = Math.abs(amount)
  if (abs === 0) return '$0.00'
  if (abs < 0.01) return `$${amount.toFixed(4)}`
  if (abs < 10) return `$${amount.toFixed(3)}`
  return `$${amount.toFixed(2)}`
}
