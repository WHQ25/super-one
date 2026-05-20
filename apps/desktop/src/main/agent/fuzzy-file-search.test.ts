import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fuzzyMatch, searchFiles, searchMentions, collectFiles, EXCLUDED_DIRS } from './fuzzy-file-search'

// Deterministic fixture tree instead of root: walking the real cwd
// (apps/desktop) is non-deterministic and starves the collectFiles maxFiles cap
// once a dev machine accumulates a large gitignored .dev-data (Electron userData).
let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 's1-fuzzy-'))
  const agentDir = join(root, 'src', 'main', 'agent')
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'fuzzy-file-search.ts'), '// fuzzy\n')
  writeFileSync(join(agentDir, 'fuzzy-file-search.test.ts'), '// fuzzy test\n')
  writeFileSync(join(agentDir, 'session.ts'), '// session\n')
  writeFileSync(join(root, 'src', 'main', 'index.ts'), '// index\n')
  writeFileSync(join(root, 'README.md'), '# fixture\n')
  // Excluded dir must be skipped by collectFiles even though it sorts first.
  mkdirSync(join(root, 'node_modules', 'junk'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'junk', 'fuzzy.ts'), '// should be excluded\n')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

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
    for (const dir of ['.git', '.next', '.nuxt', '.turbo', '.cache', '.venv', '.gradle', '.cargo', '.tox', '.mypy_cache', 'node_modules', 'dist', 'build', '__pycache__']) {
      expect(EXCLUDED_DIRS.has(dir)).toBe(true)
    }
  })
})

describe('searchFiles', () => {
  it('should return empty for non-existent root', () => {
    const results = searchFiles(['/nonexistent_path_xyz'], 'test')
    expect(results).toEqual([])
  })

  it('should respect limit parameter', () => {
    const results = searchFiles([root], '', 5)
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it('should sort results by score (best match first)', () => {
    const results = searchFiles([root], 'fuzzy-file-search')
    if (results.length >= 2) {
      const thisFile = results.find((r) => r.path.includes('fuzzy-file-search.ts') && !r.path.includes('.test.'))
      expect(thisFile).toBeDefined()
      expect(results.indexOf(thisFile!)).toBeLessThan(5)
    }
  })

  it('should include matchIndices in results', () => {
    const results = searchFiles([root], 'fuzzy')
    for (const r of results) {
      expect(Array.isArray(r.matchIndices)).toBe(true)
      expect(r.matchIndices.length).toBeGreaterThan(0)
    }
  })

  it('should return results with empty query', () => {
    const results = searchFiles([root], '', 10)
    for (const r of results) {
      expect(r.matchIndices).toEqual([])
    }
  })

  it('should not include rootPath when using a single root', () => {
    const results = searchFiles([root], 'fuzzy', 5)
    for (const r of results) {
      expect(r.rootPath).toBeUndefined()
    }
  })

  it('should include rootPath when using multiple roots', () => {
    const results = searchFiles([root, root], 'fuzzy', 5)
    for (const r of results) {
      expect(r.rootPath).toBe(root)
    }
  })
})

describe('collectFiles', () => {
  it('should track root for each collected file', () => {
    const files = collectFiles([root])
    expect(files.length).toBeGreaterThan(0)
    for (const f of files.slice(0, 10)) {
      expect(f.root).toBe(root)
    }
  })

  it('respects .gitignore so a gitignored heavy subtree (e.g. Electron .dev-data) does not consume the maxFiles cap', () => {
    const starveRoot = mkdtempSync(join(tmpdir(), 's1-starve-'))
    try {
      const heavy = join(starveRoot, '.dev-data', 'Cache', 'Cache_Data')
      mkdirSync(heavy, { recursive: true })
      for (let i = 0; i < 200; i++) writeFileSync(join(heavy, `blob-${i}.bin`), 'x')
      const deep = join(starveRoot, 'src', 'main', 'agent')
      mkdirSync(deep, { recursive: true })
      writeFileSync(join(deep, 'target-xyzzy.ts'), '// findme\n')
      writeFileSync(join(starveRoot, '.gitignore'), '.dev-data\n')

      const files = collectFiles([starveRoot], 10, 40)
      const found = files.some((f) => f.path === 'src/main/agent/target-xyzzy.ts')
      expect(found).toBe(true)
      expect(files.some((f) => f.path.startsWith('.dev-data'))).toBe(false)
    } finally {
      rmSync(starveRoot, { recursive: true, force: true })
    }
  })
})

describe('searchMentions', () => {
  it('should include rootPath for file items with multiple roots', () => {
    const results = searchMentions([root, root], 'fuzzy', [], 5)
    const fileItems = results.filter((r) => r.kind === 'file')
    expect(fileItems.length).toBeGreaterThan(0)
    for (const r of fileItems) {
      expect(r.rootPath).toBe(root)
    }
  })

  it('should not include rootPath for file items with single root', () => {
    const results = searchMentions([root], 'fuzzy', [], 5)
    const fileItems = results.filter((r) => r.kind === 'file')
    for (const r of fileItems) {
      expect(r.rootPath).toBeUndefined()
    }
  })

  it('should not include rootPath for agent items', () => {
    const results = searchMentions([root, root], 'test', [{ name: 'test-agent', model: 'opus' }], 10)
    const agentItems = results.filter((r) => r.kind === 'agent')
    for (const r of agentItems) {
      expect('rootPath' in r).toBe(false)
    }
  })
})
