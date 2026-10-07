import type { CodexReasoningEffort } from './agent-types'
import { hasPromptKeyword, type PromptKeyword } from './prompt-keywords'

/**
 * What the next turn will do differently, as the composer border shows it:
 * Claude's prompt keywords (or its Ultracode toggle), or Codex's Ultra effort,
 * which is the same multi-agent mode chosen from the effort selector.
 */
export type ComposerMode = PromptKeyword | 'codex-ultra'

/**
 * The mode whose border the composer shows. Ultracode (the session toggle or
 * the draft keyword) outranks ultrathink, being the bigger change to the turn.
 * `codexReasoningEffort` is the effort a Codex session's selector shows; Codex
 * Ultra never comes from the draft.
 */
export function composerMode({ text, promptKeywords, ultracode, codexReasoningEffort }: {
  text: string
  promptKeywords: readonly PromptKeyword[]
  ultracode: boolean
  codexReasoningEffort?: CodexReasoningEffort | null
}): ComposerMode | null {
  if (codexReasoningEffort === 'ultra') return 'codex-ultra'
  if (promptKeywords.includes('ultracode') && (ultracode || hasPromptKeyword(text, 'ultracode'))) return 'ultracode'
  if (promptKeywords.includes('ultrathink') && hasPromptKeyword(text, 'ultrathink')) return 'ultrathink'
  return null
}

export type Rgb = readonly [number, number, number]

/**
 * Ultracode's purple is Claude Code's `autoAccept`; magenta and indigo join it
 * only in the turning ring. Desktop declares the same values as `--ultracode*`
 * in `styles/index.css`, which a test holds to these.
 */
export const ULTRACODE_COLORS: Record<'light' | 'dark', readonly [Rgb, Rgb, Rgb]> = {
  light: [[135, 0, 255], [214, 51, 240], [99, 102, 241]],
  dark: [[175, 135, 255], [236, 130, 255], [129, 140, 248]],
}

/** Claude Code's `rainbow_*`, the same in both themes (`--ultrathink-0`…`-6`). */
export const ULTRATHINK_COLORS: readonly Rgb[] = [
  [235, 95, 87], [245, 139, 87], [250, 195, 95], [145, 200, 130], [130, 170, 220], [155, 130, 200], [200, 130, 180],
]

/**
 * Codex's own Ultra effort colours, from its effort slider: indigo-blue into a
 * lavender sheen and back through deep violet. Mid-tones, so one set reads on
 * both themes.
 */
export const CODEX_ULTRA_COLORS: readonly Rgb[] = [[66, 82, 195], [143, 121, 235], [188, 153, 255], [81, 55, 170]]

/**
 * The ring's colour stops, clockwise and closed on the first so the turning
 * gradient has no seam. Ultracode and Codex Ultra go round twice, so a turn
 * shows each colour twice; the rainbow goes round once.
 */
export function composerModeRing(mode: ComposerMode, dark: boolean): Rgb[] {
  if (mode === 'ultrathink') return [...ULTRATHINK_COLORS, ULTRATHINK_COLORS[0]!]
  const colors = mode === 'ultracode' ? ULTRACODE_COLORS[dark ? 'dark' : 'light'] : CODEX_ULTRA_COLORS
  return [...colors, ...colors, colors[0]!]
}

/** The multi-agent modes sparkle, in these colours; ultrathink only reasons longer, so it has none. */
export const COMPOSER_MODE_SPARKLE_COLORS: Partial<Record<ComposerMode, Record<'light' | 'dark', Rgb>>> = {
  ultracode: { light: [214, 51, 240], dark: [246, 238, 255] },
  'codex-ultra': { light: [81, 55, 170], dark: [255, 255, 255] },
}

/** One full turn of the ring. */
export const COMPOSER_MODE_TURN_S = 1.8

/** A spot on the box's edge for `t` in [0, 1), clockwise from the top left; the long edges get most. */
function edgeSpot(t: number): [number, number] {
  if (t < 0.4) return [t / 0.4, 0]
  if (t < 0.5) return [1, (t - 0.4) / 0.1]
  if (t < 0.9) return [1 - (t - 0.5) / 0.4, 1]
  return [0, 1 - (t - 0.9) / 0.1]
}

const SPARKLE_COUNT = 20

/**
 * Sparkles spread around the border with uneven spacing, sizes (px), periods
 * and phases (s), so neighbours never twinkle in step or in sequence. `x` and
 * `y` are fractions of the box.
 */
export const COMPOSER_MODE_SPARKLES = Array.from({ length: SPARKLE_COUNT }, (_, i) => {
  const scatter = (i * 0.618) % 1
  const [x, y] = edgeSpot((i + 0.6 * scatter) / SPARKLE_COUNT)
  const period = 1.4 + ((i * 5) % 7) * 0.15
  return { x, y, size: 6 + ((i * 7) % 5), period, delay: -scatter * period }
})

/**
 * One twinkle, as keyframes over its period: still and hidden for the first
 * half, then it grows and turns to full, shrinks, and goes. Desktop's
 * `composer-mode-border-sparkle` keyframes are the same table.
 */
export const COMPOSER_MODE_SPARKLE_KEYFRAMES = {
  at: [0, 0.5, 0.68, 0.84, 1],
  scale: [0, 0, 1, 0.45, 0],
  rotateDeg: [0, 0, 45, 90, 0],
  opacity: [0, 0, 1, 0.7, 0],
} as const
