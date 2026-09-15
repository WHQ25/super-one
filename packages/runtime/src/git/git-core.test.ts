import { describe, expect, it } from 'vitest'
import { sanitizeGitRef, gitErrorMessage, isNotGitRepoError, parseShortstat, parseWorktreePorcelain } from './index'

describe('sanitizeGitRef', () => {
  it('accepts normal branch names', () => {
    expect(sanitizeGitRef('feat/x')).toBe('feat/x')
  })

  it('rejects empty, dash-prefixed, and control chars', () => {
    expect(() => sanitizeGitRef('')).toThrow(/empty/)
    expect(() => sanitizeGitRef('-bad')).toThrow(/dash/)
    expect(() => sanitizeGitRef('a\nb')).toThrow(/control/)
  })
})

describe('parseShortstat', () => {
  it('parses insertion and deletion counts', () => {
    expect(parseShortstat(' 2 files changed, 10 insertions(+), 4 deletions(-)\n')).toEqual({
      insertions: 10,
      deletions: 4,
    })
  })

  it('returns zeros for empty', () => {
    expect(parseShortstat('')).toEqual({ insertions: 0, deletions: 0 })
  })
})

describe('parseWorktreePorcelain', () => {
  it('parses multi-entry porcelain', () => {
    const raw = [
      'worktree /repo',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktrees/feat',
      'HEAD def',
      'branch refs/heads/feat',
      '',
    ].join('\n')
    const entries = parseWorktreePorcelain(raw)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ path: '/repo', branch: 'main' })
    expect(entries[1]).toMatchObject({ path: '/repo/.worktrees/feat', branch: 'feat' })
  })
})

describe('gitErrorMessage', () => {
  it('prefers stderr', () => {
    expect(gitErrorMessage({ stderr: '  boom  ', message: 'x' })).toBe('boom')
    expect(gitErrorMessage(new Error('e'))).toBe('e')
  })
})

describe('isNotGitRepoError', () => {
  it('matches only the not-a-repository failure', () => {
    expect(isNotGitRepoError({ stderr: 'fatal: not a git repository (or any of the parent directories): .git' })).toBe(true)
    expect(isNotGitRepoError({ stderr: 'fatal: detected dubious ownership in repository at /repo' })).toBe(false)
    expect(isNotGitRepoError({ stderr: 'You have not agreed to the Xcode license agreements.' })).toBe(false)
    expect(isNotGitRepoError(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }))).toBe(false)
  })
})
