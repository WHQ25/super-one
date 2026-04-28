import { describe, it, expect } from 'vitest'
import {
  HARNESS_DEFAULT_BRAND_HUE,
  HARNESS_DEFAULT_TOKENS,
  brandHueToOklch,
  clampBrandHue,
  clampC,
  clampHue,
  clampL,
  countOverriddenHues,
  listOverriddenHueTokens,
  lchToCss,
  resolveTokenLCH,
  sanitizeOverrides,
} from './harness-brand'

describe('clampBrandHue', () => {
  it('wraps negative hues to 0-360', () => {
    expect(clampBrandHue(-30)).toBe(330)
  })
  it('wraps hues over 360', () => {
    expect(clampBrandHue(420)).toBe(60)
  })
  it('rounds to integer', () => {
    expect(clampBrandHue(42.4)).toBe(42)
    expect(clampBrandHue(42.6)).toBe(43)
  })
  it('returns 0 for non-finite input', () => {
    expect(clampBrandHue(Number.NaN)).toBe(0)
    expect(clampBrandHue(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('clampL / clampC / clampHue', () => {
  it('clampL clamps to [0,1]', () => {
    expect(clampL(-0.1)).toBe(0)
    expect(clampL(0.5)).toBe(0.5)
    expect(clampL(1.5)).toBe(1)
  })
  it('clampC clamps to [0, 0.4]', () => {
    expect(clampC(-0.1)).toBe(0)
    expect(clampC(0.2)).toBe(0.2)
    expect(clampC(1)).toBe(0.4)
  })
  it('clampHue wraps and rounds to integer', () => {
    expect(clampHue(-30)).toBe(330)
    expect(clampHue(42.4)).toBe(42)
    expect(clampHue(42.6)).toBe(43)
    expect(clampHue(370)).toBe(10)
  })
})

describe('resolveTokenLCH (three-stage fallback)', () => {
  it('returns harness default when no override and no brandHue', () => {
    const lch = resolveTokenLCH('claude', '--background', undefined, null)
    expect(lch).toEqual(HARNESS_DEFAULT_TOKENS.claude['--background'])
  })

  it('uses brandHue when override has no h, falls back to default L/C', () => {
    const lch = resolveTokenLCH('claude', '--background', undefined, 200)
    expect(lch.h).toBe(200)
    expect(lch.l).toBe(HARNESS_DEFAULT_TOKENS.claude['--background'].l)
    expect(lch.c).toBe(HARNESS_DEFAULT_TOKENS.claude['--background'].c)
  })

  it('override.h beats brandHue', () => {
    const lch = resolveTokenLCH('claude', '--primary', { h: 90 }, 200)
    expect(lch.h).toBe(90)
  })

  it('override partial only changes specified channels', () => {
    const lch = resolveTokenLCH('claude', '--primary', { l: 0.5 }, 200)
    expect(lch.l).toBe(0.5)
    expect(lch.c).toBe(HARNESS_DEFAULT_TOKENS.claude['--primary'].c)
    expect(lch.h).toBe(200)
  })

  it('different harness uses different default hue', () => {
    const claude = resolveTokenLCH('claude', '--background', undefined, null)
    const codex = resolveTokenLCH('codex', '--background', undefined, null)
    expect(claude.h).toBe(HARNESS_DEFAULT_BRAND_HUE.claude)
    expect(codex.h).toBe(HARNESS_DEFAULT_BRAND_HUE.codex)
  })

  it('clamps out-of-range overrides', () => {
    const lch = resolveTokenLCH('claude', '--primary', { l: 2, c: -1, h: 720 }, null)
    expect(lch.l).toBe(1)
    expect(lch.c).toBe(0)
    expect(lch.h).toBe(0)
  })
})

describe('sanitizeOverrides', () => {
  it('returns empty object for non-objects', () => {
    expect(sanitizeOverrides(null)).toEqual({})
    expect(sanitizeOverrides(undefined)).toEqual({})
    expect(sanitizeOverrides('foo')).toEqual({})
    expect(sanitizeOverrides(42)).toEqual({})
  })

  it('keeps only known design tokens', () => {
    const result = sanitizeOverrides({
      '--background': { l: 0.5 },
      '--bogus': { l: 0.5 },
    })
    expect(result['--background']).toEqual({ l: 0.5 })
    expect((result as Record<string, unknown>)['--bogus']).toBeUndefined()
  })

  it('drops non-finite numbers', () => {
    const result = sanitizeOverrides({
      '--primary': { l: Number.NaN, c: 0.2, h: Number.POSITIVE_INFINITY },
    })
    expect(result['--primary']).toEqual({ c: 0.2 })
  })

  it('drops empty entries (no l/c/h)', () => {
    const result = sanitizeOverrides({ '--primary': {} })
    expect(result['--primary']).toBeUndefined()
  })

  it('clamps values to valid ranges', () => {
    const result = sanitizeOverrides({
      '--primary': { l: 2, c: -1, h: 400 },
    })
    expect(result['--primary']).toEqual({ l: 1, c: 0, h: 40 })
  })
})

describe('countOverriddenHues / listOverriddenHueTokens', () => {
  it('counts only tokens with h override', () => {
    const overrides = {
      '--primary': { l: 0.5 },
      '--background': { h: 200 },
      '--card': { c: 0.05, h: 100 },
    }
    expect(countOverriddenHues(overrides)).toBe(2)
  })

  it('handles empty/undefined', () => {
    expect(countOverriddenHues({})).toBe(0)
    expect(countOverriddenHues(undefined)).toBe(0)
    expect(listOverriddenHueTokens(undefined)).toEqual([])
  })

  it('lists tokens in DESIGN_TOKENS order', () => {
    const overrides = {
      '--primary': { h: 100 },
      '--background': { h: 200 },
    }
    const list = listOverriddenHueTokens(overrides)
    expect(list).toContain('--background')
    expect(list).toContain('--primary')
    expect(list.indexOf('--background')).toBeLessThan(list.indexOf('--primary'))
  })
})

describe('brandHueToOklch / lchToCss', () => {
  it('formats brand hue with fixed L/C', () => {
    expect(brandHueToOklch(42)).toBe('oklch(0.65 0.2 42)')
  })

  it('formats arbitrary lch', () => {
    expect(lchToCss({ l: 0.5, c: 0.1, h: 90, a: 1 })).toBe('oklch(0.5 0.1 90)')
  })

  it('includes alpha when below 1', () => {
    expect(lchToCss({ l: 0.5, c: 0.1, h: 90, a: 0.5 })).toBe('oklch(0.5 0.1 90 / 0.5)')
  })
})
