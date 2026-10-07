import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CODEX_ULTRA_COLORS, COMPOSER_MODE_SPARKLE_COLORS, ULTRACODE_COLORS, ULTRATHINK_COLORS, type Rgb } from '@superone/shared/composer-mode'

const css = readFileSync(new URL('../../styles/index.css', import.meta.url), 'utf8')
const rgb = (value: Rgb) => value.join(' ')
/** `--name: r g b` as declared in the stylesheet's top-level `selector { … }` rules. */
function declared(selector: string, name: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const bodies = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))].map((rule) => rule[1]).join(';')
  return bodies.match(new RegExp(`--${name}:\\s*(\\d+ \\d+ \\d+)\\s*;`))?.[1]
}

/**
 * The desktop paints the composer modes from `styles/index.css`, mobile from
 * `@superone/shared/composer-mode`. These hold the stylesheet to the shared
 * palette so the two cannot drift.
 */
describe('ComposerModeBorder palette', () => {
  it('declares Ultracode\'s three colours per theme as the shared palette has them', () => {
    const names = ['ultracode', 'ultracode-2', 'ultracode-3']
    expect(names.map((name) => declared(':root', name))).toEqual(ULTRACODE_COLORS.light.map(rgb))
    expect(names.map((name) => declared('.dark', name))).toEqual(ULTRACODE_COLORS.dark.map(rgb))
  })

  it('declares the ultrathink rainbow as the shared palette has it', () => {
    expect(ULTRATHINK_COLORS.map((_, i) => declared(':root', `ultrathink-${i}`))).toEqual(ULTRATHINK_COLORS.map(rgb))
  })

  it('turns Codex Ultra and the sparkles in the shared colours', () => {
    const codex = css.slice(css.indexOf(".composer-mode-border[data-mode='codex-ultra'] {"))
    const ring = codex.slice(0, codex.indexOf('}'))
    for (const color of CODEX_ULTRA_COLORS) expect(ring).toContain(`rgb(${rgb(color)})`)
    expect(ring).toContain(`--cmb-sparkle: ${rgb(COMPOSER_MODE_SPARKLE_COLORS['codex-ultra']!.light)};`)
    expect(css).toContain(`.dark .composer-mode-border[data-mode='codex-ultra'] { --cmb-sparkle: ${rgb(COMPOSER_MODE_SPARKLE_COLORS['codex-ultra']!.dark)}; }`)
    expect(css).toContain(`--cmb-sparkle: ${rgb(COMPOSER_MODE_SPARKLE_COLORS.ultracode!.light)};`)
    expect(css).toContain(`.dark .composer-mode-border[data-mode='ultracode'] { --cmb-sparkle: ${rgb(COMPOSER_MODE_SPARKLE_COLORS.ultracode!.dark)}; }`)
  })
})
