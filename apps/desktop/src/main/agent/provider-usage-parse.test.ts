import { describe, it, expect } from 'vitest'
import { detectProvider, parseGlmUsage, parseMinimaxUsage } from './provider-usage-parse'

describe('detectProvider', () => {
  it('detects GLM CN from bigmodel base url', () => {
    expect(detectProvider('https://open.bigmodel.cn/api/anthropic')).toMatchObject({ brand: 'glm', region: 'cn', origin: 'https://open.bigmodel.cn', title: 'GLM' })
  })
  it('detects GLM global from z.ai base url', () => {
    expect(detectProvider('https://api.z.ai/api/anthropic')).toMatchObject({ brand: 'glm', region: 'global', origin: 'https://api.z.ai' })
  })
  it('detects MiniMax CN and global', () => {
    expect(detectProvider('https://api.minimaxi.com/anthropic')).toMatchObject({ brand: 'minimax', region: 'cn' })
    expect(detectProvider('https://api.minimax.io/anthropic')).toMatchObject({ brand: 'minimax', region: 'global' })
  })
  it('returns null for unrelated or invalid urls', () => {
    expect(detectProvider('https://api.anthropic.com')).toBeNull()
    expect(detectProvider('not a url')).toBeNull()
    expect(detectProvider(null)).toBeNull()
  })
})

describe('parseGlmUsage', () => {
  it('maps TOKENS_LIMIT unit 3/6 to Session/Weekly windows with reset times', () => {
    const reset = 1_900_000_000_000 // epoch ms
    const result = parseGlmUsage(
      { productName: 'glm coding pro' },
      { data: { limits: [
        { type: 'TOKENS_LIMIT', unit: 3, percentage: 42, nextResetTime: reset },
        { type: 'TOKENS_LIMIT', unit: 6, percentage: 12, nextResetTime: reset },
      ] } },
      'GLM',
    )
    expect(result.title).toBe('GLM')
    expect(result.planType).toBe('Glm Coding Pro')
    expect(result.windows).toEqual([
      { label: 'Session', usedPercent: 42, resetsAt: 1_900_000_000 },
      { label: 'Weekly', usedPercent: 12, resetsAt: 1_900_000_000 },
    ])
  })

  it('maps TIME_LIMIT to a Web Searches percent window', () => {
    const result = parseGlmUsage(null, { limits: [{ type: 'TIME_LIMIT', currentValue: 5, usage: 20 }] }, 'GLM')
    expect(result.windows).toEqual([{ label: 'Web Searches', usedPercent: 25, resetsAt: null }])
    expect(result.planType).toBeNull()
  })

  it('returns no windows when quota has no limits', () => {
    expect(parseGlmUsage(null, {}, 'GLM').windows).toEqual([])
  })
})

describe('parseMinimaxUsage', () => {
  it('computes used percent from total and remaining count', () => {
    const result = parseMinimaxUsage(
      { data: { model_remains: [{ current_interval_total_count: 100, current_interval_remaining_count: 30, end_time: 1_900_000_000 }] } },
      'global',
      'MiniMax',
    )
    expect(result.title).toBe('MiniMax')
    expect(result.planType).toBe('Starter')
    expect(result.windows).toEqual([{ label: 'Session', usedPercent: 70, resetsAt: 1_900_000_000 }])
  })

  it('falls back to remaining percent when total is absent', () => {
    const result = parseMinimaxUsage(
      { model_remains: [{ current_interval_total_count: 0, current_interval_remaining_percent: 80, end_time: 1_900_000_000_000 }] },
      'global',
      'MiniMax',
    )
    expect(result.windows[0].usedPercent).toBe(20)
    expect(result.windows[0].resetsAt).toBe(1_900_000_000)
  })

  it('returns empty windows when no model remains', () => {
    expect(parseMinimaxUsage({ data: {} }, 'global', 'MiniMax').windows).toEqual([])
    expect(parseMinimaxUsage(null, 'cn', 'MiniMax').windows).toEqual([])
  })
})
