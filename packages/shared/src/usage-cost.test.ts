import { describe, expect, it } from 'vitest'
import {
  estimateUsageCostBreakdown,
  estimateUsageCostUsd,
  formatUsd,
} from './usage-cost'

describe('estimateUsageCostBreakdown', () => {
  it('returns null when catalog cost is missing', () => {
    expect(estimateUsageCostBreakdown({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }, null)).toBeNull()
    expect(estimateUsageCostBreakdown({
      inputTokens: 1_000_000,
      outputTokens: 0,
    }, undefined)).toBeNull()
  })

  it('prices input and output at $/MTok', () => {
    const result = estimateUsageCostBreakdown(
      { inputTokens: 2_000_000, outputTokens: 500_000 },
      { input: 3, output: 15 },
    )
    expect(result).toEqual({
      input: 6,
      output: 7.5,
      cacheRead: 0,
      cacheCreation: 0,
      total: 13.5,
    })
  })

  it('uses cacheRead/cacheWrite rates when present', () => {
    const result = estimateUsageCostBreakdown(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 2_000_000,
        cacheCreationTokens: 1_000_000,
      },
      { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    )
    expect(result).toEqual({
      input: 3,
      output: 0,
      cacheRead: 0.6,
      cacheCreation: 3.75,
      total: 7.35,
    })
  })

  it('treats missing cache rates as 0 (no input-price fallback)', () => {
    const result = estimateUsageCostBreakdown(
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 10_000_000,
        cacheCreationTokens: 5_000_000,
      },
      { input: 3, output: 15 },
    )
    expect(result).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
      total: 0,
    })
  })

  it('handles free catalog models (zero rates) as priced $0', () => {
    const result = estimateUsageCostBreakdown(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    )
    expect(result?.total).toBe(0)
    expect(estimateUsageCostUsd(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { input: 0, output: 0 },
    )).toBe(0)
  })
})

describe('formatUsd', () => {
  it('formats common magnitudes', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.0012)).toBe('$0.0012')
    expect(formatUsd(1.234)).toBe('$1.234')
    expect(formatUsd(12.345)).toBe('$12.35')
  })

  it('returns em dash for non-finite', () => {
    expect(formatUsd(Number.NaN)).toBe('—')
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
