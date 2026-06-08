import type { HarnessId } from '../session-types'

export const HARNESS_DEFAULT_BRAND_HUE: Record<HarnessId, number> = {
  claude: 240,
  codex: 240,
}

export const BRAND_HUE_LIGHTNESS = 0.65
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

function buildHarnessDefaults(harness: HarnessId): Record<DesignToken, LCH> {
  const h = HARNESS_DEFAULT_BRAND_HUE[harness]
  const a = 1
  return {
    '--background': { l: 0.97, c: 0, h, a },
    '--card': { l: 0.99, c: 0, h, a },
    '--popover': { l: 0.99, c: 0, h, a },
    '--secondary': { l: 0.93, c: 0, h, a },
    '--muted': { l: 0.93, c: 0, h, a },
    '--accent': { l: 0.91, c: 0.045, h, a },
    '--border': { l: 0.88, c: 0, h, a },
    '--input': { l: 0.88, c: 0, h, a },
    '--sidebar': { l: 0.99, c: 0, h, a },
    '--sidebar-accent': { l: 0.94, c: 0.045, h, a },
    '--sidebar-border': { l: 0.92, c: 0, h, a },
    '--foreground': { l: 0.18, c: 0.012, h, a },
    '--card-foreground': { l: 0.18, c: 0.012, h, a },
    '--popover-foreground': { l: 0.18, c: 0.012, h, a },
    '--secondary-foreground': { l: 0.22, c: 0.012, h, a },
    '--muted-foreground': { l: 0.52, c: 0.025, h, a },
    '--accent-foreground': { l: 0.22, c: 0.015, h, a },
    '--sidebar-foreground': { l: 0.18, c: 0.012, h, a },
    '--sidebar-accent-foreground': { l: 0.22, c: 0.015, h, a },
    '--primary': { l: BRAND_HUE_LIGHTNESS, c: BRAND_HUE_CHROMA, h, a },
    '--ring': { l: BRAND_HUE_LIGHTNESS, c: BRAND_HUE_CHROMA, h, a },
    '--sidebar-primary': { l: BRAND_HUE_LIGHTNESS, c: BRAND_HUE_CHROMA, h, a },
    '--sidebar-ring': { l: BRAND_HUE_LIGHTNESS, c: BRAND_HUE_CHROMA, h, a },
  }
}

export const HARNESS_DEFAULT_TOKENS: Record<HarnessId, Record<DesignToken, LCH>> = {
  claude: buildHarnessDefaults('claude'),
  codex: buildHarnessDefaults('codex'),
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
  return `oklch(${BRAND_HUE_LIGHTNESS} ${BRAND_HUE_CHROMA} ${clampBrandHue(hue)})`
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
