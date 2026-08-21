/**
 * Windows draws the caption buttons into a native overlay that can only be given
 * one flat colour, so it has to be told what the title strip underneath actually
 * paints. That strip is `bg-sidebar` (main window) / `bg-card` (mini window), and
 * both resolve through `--brand-hue` plus any user palette override — no constant
 * in the main process can track them, which is why the colour is read here from
 * the live computed style instead of being duplicated as a hex.
 */
export interface WindowChromeColors {
  backgroundColor: string
  symbolColor: string
}

let probe: CanvasRenderingContext2D | null | undefined

/**
 * Normalise any CSS colour to an sRGB hex string. Computed styles keep their
 * authored colour space (`--sidebar` serialises back as `oklch(...)`), and
 * Electron's overlay only takes hex/rgb — a 1x1 canvas does the conversion
 * without a second oklch→sRGB implementation in the app.
 */
export function cssColorToHex(color: string): string | null {
  if (probe === undefined) {
    probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  }
  if (!probe) return null
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = color
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
  const hex = (n: number): string => n.toString(16).padStart(2, '0')
  const rgb = `#${hex(r)}${hex(g)}${hex(b)}`
  return a === 255 ? rgb : `${rgb}${hex(a)}`
}

/** Resolved background/foreground of the strip the caption buttons sit on. */
export function readWindowChromeColors(el: HTMLElement): WindowChromeColors | null {
  const style = getComputedStyle(el)
  const backgroundColor = cssColorToHex(style.backgroundColor)
  const symbolColor = cssColorToHex(style.color)
  if (!backgroundColor || !symbolColor) return null
  return { backgroundColor, symbolColor }
}
