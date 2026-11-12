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
  it('ranks inside the folder before applying the limit', () => {
    const outside = Array.from({ length: 30 }, (_, i) => ({ path: `other/file-${i}.ts`, isDirectory: false }))
    const hits = searchFilesInEntries(
      [...outside, { path: 'src/components/Button.tsx', isDirectory: false }],
      'Button',
      5,
      'src',
    )
    expect(hits.map((hit) => hit.path)).toEqual(['src/components/Button.tsx'])
    expect(hits[0]?.matchIndices).toContain('src/components/Button.tsx'.indexOf('B'))
  })

  it('matches without regard to case', () => {
    const hits = searchFilesInEntries(
      [{ path: 'src/Button.tsx', isDirectory: false }],
      'button',
      5,
    )
    expect(hits.map((hit) => hit.path)).toEqual(['src/Button.tsx'])
  })

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
