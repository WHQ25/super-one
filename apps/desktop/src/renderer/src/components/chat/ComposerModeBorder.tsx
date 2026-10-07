import type { CodexReasoningEffort } from '@superone/shared/agent-types'
import { hasPromptKeyword, type PromptKeyword } from '@superone/shared/prompt-keywords'

/**
 * What the next turn will do differently, as the composer border shows it:
 * Claude's prompt keywords (or its Ultracode toggle), or Codex's Ultra effort,
 * which is the same multi-agent mode chosen from the effort selector.
 */
export type ComposerMode = PromptKeyword | 'codex-ultra'

const SPARKLE_COUNT = 20

/** A spot on the box's edge for `t` in [0, 1), clockwise from the top left; the long edges get most. */
function edgeSpot(t: number): [number, number] {
  if (t < 0.4) return [(t / 0.4) * 100, 0]
  if (t < 0.5) return [100, ((t - 0.4) / 0.1) * 100]
  if (t < 0.9) return [100 - ((t - 0.5) / 0.4) * 100, 100]
  return [0, 100 - ((t - 0.9) / 0.1) * 100]
}

/**
 * Sparkles spread around the border with uneven spacing, sizes (px), periods
 * and phases (s), so neighbours never twinkle in step or in sequence.
 */
const SPARKLES = Array.from({ length: SPARKLE_COUNT }, (_, i) => {
  const scatter = (i * 0.618) % 1
  const [left, top] = edgeSpot((i + 0.6 * scatter) / SPARKLE_COUNT)
  const period = 1.4 + ((i * 5) % 7) * 0.15
  return { left: `${left.toFixed(1)}%`, top: `${top.toFixed(1)}%`, size: 6 + ((i * 7) % 5), period, delay: -scatter * period }
})

/** The multi-agent modes twinkle; ultrathink only reasons longer. */
const SPARKLING_MODES: ReadonlySet<ComposerMode> = new Set(['ultracode', 'codex-ultra'])

/**
 * The mode whose border the composer shows. Ultracode (the session toggle or
 * the draft keyword) outranks ultrathink, being the bigger change to the turn.
 * `codexReasoningEffort` is the effort a Codex session's selector shows.
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

/**
 * The composer border while the next turn runs in a special mode: its colours
 * (Ultracode's purples, ultrathink's rainbow, Codex Ultra's indigo) turning, with
 * a soft halo, and for the multi-agent modes sparkles twinkling around it. Sits
 * as a direct child of the composer box, which must be its own stacking
 * context: it all stays under the draft at `z-index: -1`.
 */
export function ComposerModeBorder({ mode }: { mode: ComposerMode }) {
  return (
    <div aria-hidden className="composer-mode-border" data-mode={mode}>
      <div className="composer-mode-border__glow">
        <div className="composer-mode-border__ring">
          <div className="composer-mode-border__spin" />
        </div>
      </div>
      <div className="composer-mode-border__ring">
        <div className="composer-mode-border__spin" />
      </div>
      {SPARKLING_MODES.has(mode) && SPARKLES.map(({ left, top, size, period, delay }, i) => (
        <i
          key={i}
          className="composer-mode-border__sparkle"
          style={{ left, top, width: size, height: size, animationDuration: `${period}s`, animationDelay: `${delay.toFixed(2)}s` }}
        />
      ))}
    </div>
  )
}
