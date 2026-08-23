import { describe, it, expect } from 'vitest'
import {
  HARNESS_DEFAULT_BRAND_HUE,
  HARNESS_DEFAULT_TOKENS,
  BRAND_HUE_CHROMA,
  BRAND_HUE_LIGHTNESS,
  brandHueToOklch,
  clampBrandHue,
  clampC,
  clampHue,
  clampL,
  contrastRatio,
  countOverriddenHues,
  inkForFill,
  listOverriddenHueTokens,
  lchToCss,
  maxChromaInSRGB,
  oklchToLinearSRGB,
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

describe('contrastRatio', () => {
  it('returns 21 for pure black against pure white', () => {
    const black = { l: 0, c: 0, h: 0, a: 1 }
    const white = { l: 1, c: 0, h: 0, a: 1 }
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1)
  })

  it('is symmetric', () => {
    const a = { l: 0.55, c: 0.16, h: 40, a: 1 }
    const b = { l: 0.99, c: 0, h: 40, a: 1 }
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10)
  })

  it('returns 1 for a colour against itself', () => {
    const a = { l: 0.55, c: 0.16, h: 40, a: 1 }
    expect(contrastRatio(a, a)).toBeCloseTo(1, 10)
  })

  it('clips out-of-gamut chroma instead of extrapolating past white', () => {
    // 0.4 chroma at L 0.9 is far outside sRGB; without clipping the linear
    // triple overshoots 1 and the ratio would read as better than it renders.
    const wild = { l: 0.9, c: 0.4, h: 140, a: 1 }
    const white = { l: 1, c: 0, h: 0, a: 1 }
    expect(contrastRatio(wild, white)).toBeGreaterThanOrEqual(1)
    expect(contrastRatio(wild, white)).toBeLessThan(1.6)
  })
})

describe('oklchToLinearSRGB', () => {
  it('maps L 1 achromatic to linear white', () => {
    const [r, g, b] = oklchToLinearSRGB(1, 0, 0)
    expect(r).toBeCloseTo(1, 3)
    expect(g).toBeCloseTo(1, 3)
    expect(b).toBeCloseTo(1, 3)
  })

  it('reports out-of-gamut components outside [0,1]', () => {
    // Chroma 0.4 at hue 200 leaves sRGB through the RED floor, not the top —
    // hence min, not max. Clipping either end is what contrastRatio relies on.
    expect(Math.min(...oklchToLinearSRGB(0.68, 0.4, 200))).toBeLessThan(0)
  })
})

describe('inkForFill', () => {
  it('picks LIGHT ink for the deep --primary fill', () => {
    for (const harness of Object.keys(HARNESS_DEFAULT_TOKENS) as (keyof typeof HARNESS_DEFAULT_TOKENS)[]) {
      expect(inkForFill(HARNESS_DEFAULT_TOKENS[harness]['--primary']).l).toBeGreaterThan(0.9)
    }
  })

  it('picks DARK ink for the bright --sidebar-primary fill', () => {
    for (const harness of Object.keys(HARNESS_DEFAULT_TOKENS) as (keyof typeof HARNESS_DEFAULT_TOKENS)[]) {
      expect(inkForFill(HARNESS_DEFAULT_TOKENS[harness]['--sidebar-primary']).l).toBeLessThan(0.3)
    }
  })

  it('keeps every shipped brand fill readable', () => {
    // 4.4, not 4.5: these fills carry semibold button labels, which WCAG scores
    // under the 3:1 large-text bar. The tighter 4.4 floor is a regression guard —
    // green (~h143) is the weakest hue for light ink and sits at 4.40 with
    // --primary at L 0.55, so anything below that is a real palette regression.
    for (const harness of Object.keys(HARNESS_DEFAULT_TOKENS) as (keyof typeof HARNESS_DEFAULT_TOKENS)[]) {
      for (const token of ['--primary', '--sidebar-primary', '--sidebar-accent'] as const) {
        const fill = HARNESS_DEFAULT_TOKENS[harness][token]
        expect(contrastRatio(fill, inkForFill(fill)), `${harness} ${token}`).toBeGreaterThanOrEqual(4.4)
      }
    }
  })

  it('flips ink as a fill sweeps from deep to bright, and never picks the worse of the two', () => {
    for (let l = 0.2; l <= 0.95; l += 0.05) {
      const fill = { l, c: maxChromaInSRGB(l, 40) * 0.95, h: 40, a: 1 }
      const chosen = inkForFill(fill)
      const other = chosen.l > 0.9 ? { l: 0.2, c: 0.006, h: 40, a: 1 } : { l: 0.99, c: 0, h: 40, a: 1 }
      expect(contrastRatio(fill, chosen)).toBeGreaterThanOrEqual(contrastRatio(fill, other))
    }
  })

  it('carries the fill hue into dark ink so it never reads as a foreign grey', () => {
    expect(inkForFill({ l: 0.9, c: 0.05, h: 137, a: 1 }).h).toBe(137)
  })
})

describe('light brand fills use the per-hue sRGB ceiling', () => {
  it('gives wide hues more chroma than narrow ones instead of one flat constant', () => {
    const orange = HARNESS_DEFAULT_TOKENS.claude['--primary'].c
    const teal = HARNESS_DEFAULT_TOKENS.cursor['--primary'].c
    expect(orange).toBeGreaterThan(teal * 1.5)
  })

  it('stays inside sRGB for every token of every harness', () => {
    for (const harness of Object.keys(HARNESS_DEFAULT_TOKENS) as (keyof typeof HARNESS_DEFAULT_TOKENS)[]) {
      for (const [token, lch] of Object.entries(HARNESS_DEFAULT_TOKENS[harness])) {
        expect(lch.c, `${harness} ${token}`).toBeLessThanOrEqual(maxChromaInSRGB(lch.l, lch.h) + 1e-9)
      }
    }
  })
})

describe('vivid() caps the requested chroma at the sRGB ceiling', () => {
  it('lets wide hues spend the full BRAND_HUE_CHROMA', () => {
    // Violet at L 0.55 has room for 0.24; it should not be trimmed below it.
    expect(HARNESS_DEFAULT_TOKENS.acp['--primary'].c).toBeCloseTo(BRAND_HUE_CHROMA, 4)
  })

  it('trims narrow hues instead of handing Chromium an unpaintable colour', () => {
    const teal = HARNESS_DEFAULT_TOKENS.cursor['--primary']
    expect(teal.c).toBeLessThan(BRAND_HUE_CHROMA)
    expect(teal.c).toBeCloseTo(maxChromaInSRGB(teal.l, teal.h) * 0.95, 4)
  })
})
