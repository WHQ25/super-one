/**
 * Physical-pixel ceiling for a screenshot handed to the agent. The cap exists to
 * keep very large captures out of the agent's context — not to shrink ordinary
 * ones. 1600 is picked so a 2x capture of a normal viewport (up to 800 CSS px
 * wide) passes through at full density instead of being resampled.
 */
export const MAX_SCREENSHOT_WIDTH = 1600

/**
 * Target width for a capture, or null to leave it untouched.
 *
 * Reduces ONLY by whole factors. A screenshot exists to be read, and a fractional
 * resample destroys exactly what it was taken for: at 1496 -> 1280 (x0.856) every
 * glyph edge lands between pixels and the antialiasing smears into a grey haze.
 * A whole factor keeps edges on the pixel grid, so 2x -> 1x stays crisp — and is
 * the smaller file besides.
 *
 * On a 2x display this means viewports up to 800 CSS px keep full 2x detail and
 * wider ones land on exactly 1x. Not monotonic at the boundaries (3200 -> 1600 but
 * 3201 -> 1067); that is the price of never resampling on a fractional grid.
 */
export function fitScreenshotWidth(width: number, max = MAX_SCREENSHOT_WIDTH): number | null {
  if (!Number.isFinite(width) || width <= 0) return null
  if (width <= max) return null
  return Math.round(width / Math.ceil(width / max))
}
