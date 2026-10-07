import { describe, expect, it } from 'vitest'
import { keywordHighlight } from './prompt-keyword-highlight'

const CLAUDE = ['ultrathink', 'ultracode'] as const

describe('keywordHighlight', () => {
  it('paints each keyword letter at its editor offset, chips counting as one character', () => {
    const highlight = keywordHighlight({ text: '￼ ultracode it', eventCount: 7 }, CLAUDE, { dark: false, animate: true })
    expect(highlight).toMatchObject({ eventCount: 7, animate: true, stepMs: 50, steps: 30, band: 3 })
    expect(highlight.letters.map((letter) => letter.offset)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(highlight.letters[0]).toEqual({ offset: 2, index: 0, color: '#8700ff', shimmer: '#340078' })
  })

  it('runs the rainbow along ultrathink and follows the theme', () => {
    const [first, , third] = keywordHighlight({ text: 'ultrathink', eventCount: 1 }, CLAUDE, { dark: true, animate: false }).letters
    expect(first).toMatchObject({ color: '#eb5f57', shimmer: '#fa9b93' })
    expect(third).toMatchObject({ color: '#fac35f', shimmer: '#ffe19b' })
  })

  it('paints nothing a harness does not read, nor a question about the word', () => {
    expect(keywordHighlight({ text: 'ultrathink', eventCount: 1 }, [], { dark: false, animate: true }).letters).toEqual([])
    expect(keywordHighlight({ text: 'what is ultracode?', eventCount: 1 }, CLAUDE, { dark: false, animate: true }).letters).toEqual([])
  })
})
