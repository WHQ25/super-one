import { describe, expect, it } from 'vitest'
import { findPromptKeywords, hasPromptKeyword } from './prompt-keywords'

const words = (text: string, keyword: 'ultrathink' | 'ultracode') =>
  findPromptKeywords(text, [keyword]).map(({ start, end }) => text.slice(start, end))

describe('findPromptKeywords', () => {
  it('finds ultrathink as a whole word in any case, next to CJK text too', () => {
    expect(findPromptKeywords('UltraThink 这个问题，再 ultrathink一下', ['ultrathink'])).toEqual([
      { keyword: 'ultrathink', start: 0, end: 10 },
      { keyword: 'ultrathink', start: 18, end: 28 },
    ])
  })

  it('skips ultrathink inside a longer identifier', () => {
    expect(words('ultrathinking ultrathink_mode xultrathink', 'ultrathink')).toEqual([])
  })

  it('finds ultrathink even where ultracode would be only mentioned', () => {
    expect(words('/review "ultrathink"', 'ultrathink')).toEqual(['ultrathink'])
  })

  it('returns both keywords in text order', () => {
    expect(findPromptKeywords('ultracode it, ultrathink first', ['ultrathink', 'ultracode']).map((m) => m.keyword))
      .toEqual(['ultracode', 'ultrathink'])
  })

  it('finds nothing for a harness without keywords', () => {
    expect(findPromptKeywords('ultrathink ultracode', [])).toEqual([])
  })
})

describe('ultracode', () => {
  it('triggers as a plain word, next to CJK text and after an apostrophe word', () => {
    expect(words('Ultracode 把存储层迁到 SQLite，don\'t skip ultracode。', 'ultracode')).toEqual(['Ultracode', 'ultracode'])
  })

  it('does not trigger in a slash command', () => {
    expect(words('/review ultracode', 'ultracode')).toEqual([])
  })

  it('skips quoted, bracketed and tag mentions', () => {
    expect(words('"ultracode" `ultracode` (ultracode) [ultracode] <ultracode> \'ultracode\'', 'ultracode')).toEqual([])
  })

  it('still triggers after a quote that never closes', () => {
    expect(words('"draft ultracode', 'ultracode')).toEqual(['ultracode'])
  })

  it('skips paths, flags, file names and questions about the word', () => {
    expect(words('docs/ultracode ultracode/x --ultracode ultracode-mode ultracode.md what is ultracode?', 'ultracode')).toEqual([])
  })

  it('triggers before sentence punctuation', () => {
    expect(words('Run it with ultracode. Then ultracode!', 'ultracode')).toEqual(['ultracode', 'ultracode'])
  })
})

describe('hasPromptKeyword', () => {
  it('applies the same rules as findPromptKeywords', () => {
    expect(hasPromptKeyword('refactor the store, ultracode', 'ultracode')).toBe(true)
    expect(hasPromptKeyword('what is ultracode?', 'ultracode')).toBe(false)
    expect(hasPromptKeyword('/review ultracode', 'ultracode')).toBe(false)
  })
})
