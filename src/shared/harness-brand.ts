import type { HarnessId } from './session-types'

export const HARNESS_DEFAULT_BRAND_HUE: Record<HarnessId, number> = {
  claude: 42,
  codex: 165,
}

export const BRAND_HUE_LIGHTNESS = 0.65
export const BRAND_HUE_CHROMA = 0.20

export function clampBrandHue(hue: number): number {
  if (!Number.isFinite(hue)) return 0
  const wrapped = ((hue % 360) + 360) % 360
  return Math.round(wrapped)
}

export function brandHueToOklch(hue: number): string {
  return `oklch(${BRAND_HUE_LIGHTNESS} ${BRAND_HUE_CHROMA} ${clampBrandHue(hue)})`
}
