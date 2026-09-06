import { oklchToLinearSRGB, type LCH } from '../../../packages/shared/src/harness/harness-brand'

function srgbChannel(value: number): number {
  const clipped = Math.max(0, Math.min(1, value))
  return clipped <= 0.0031308
    ? 12.92 * clipped
    : 1.055 * clipped ** (1 / 2.4) - 0.055
}

export function hex(lch: LCH): string {
  const channels = oklchToLinearSRGB(lch.l, lch.c, lch.h)
    .map(srgbChannel)
    .map((value) => Math.round(value * 255).toString(16).padStart(2, '0'))
  const alpha = lch.a < 1 ? Math.round(lch.a * 255).toString(16).padStart(2, '0') : ''
  return `#${channels.join('')}${alpha}`
}

export function parseOklch(scope: string, token: string): LCH {
  scope = scope.replace(/oklch\(([\d.]+)%/g, (_, value: string) => `oklch(${Number(value) / 100}`)
  const match = scope.match(new RegExp(`--${token}:\\s*oklch\\(([-.\\d]+)\\s+([-.\\d]+)\\s+([-.\\d]+)(?:\\s*\\/\\s*([-.\\d]+)%?)?\\)`))
  if (!match) throw new Error(`missing literal --${token} in desktop theme`)
  const rawAlpha = match[4] == null ? 1 : Number(match[4])
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]), a: rawAlpha > 1 ? rawAlpha / 100 : rawAlpha }
}
