import { describe, it, expect, beforeEach } from 'vitest'
import {
  highlightRhai,
  isRhaiLanguage,
  resetRhaiHighlighterForTests,
  rhaiLanguageRegistration,
} from './rhai-highlight'

const SAMPLE = `let meta = #{
    name: "demo",
};
// comment
phase("Scan");
let r = agent(p, #{ label: "x" });
`

describe('isRhaiLanguage', () => {
  it('matches rhai case-insensitively', () => {
    expect(isRhaiLanguage('rhai')).toBe(true)
    expect(isRhaiLanguage('Rhai')).toBe(true)
    expect(isRhaiLanguage(' javascript ')).toBe(false)
  })
})

describe('rhaiLanguageRegistration', () => {
  it('registers as shiki language id rhai with source.rhai scope', () => {
    expect(rhaiLanguageRegistration.name).toBe('rhai')
    expect(rhaiLanguageRegistration.scopeName).toBe('source.rhai')
  })
})

describe('highlightRhai', () => {
  beforeEach(() => {
    resetRhaiHighlighterForTests()
  })

  it('highlights Rhai maps and keywords (async then cache)', async () => {
    const themes = ['github-light', 'github-dark'] as const
    const first = await new Promise<NonNullable<ReturnType<typeof highlightRhai>>>((resolve, reject) => {
      const sync = highlightRhai(SAMPLE, [...themes], (res) => resolve(res))
      if (sync) resolve(sync)
      setTimeout(() => reject(new Error('timeout waiting for rhai highlight')), 10_000)
    })

    expect(first.tokens.length).toBeGreaterThan(3)
    const flat = first.tokens.flat()
    const letTok = flat.find((t) => t.content === 'let')
    const commentTok = flat.find((t) => t.content.includes('// comment'))
    const stringTok = flat.find((t) => t.content.includes('demo'))
    expect(letTok?.color).toBeTruthy()
    expect(commentTok?.color).toBeTruthy()
    expect(stringTok?.color).toBeTruthy()
    // Keywords and comments should not share the same default fg-only style when themed.
    expect(letTok?.color).not.toBe(commentTok?.color)

    // Second call is synchronous from cache.
    const cached = highlightRhai(SAMPLE, [...themes])
    expect(cached).not.toBeNull()
    expect(cached?.tokens.length).toBe(first.tokens.length)
  })
})
