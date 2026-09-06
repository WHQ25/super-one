/**
 * Palettes for the two Claude effort easter eggs — `max` burns, `xhigh` goes
 * rainbow. Desktop paints them with canvas particles and a CSS gradient; mobile
 * paints the same colours with SVG and Animated. Shared so the two surfaces
 * cannot drift into two different fires.
 *
 * The desktop rainbow also exists as a `linear-gradient` in
 * `apps/desktop/src/renderer/src/styles/index.css` (`.rainbow-text`); keep the
 * two lists in step.
 */

/** Ember ramp, young → spent. Dark mode starts near white and burns down to red. */
export const DARK_COLORS = [
  [255, 255, 200],
  [255, 220, 50],
  [255, 160, 20],
  [255, 80, 0],
  [200, 30, 0],
]

/** Light mode drops the white end: it disappears against a pale surface. */
export const LIGHT_COLORS = [
  [255, 220, 50],
  [255, 160, 20],
  [255, 80, 0],
  [200, 30, 0],
  [140, 20, 8],
]

/** Sample the ramp at `t` in `[0, 1]`. */
export function lerpColor(colors: number[][], t: number): [number, number, number] {
  const index = t * (colors.length - 1)
  const i = Math.min(Math.floor(index), colors.length - 2)
  const f = index - i
  return [
    colors[i]![0]! + (colors[i + 1]![0]! - colors[i]![0]!) * f,
    colors[i]![1]! + (colors[i + 1]![1]! - colors[i]![1]!) * f,
    colors[i]![2]! + (colors[i + 1]![2]! - colors[i]![2]!) * f,
  ]
}

/** First and last stop are the same colour, so the scroll loops seamlessly. */
export const RAINBOW_DARK = [
  '#ed7aab', '#e0874e', '#d4b040', '#6abf55', '#45d4c0', '#5db8ff', '#7d7df5', '#b86ad8', '#ed7aab',
]

/** Darker stops: the dark-mode rainbow washes out on a light surface. */
export const RAINBOW_LIGHT = [
  '#d6336c', '#e8590c', '#9c6f00', '#2f9e44', '#0c8599', '#1971c2', '#6741d9', '#ae3ec9', '#d6336c',
]

/** The molten fill under `max`, as radial-gradient stops (offset, colour). */
export const FIRE_FILL_STOPS: Array<[number, string]> = [
  [0, '#ffc24d'],
  [0.32, '#f08c00'],
  [0.58, '#e8590c'],
  [1, '#b23c0a'],
]

export const FIRE_GOLD = '#ffd700'
export const FIRE_EMBER = '#cf4a12'

/**
 * Centres the molten fill sweeps across, as `[x%, y%]` of the text box. Four
 * layers cross-fade between them on a 2.8s loop, which is what makes the light
 * mode fill look like it is travelling rather than merely glowing.
 */
export const FIRE_SWEEP_CENTERS: Array<[number, number]> = [
  [50, 58],
  [96, 40],
  [58, 22],
  [8, 48],
]

export const FIRE_SWEEP_S = 2.8

/**
 * The `fire-sprite-sweep` keyframe as a function: full at the start, out by a
 * quarter, dark through the middle, back in over the last quarter. Desktop
 * stages the four layers with a negative `animation-delay`; surfaces without
 * per-layer delays sample this at `phase + index / FIRE_SWEEP_CENTERS.length`.
 */
export function fireSweepOpacity(phase: number): number {
  const point = ((phase % 1) + 1) % 1
  if (point <= 0.25) return 1 - point / 0.25
  if (point >= 0.75) return (point - 0.75) / 0.25
  return 0
}
