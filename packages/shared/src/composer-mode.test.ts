import { describe, expect, it } from 'vitest'
import {
  COMPOSER_MODE_SPARKLE_COLORS, composerMode, composerModeRing, promptKeywordLetterColors, promptKeywordLetterLit, ULTRATHINK_COLORS,
} from './composer-mode'

const CLAUDE = ['ultrathink', 'ultracode'] as const
const mode = (text: string, ultracode = false) => composerMode({ text, promptKeywords: CLAUDE, ultracode })

describe('composerMode', () => {
  it('shows ultrathink for a draft that asks for it', () => {
    expect(mode('fix the race, ultrathink')).toBe('ultrathink')
  })

  it('lets Ultracode outrank ultrathink, from the toggle or the draft', () => {
    expect(mode('ultrathink about it', true)).toBe('ultracode')
    expect(mode('ultrathink, then ultracode')).toBe('ultracode')
  })

  it('follows the keyword rules: a question about ultracode does not ask for it', () => {
    expect(mode('what is ultracode?')).toBeNull()
  })

  it('shows nothing for a harness that reads no keywords', () => {
    expect(composerMode({ text: 'ultrathink ultracode', promptKeywords: [], ultracode: true })).toBeNull()
  })

  it('shows Codex Ultra from the effort alone, whatever the draft says', () => {
    expect(composerMode({ text: 'ultrathink', promptKeywords: [], ultracode: false, codexReasoningEffort: 'ultra' })).toBe('codex-ultra')
    expect(composerMode({ text: '', promptKeywords: [], ultracode: false, codexReasoningEffort: 'xhigh' })).toBeNull()
  })
})

describe('composer mode palettes', () => {
  it('closes every ring on its first colour, so the turn has no seam', () => {
    for (const ring of [composerModeRing('ultracode', false), composerModeRing('codex-ultra', true), composerModeRing('ultrathink', true)]) {
      expect(ring.at(-1)).toEqual(ring[0])
    }
    expect(composerModeRing('ultrathink', false)).toHaveLength(ULTRATHINK_COLORS.length + 1)
  })

  it('sparkles only for the multi-agent modes', () => {
    expect(Object.keys(COMPOSER_MODE_SPARKLE_COLORS).sort()).toEqual(['codex-ultra', 'ultracode'])
  })
})

describe('prompt keyword letters', () => {
  it('runs ultrathink\'s rainbow by letter, wrapping after violet, and keeps Ultracode purple', () => {
    expect(promptKeywordLetterColors('ultrathink', 7, false).color).toEqual(ULTRATHINK_COLORS[0])
    expect(promptKeywordLetterColors('ultracode', 4, true)).toEqual({ color: [175, 135, 255], shimmer: [208, 180, 255] })
  })

  it('lights a three-letter band that steps one letter at a time over a 30-step cycle', () => {
    const lit = (step: number) => Array.from({ length: 10 }, (_, i) => i).filter((i) => promptKeywordLetterLit(step, i))
    expect(lit(0)).toEqual([0])
    expect(lit(4)).toEqual([2, 3, 4])
    expect(lit(12)).toEqual([])
    expect(lit(30)).toEqual(lit(0))
  })
})
