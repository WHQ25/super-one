import { describe, it, expect } from 'vitest'
import { fuzzyMatch, searchFiles, searchMentions, collectFiles, EXCLUDED_DIRS } from './fuzzy-file-search'

describe('fuzzyMatch', () => {
  it('should match basic subsequence', () => {
    const result = fuzzyMatch('ChatIn', 'src/components/chat/ChatInput.tsx')
    expect(result.match).toBe(true)
    expect(result.indices.length).toBe(6)
  })

  it('should be case-insensitive', () => {
    const result = fuzzyMatch('chatin', 'src/components/chat/ChatInput.tsx')
    expect(result.match).toBe(true)
  })

  it('should return false for non-matching query', () => {
    const result = fuzzyMatch('xyz123', 'src/components/chat/ChatInput.tsx')
    expect(result.match).toBe(false)
    expect(result.indices).toEqual([])
  })

  it('should return correct indices for highlighting', () => {
    const result = fuzzyMatch('ab', 'a/b.ts')
    expect(result.match).toBe(true)
    expect(result.indices).toEqual([0, 2])
  })

  it('should give higher score to basename matches', () => {
    const basenameMatch = fuzzyMatch('Chat', 'src/Chat.tsx')
    const deepMatch = fuzzyMatch('Chat', 'Chat/deep/nested/file.tsx')
    expect(basenameMatch.score).toBeGreaterThan(deepMatch.score)
  })

  it('should give higher score to consecutive character matches', () => {
    const consecutive = fuzzyMatch('abc', 'abc.ts')
    const scattered = fuzzyMatch('abc', 'a_b_c.ts')
    expect(consecutive.score).toBeGreaterThan(scattered.score)
  })

  it('should give bonus for boundary matches (after /)', () => {
    const boundary = fuzzyMatch('sC', 'src/Components')
    expect(boundary.match).toBe(true)
    expect(boundary.indices[0]).toBe(0)
    const nonBoundary = fuzzyMatch('xf', 'axe/foo.ts')
    expect(nonBoundary.match).toBe(true)
    expect(nonBoundary.indices[1]).toBe(4)
  })

  it('should give exact case match bonus', () => {
    const exactCase = fuzzyMatch('Chat', 'ChatInput.tsx')
    const wrongCase = fuzzyMatch('chat', 'ChatInput.tsx')
    expect(exactCase.score).toBeGreaterThan(wrongCase.score)
  })

  it('should prefer contiguous match over scattered greedy match', () => {
    const result = fuzzyMatch('chat', 'src/components/chat/ChatInput.tsx')
    expect(result.match).toBe(true)
    const matched = result.indices.map((i) => 'src/components/chat/ChatInput.tsx'[i]).join('')
    expect(matched.toLowerCase()).toBe('chat')
    expect(result.indices[1] - result.indices[0]).toBe(1)
    expect(result.indices[2] - result.indices[1]).toBe(1)
    expect(result.indices[3] - result.indices[2]).toBe(1)
  })

  it('should match empty query to everything', () => {
    const result = fuzzyMatch('', 'any/file.ts')
    expect(result.match).toBe(true)
    expect(result.indices).toEqual([])
  })
})

describe('collectFiles', () => {
  it('should have standard excluded dirs', () => {
    expect(EXCLUDED_DIRS.has('.git')).toBe(true)
    expect(EXCLUDED_DIRS.has('node_modules')).toBe(true)
    expect(EXCLUDED_DIRS.has('dist')).toBe(true)
    expect(EXCLUDED_DIRS.has('build')).toBe(true)
    expect(EXCLUDED_DIRS.has('__pycache__')).toBe(true)
  })
})

describe('searchFiles', () => {
  it('should return empty for non-existent root', () => {
    const results = searchFiles(['/nonexistent_path_xyz'], 'test')
    expect(results).toEqual([])
  })

  it('should respect limit parameter', () => {
    const results = searchFiles([process.cwd()], '', 5)
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it('should sort results by score (best match first)', () => {
    const results = searchFiles([process.cwd()], 'fuzzy-file-search')
    if (results.length >= 2) {
      const thisFile = results.find((r) => r.path.includes('fuzzy-file-search.ts') && !r.path.includes('.test.'))
      expect(thisFile).toBeDefined()
      expect(results.indexOf(thisFile!)).toBeLessThan(5)
    }
  })

  it('should include matchIndices in results', () => {
    const results = searchFiles([process.cwd()], 'fuzzy')
    for (const r of results) {
      expect(Array.isArray(r.matchIndices)).toBe(true)
      expect(r.matchIndices.length).toBeGreaterThan(0)
    }
  })

  it('should return results with empty query', () => {
    const results = searchFiles([process.cwd()], '', 10)
    for (const r of results) {
      expect(r.matchIndices).toEqual([])
    }
  })

  it('should not include rootPath when using a single root', () => {
    const results = searchFiles([process.cwd()], 'fuzzy', 5)
    for (const r of results) {
      expect(r.rootPath).toBeUndefined()
    }
  })

  it('should include rootPath when using multiple roots', () => {
    const results = searchFiles([process.cwd(), process.cwd()], 'fuzzy', 5)
    for (const r of results) {
      expect(r.rootPath).toBe(process.cwd())
    }
  })
})

describe('collectFiles', () => {
  it('should track root for each collected file', () => {
    const files = collectFiles([process.cwd()])
    expect(files.length).toBeGreaterThan(0)
    for (const f of files.slice(0, 10)) {
      expect(f.root).toBe(process.cwd())
    }
  })
})

describe('searchMentions', () => {
  it('should include rootPath for file items with multiple roots', () => {
    const results = searchMentions([process.cwd(), process.cwd()], 'fuzzy', [], 5)
    const fileItems = results.filter((r) => r.kind === 'file')
    expect(fileItems.length).toBeGreaterThan(0)
    for (const r of fileItems) {
      expect(r.rootPath).toBe(process.cwd())
    }
  })

  it('should not include rootPath for file items with single root', () => {
    const results = searchMentions([process.cwd()], 'fuzzy', [], 5)
    const fileItems = results.filter((r) => r.kind === 'file')
    for (const r of fileItems) {
      expect(r.rootPath).toBeUndefined()
    }
  })

  it('should not include rootPath for agent items', () => {
    const results = searchMentions([process.cwd(), process.cwd()], 'test', [{ name: 'test-agent', model: 'opus' }], 10)
    const agentItems = results.filter((r) => r.kind === 'agent')
    for (const r of agentItems) {
      expect('rootPath' in r).toBe(false)
    }
  })
})
