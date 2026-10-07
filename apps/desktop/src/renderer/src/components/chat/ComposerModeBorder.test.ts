import { describe, expect, it } from 'vitest'
import { composerMode } from './ComposerModeBorder'

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
