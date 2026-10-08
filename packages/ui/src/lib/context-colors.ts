function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  if (s === 0) {
    const v = Math.round(l * 255)
    return `#${v.toString(16).padStart(2, '0').repeat(3)}`
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r = Math.round(hue2rgb(p, q, h / 360 + 1 / 3) * 255)
  const g = Math.round(hue2rgb(p, q, h / 360) * 255)
  const b = Math.round(hue2rgb(p, q, h / 360 - 1 / 3) * 255)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** A mini-app context chip's fill, ink, label and border, derived from the app's colour. */
export function deriveColors(baseColor?: string, isDark = false) {
  const fallback = '#c4873a'
  const hex = baseColor && /^#[0-9a-fA-F]{6}$/.test(baseColor) ? baseColor : fallback
  const [h, s] = hexToHsl(hex)
  if (isDark) {
    return {
      bg: hslToHex(h, Math.min(s, 0.30), 0.22),
      color: hslToHex(h, Math.min(s, 0.55), 0.80),
      labelColor: hslToHex(h, Math.min(s, 0.40), 0.62),
      border: hslToHex(h, Math.min(s, 0.30), 0.32),
    }
  }
  return {
    bg: hslToHex(h, Math.min(s, 0.35), 0.93),
    color: hslToHex(h, Math.min(s, 0.5), 0.35),
    labelColor: hslToHex(h, Math.min(s, 0.4), 0.55),
    border: hslToHex(h, Math.min(s, 0.3), 0.82),
  }
}
