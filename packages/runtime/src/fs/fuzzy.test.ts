import { describe, expect, it } from 'vitest'
import { fuzzyMatch, searchMentionsInEntries, searchFilesInEntries } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches subsequence and scores basename higher', () => {
    const r = fuzzyMatch('app', 'src/app.ts')
    expect(r.match).toBe(true)
    expect(r.indices.length).toBeGreaterThan(0)
  })
})

describe('searchMentionsInEntries', () => {
  const entries = [
    { path: 'src/app.ts', isDirectory: false },
    { path: 'src/lib/util.ts', isDirectory: false },
    { path: 'README.md', isDirectory: false },
  ]

  it('filters by query', () => {
    const hits = searchMentionsInEntries(entries, 'app', [], 10)
    expect(hits.some((h) => h.kind === 'file' && h.path.includes('app'))).toBe(true)
  })

  it('includes agents when unscoped', () => {
    const hits = searchMentionsInEntries(entries, 'agent', [{ name: 'agent-x', model: 'm' }], 10)
    expect(hits.some((h) => h.kind === 'agent' && h.name === 'agent-x')).toBe(true)
  })
})

describe('searchFilesInEntries', () => {
  it('returns ranked paths', () => {
    const hits = searchFilesInEntries(
      [
        { path: 'a.ts', isDirectory: false },
        { path: 'b/app.ts', isDirectory: false },
      ],
      'app',
      5,
    )
    expect(hits[0]?.path).toContain('app')
  })
})
