import { describe, it, expect } from 'vitest'
import {
  HARNESS_DEFAULT_BRAND_HUE,
  HARNESS_DEFAULT_TOKENS,
  BRAND_HUE_LIGHTNESS,
  brandHueToOklch,
  clampBrandHue,
  clampC,
  clampHue,
  clampL,
  countOverriddenHues,
  listOverriddenHueTokens,
  lchToCss,
  maxChromaInSRGB,
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
  it('uses the vivid fill lightness and a hue-specific chroma', () => {
    // Chroma is no longer a global constant: sRGB allows far more of it at some
    // hues than others, so the swatch a hue slider previews must be clamped per
    // hue or the browser silently clips it (which shifts hue AND lightness).
    expect(brandHueToOklch(42)).toMatch(/^oklch\(0\.68 0\.\d+ 42\)$/)
    const chromaOf = (hue: number) => Number(brandHueToOklch(hue).split(' ')[1])
    // Orange has roughly twice cyan's headroom at this lightness.
    expect(chromaOf(40)).toBeGreaterThan(chromaOf(210) * 1.5)
  })

  it('stays inside sRGB for every harness default hue', () => {
    for (const hue of Object.values(HARNESS_DEFAULT_BRAND_HUE)) {
      expect(chromaOfSwatch(hue)).toBeLessThanOrEqual(maxChromaInSRGB(BRAND_HUE_LIGHTNESS, hue))
    }
  })

  it('formats arbitrary lch', () => {
    expect(lchToCss({ l: 0.5, c: 0.1, h: 90, a: 1 })).toBe('oklch(0.5 0.1 90)')
  })

  it('includes alpha when below 1', () => {
    expect(lchToCss({ l: 0.5, c: 0.1, h: 90, a: 0.5 })).toBe('oklch(0.5 0.1 90 / 0.5)')
  })
})

function chromaOfSwatch(hue: number): number {
  return Number(brandHueToOklch(hue).split(' ')[1])
}

describe('maxChromaInSRGB', () => {
  it('leaves almost no headroom next to white', () => {
    // This is why the old palette read as flat grey: --card / --popover /
    // --sidebar all sat at L 0.99, where no hue can carry visible chroma.
    expect(maxChromaInSRGB(0.99, 40)).toBeLessThan(0.01)
    expect(maxChromaInSRGB(0.95, 40)).toBeGreaterThan(maxChromaInSRGB(0.99, 40) * 4)
  })

  it('returns a chroma that is in gamut while slightly more is not', () => {
    const inGamut = (l: number, c: number, hue: number) => {
      const rad = (hue * Math.PI) / 180
      const a = c * Math.cos(rad)
      const b = c * Math.sin(rad)
      const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
      const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
      const sp = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3
      return [
        4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
        -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
        -0.0041960863 * lp - 0.7034186147 * mp + 1.7076147010 * sp,
      ].every((v) => v >= -0.001 && v <= 1.001)
    }
    for (const hue of [40, 150, 210, 240, 265, 280]) {
      const c = maxChromaInSRGB(0.68, hue)
      expect(inGamut(0.68, c, hue)).toBe(true)
      expect(inGamut(0.68, c + 0.02, hue)).toBe(false)
    }
  })
})

describe('light-mode palette invariants', () => {
  it('recesses the sidebar well below the content surfaces', () => {
    for (const hue of Object.keys(HARNESS_DEFAULT_BRAND_HUE) as (keyof typeof HARNESS_DEFAULT_BRAND_HUE)[]) {
      const t = HARNESS_DEFAULT_TOKENS[hue]
      expect(t['--sidebar'].l).toBeLessThan(t['--background'].l)
      // Three surface levels, far enough apart to read as distinct.
      expect(t['--card'].l - t['--background'].l).toBeGreaterThan(0.01)
      expect(t['--background'].l - t['--muted'].l).toBeGreaterThan(0.05)
    }
  })

  it('keeps the sidebar hover neutral and distinct from the vivid selected fill', () => {
    for (const hue of Object.keys(HARNESS_DEFAULT_BRAND_HUE) as (keyof typeof HARNESS_DEFAULT_BRAND_HUE)[]) {
      const t = HARNESS_DEFAULT_TOKENS[hue]
      // One token served both roles while the sidebar was pale; on a vivid
      // selected fill a translucent copy of it would read as a second selection.
      expect(t['--sidebar-hover'].c).toBeLessThan(t['--sidebar-accent'].c / 4)
      expect(t['--sidebar-accent'].l - t['--sidebar-hover'].l).toBeGreaterThan(0.2)
    }
  })

  it('never asks for more chroma than sRGB can render', () => {
    for (const hue of Object.keys(HARNESS_DEFAULT_BRAND_HUE) as (keyof typeof HARNESS_DEFAULT_BRAND_HUE)[]) {
      const t = HARNESS_DEFAULT_TOKENS[hue]
      for (const [token, lch] of Object.entries(t)) {
        expect(
          lch.c,
          `${hue} ${token} asks for ${lch.c} at L ${lch.l}`,
        ).toBeLessThanOrEqual(maxChromaInSRGB(lch.l, lch.h) + 1e-9)
      }
    }
  })
})
