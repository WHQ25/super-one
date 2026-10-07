import { COMPOSER_MODE_SPARKLE_COLORS, COMPOSER_MODE_SPARKLES, type ComposerMode } from '@superone/shared/composer-mode'

const SPARKLES = COMPOSER_MODE_SPARKLES.map(({ x, y, size, period, delay }) => ({
  left: `${(x * 100).toFixed(1)}%`, top: `${(y * 100).toFixed(1)}%`, size, period, delay,
}))

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
      {COMPOSER_MODE_SPARKLE_COLORS[mode] && SPARKLES.map(({ left, top, size, period, delay }, i) => (
        <i
          key={i}
          className="composer-mode-border__sparkle"
          style={{ left, top, width: size, height: size, animationDuration: `${period}s`, animationDelay: `${delay.toFixed(2)}s` }}
        />
      ))}
    </div>
  )
}
