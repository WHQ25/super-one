import { describe, expect, it } from 'vitest'
import { gitFileTone, parseGitPorcelain, strongestGitTone } from './git-file-status'

describe('reading git porcelain into per-file status', () => {
  it('splits the staged and unstaged sides of each entry', () => {
    expect(parseGitPorcelain('M  src/a.ts\n M src/b.ts\nMM src/c.ts')).toEqual([
      { path: 'src/a.ts', index: 'M', worktree: null },
      { path: 'src/b.ts', index: null, worktree: 'M' },
      { path: 'src/c.ts', index: 'M', worktree: 'M' },
    ])
  })

  // The tree shows where a file is now, not where it used to be.
  it('files a rename under its new path', () => {
    expect(parseGitPorcelain('R  src/old.ts -> src/new.ts')).toEqual([
      { path: 'src/new.ts', index: 'R', worktree: null },
    ])
  })

  // Untracked is `??` — git fills BOTH columns, which is why `gitFileTone` reads
  // an untracked file as staged rather than dimming it.
  it('unquotes a path git had to escape', () => {
    expect(parseGitPorcelain('?? "src/a\\"b.ts"')).toEqual([
      { path: 'src/a"b.ts', index: '?', worktree: '?' },
    ])
  })

  it('ignores blank lines and unrecognised codes rather than inventing a status', () => {
    expect(parseGitPorcelain('\n   \n?? new.ts')).toEqual([
      { path: 'new.ts', index: '?', worktree: '?' },
    ])
  })
})

describe('the tone a file paints as', () => {
  it('has no tone when both sides are clean', () => {
    expect(gitFileTone(null, null)).toBeNull()
  })

  it('reports a staged change as staged and an unstaged one as not', () => {
    expect(gitFileTone('M', null)).toEqual({ tone: 'modified', staged: true, partiallyStaged: false })
    expect(gitFileTone(null, 'M')).toEqual({ tone: 'modified', staged: false, partiallyStaged: false })
    expect(gitFileTone('M', 'M')).toEqual({ tone: 'modified', staged: true, partiallyStaged: true })
  })

  // An untracked file has no index side by definition; dimming it would make every
  // new file look half-present.
  it('does not treat untracked as unstaged', () => {
    expect(gitFileTone(null, '?')).toEqual({ tone: 'added', staged: true, partiallyStaged: false })
  })

  it('lets ignored win over whatever else the pair says', () => {
    expect(gitFileTone('M', '!')).toEqual({ tone: 'ignored', staged: false, partiallyStaged: false })
  })
})

describe('a folder summarising what changed inside it', () => {
  it('takes the loudest tone beneath it', () => {
    expect(strongestGitTone(['modified', 'added'])).toBe('modified')
    expect(strongestGitTone(['modified', 'deleted'])).toBe('deleted')
    expect(strongestGitTone(['deleted', 'conflict', 'modified'])).toBe('conflict')
  })

  it('has nothing to say about an empty set', () => {
    expect(strongestGitTone([])).toBeNull()
  })
})
