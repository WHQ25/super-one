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

/** Lightness of the vivid fill tone. Pairs with DARK text, not white. */
export const BRAND_HUE_LIGHTNESS = 0.68
/** Nominal only — real chroma is `maxChromaInSRGB(l, hue) * 0.95`, which is hue-dependent. */
export const BRAND_HUE_CHROMA = 0.20

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
  const rad = (hue * Math.PI) / 180
  const ca = Math.cos(rad)
  const cb = Math.sin(rad)
  const inGamut = (c: number): boolean => {
    const a = c * ca
    const b = c * cb
    const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const sp = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3
    const r = 4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp
    const g = -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp
    const bl = -0.0041960863 * lp - 0.7034186147 * mp + 1.7076147010 * sp
    return r >= -0.0005 && r <= 1.0005 && g >= -0.0005 && g <= 1.0005 && bl >= -0.0005 && bl <= 1.0005
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

/**
 * Light-mode palette — "inverted chrome".
 *
 * Three decisive neutral surfaces (sunken sidebar / canvas / raised card) with
 * 0.03-0.04 lightness steps, plus exactly one hue in two tones: a vivid fill at
 * L 0.68 that carries DARK text, and an ink tone at L 0.52 for icons and rules
 * on light surfaces. Everything else is near-achromatic on purpose — a tinted
 * ground would rob the one saturated colour of the contrast it needs to read as
 * vivid.
 */
function buildHarnessDefaults(harness: HarnessId): Record<DesignToken, LCH> {
  const h = HARNESS_DEFAULT_BRAND_HUE[harness]
  const a = 1
  /** As saturated as sRGB allows at this lightness, with headroom against clipping. */
  const vivid = (l: number): LCH => ({ l, c: maxChromaInSRGB(l, h) * 0.95, h, a })
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

    // The one hue, two tones.
    '--primary': vivid(0.68),
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
