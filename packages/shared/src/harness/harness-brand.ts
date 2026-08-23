import type { HarnessId } from '../session-types'

export const HARNESS_DEFAULT_BRAND_HUE: Record<HarnessId, number> = {
  claude: 40,
  codex: 240,
  acp: 280,
  opencode: 150,
  /** Cool slate / Cursor-adjacent blue-gray. */
  cursor: 210,
  /** DeepSeek brand blue-violet (#4D6BFE-adjacent). */
  dsh: 265,
}

/** Lightness of the vivid swatch tone shown in the brand-hue picker. */
export const BRAND_HUE_LIGHTNESS = 0.68
/**
 * Requested chroma for a vivid brand tone. Nominal only: `vivid()` caps it at
 * `maxChromaInSRGB(l, hue) * 0.95`, so only wide hues ever spend it in full.
 */
export const BRAND_HUE_CHROMA = 0.24

export type LCH = { l: number; c: number; h: number; a: number }
export type LCHPartial = Partial<LCH>
export type LCHChannel = 'l' | 'c' | 'h' | 'a'
export const LCH_CHANNELS: readonly LCHChannel[] = ['l', 'c', 'h', 'a'] as const

export const DESIGN_TOKENS = [
  '--background',
  '--card',
  '--popover',
  '--secondary',
  '--muted',
  '--accent',
  '--border',
  '--input',
  '--sidebar',
  '--sidebar-hover',
  '--sidebar-accent',
  '--sidebar-border',
  '--foreground',
  '--card-foreground',
  '--popover-foreground',
  '--secondary-foreground',
  '--muted-foreground',
  '--accent-foreground',
  '--sidebar-foreground',
  '--sidebar-accent-foreground',
  '--primary',
  '--ring',
  '--sidebar-primary',
  '--sidebar-ring',
] as const

export type DesignToken = typeof DESIGN_TOKENS[number]

export type TokenGroup = 'surface' | 'foreground' | 'accent'

export const TOKEN_GROUP: Record<DesignToken, TokenGroup> = {
  '--background': 'surface',
  '--card': 'surface',
  '--popover': 'surface',
  '--secondary': 'surface',
  '--muted': 'surface',
  '--accent': 'surface',
  '--border': 'surface',
  '--input': 'surface',
  '--sidebar': 'surface',
  '--sidebar-hover': 'surface',
  '--sidebar-accent': 'surface',
  '--sidebar-border': 'surface',
  '--foreground': 'foreground',
  '--card-foreground': 'foreground',
  '--popover-foreground': 'foreground',
  '--secondary-foreground': 'foreground',
  '--muted-foreground': 'foreground',
  '--accent-foreground': 'foreground',
  '--sidebar-foreground': 'foreground',
  '--sidebar-accent-foreground': 'foreground',
  '--primary': 'accent',
  '--ring': 'accent',
  '--sidebar-primary': 'accent',
  '--sidebar-ring': 'accent',
}

export type TokenOverrides = Partial<Record<DesignToken, LCHPartial>>

/**
 * Largest chroma that stays inside sRGB for a given OKLCh lightness + hue.
 *
 * sRGB's gamut narrows sharply toward white: at L 0.99 no hue can carry more
 * than ~0.005 chroma, and the ceiling is hue-dependent even at mid lightness
 * (cyan tops out near 0.11 where orange reaches 0.20). Asking for more than
 * this makes the browser clip silently, which shifts hue AND lightness — so
 * every chroma below is expressed as a fraction of this ceiling rather than as
 * one global constant.
 */
export function maxChromaInSRGB(l: number, hue: number): number {
  const inGamut = (c: number): boolean => {
    const [r, g, b] = oklchToLinearSRGB(l, c, hue)
    return r >= -0.0005 && r <= 1.0005 && g >= -0.0005 && g <= 1.0005 && b >= -0.0005 && b <= 1.0005
  }
  let lo = 0
  let hi = 0.4
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** OKLCh → LINEAR sRGB. Components may fall outside [0,1] when out of gamut. */
export function oklchToLinearSRGB(l: number, c: number, hue: number): [number, number, number] {
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
  ]
}

/**
 * WCAG 2.1 contrast ratio between two OKLCh colours (1–21, higher is better).
 *
 * Linear sRGB IS the space WCAG's relative-luminance coefficients expect, so the
 * clipped linear triple feeds them directly — no sRGB-encode/decode round trip.
 * Out-of-gamut chroma is clipped exactly as the compositor would clip it.
 */
export function contrastRatio(a: LCH, b: LCH): number {
  const lum = ({ l, c, h }: LCH): number => {
    const [r, g, bl] = oklchToLinearSRGB(l, c, h).map((v) => Math.max(0, Math.min(1, v)))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const x = lum(a)
  const y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * The ink that reads best on a vivid brand fill.
 *
 * The light palette used to hard-code DARK text on every brand fill, which only
 * held while the fill sat at L 0.68. Once `--primary` dropped to L 0.55 the same
 * ink fell to ~3.5:1 — below AA — so the choice has to follow the fill. Picking
 * by measured contrast (rather than an L threshold) keeps it correct for any
 * user brand hue and any palette override, including fills we never shipped.
 */
export function inkForFill(fill: LCH): LCH {
  const dark: LCH = { l: 0.20, c: 0.006, h: fill.h, a: 1 }
  const light: LCH = { l: 0.99, c: 0, h: fill.h, a: 1 }
  return contrastRatio(fill, dark) >= contrastRatio(fill, light) ? dark : light
}

/**
 * Light-mode palette — "inverted chrome".
 *
 * Three decisive neutral surfaces (sunken sidebar / canvas / raised card) with
 * 0.03-0.04 lightness steps, plus exactly one hue in three tones: a deep fill at
 * L 0.55 for actions on light surfaces (carries LIGHT ink — see `inkForFill`), a
 * bright fill at L 0.68 for the sidebar's selected state (dark ground, so it
 * needs to run bright and carries DARK ink), and an ink tone at L 0.52 for rings.
 * Chroma is never a constant: each tone asks `maxChromaInSRGB` for the ceiling at
 * its own lightness AND hue, so orange reaches ~0.17 where cyan tops out at ~0.09
 * instead of every hue being flattened to one clipped value.
 * Everything else is near-achromatic on purpose — a tinted
 * ground would rob the one saturated colour of the contrast it needs to read as
 * vivid.
 */
function buildHarnessDefaults(harness: HarnessId): Record<DesignToken, LCH> {
  const h = HARNESS_DEFAULT_BRAND_HUE[harness]
  const a = 1
  /**
   * As saturated as asked for, or as saturated as sRGB allows here — whichever
   * is smaller, with headroom against clipping.
   *
   * The cap is not optional. Chromium gamut-maps an out-of-range oklch chroma at
   * paint time, so an uncapped value would render as something we never computed:
   * the palette editor would show a chroma the app cannot display, and worse,
   * `inkForFill` would pick its ink by measuring a colour that never reaches the
   * screen. Storing the reachable value keeps every downstream consumer honest.
   */
  const vivid = (l: number, c = BRAND_HUE_CHROMA): LCH => ({
    l,
    c: Math.min(c, maxChromaInSRGB(l, h) * 0.95),
    h,
    a,
  })
  /** A whisper of the brand hue — enough to warm the neutral, never enough to tint it. */
  const tinted = (l: number, c: number): LCH => ({ l, c: Math.min(c, maxChromaInSRGB(l, h) * 0.9), h, a })

  return {
    // Light content surfaces — three levels, wide apart.
    '--background': tinted(0.975, 0.002),
    '--card': tinted(0.995, 0.0015),
    '--popover': tinted(0.995, 0.0015),
    '--secondary': tinted(0.905, 0.004),
    '--muted': tinted(0.905, 0.004),
    '--accent': tinted(0.905, 0.004),
    '--border': tinted(0.888, 0.003),
    '--input': tinted(0.888, 0.003),

    // Sidebar runs dark so the content area can stay clean without dividers.
    '--sidebar': tinted(0.26, 0.020),
    '--sidebar-hover': tinted(0.34, 0.022),
    '--sidebar-accent': vivid(0.68),
    '--sidebar-border': tinted(0.34, 0.018),

    // Foregrounds.
    '--foreground': tinted(0.20, 0.006),
    '--card-foreground': tinted(0.20, 0.006),
    '--popover-foreground': tinted(0.20, 0.006),
    '--secondary-foreground': tinted(0.20, 0.006),
    '--muted-foreground': tinted(0.50, 0.010),
    '--accent-foreground': tinted(0.20, 0.006),
    '--sidebar-foreground': tinted(0.93, 0.006),
    '--sidebar-accent-foreground': tinted(0.20, 0.006),

    // The one hue, three tones. --primary runs DEEP (carries light ink); the
    // sidebar tones stay bright because they sit on the dark sidebar ground,
    // where a deep fill would sink into the background instead of popping.
    //
    // Green (~h143) is the weakest hue for light ink and lands at 4.40:1 here —
    // just under WCAG AA for body text, comfortably over the 3:1 AA-large bar
    // these semibold button labels actually sit under. Only wide hues (violet,
    // indigo) can spend the full 0.24; the rest are capped by the sRGB ceiling.
    '--primary': vivid(0.55),
    '--sidebar-primary': vivid(0.68),
    '--ring': vivid(0.52),
    '--sidebar-ring': vivid(0.52),
  }
}

export const HARNESS_DEFAULT_TOKENS: Record<HarnessId, Record<DesignToken, LCH>> = {
  claude: buildHarnessDefaults('claude'),
  codex: buildHarnessDefaults('codex'),
  acp: buildHarnessDefaults('acp'),
  opencode: buildHarnessDefaults('opencode'),
  cursor: buildHarnessDefaults('cursor'),
  dsh: buildHarnessDefaults('dsh'),
}

export function clampBrandHue(hue: number): number {
  if (!Number.isFinite(hue)) return 0
  const wrapped = ((hue % 360) + 360) % 360
  return Math.round(wrapped)
}

export function clampHue(hue: number): number {
  if (!Number.isFinite(hue)) return 0
  const wrapped = ((hue % 360) + 360) % 360
  return Math.round(wrapped)
}

export function clampL(l: number): number {
  if (!Number.isFinite(l)) return 0
  return Math.max(0, Math.min(1, l))
}

export function clampC(c: number): number {
  if (!Number.isFinite(c)) return 0
  return Math.max(0, Math.min(0.4, c))
}

export function clampA(a: number): number {
  if (!Number.isFinite(a)) return 1
  return Math.max(0, Math.min(1, a))
}

export function brandHueToOklch(hue: number): string {
  const h = clampBrandHue(hue)
  return `oklch(${BRAND_HUE_LIGHTNESS} ${(maxChromaInSRGB(BRAND_HUE_LIGHTNESS, h) * 0.95).toFixed(4)} ${h})`
}

export function resolveTokenLCH(
  harness: HarnessId,
  token: DesignToken,
  override: LCHPartial | undefined,
  brandHue: number | null,
): LCH {
  const def = HARNESS_DEFAULT_TOKENS[harness][token]
  const fallbackHue = brandHue ?? def.h
  return {
    l: clampL(override?.l ?? def.l),
    c: clampC(override?.c ?? def.c),
    h: clampHue(override?.h ?? fallbackHue),
    a: clampA(override?.a ?? def.a),
  }
}

export function lchToCss(lch: LCH): string {
  return lch.a < 1
    ? `oklch(${lch.l} ${lch.c} ${lch.h} / ${lch.a})`
    : `oklch(${lch.l} ${lch.c} ${lch.h})`
}

export function sanitizeOverrides(raw: unknown): TokenOverrides {
  if (!raw || typeof raw !== 'object') return {}
  const result: TokenOverrides = {}
  for (const token of DESIGN_TOKENS) {
    const entry = (raw as Record<string, unknown>)[token]
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const partial: LCHPartial = {}
    if (typeof e.l === 'number' && Number.isFinite(e.l)) partial.l = clampL(e.l)
    if (typeof e.c === 'number' && Number.isFinite(e.c)) partial.c = clampC(e.c)
    if (typeof e.h === 'number' && Number.isFinite(e.h)) partial.h = clampHue(e.h)
    if (typeof e.a === 'number' && Number.isFinite(e.a)) partial.a = clampA(e.a)
    if (partial.l !== undefined || partial.c !== undefined || partial.h !== undefined || partial.a !== undefined) {
      result[token] = partial
    }
  }
  return result
}

export function countOverriddenHues(overrides: TokenOverrides | undefined): number {
  if (!overrides) return 0
  let n = 0
  for (const key of Object.keys(overrides) as DesignToken[]) {
    if (overrides[key]?.h !== undefined) n++
  }
  return n
}

export function listOverriddenHueTokens(overrides: TokenOverrides | undefined): DesignToken[] {
  if (!overrides) return []
  const result: DesignToken[] = []
  for (const token of DESIGN_TOKENS) {
    if (overrides[token]?.h !== undefined) result.push(token)
  }
  return result
}
