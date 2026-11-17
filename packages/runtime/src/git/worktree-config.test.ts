import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { normalizeRepoRelativePath, readWorktreeConfig } from './worktree-config'

describe('worktree config', () => {
  const trash: string[] = []
  afterEach(() => {
    while (trash.length) rmSync(trash.pop()!, { recursive: true, force: true })
  })

  function repoWith(content: string | null): string {
    const dir = mkdtempSync(join(tmpdir(), 's1-wt-config-'))
    trash.push(dir)
    if (content !== null) {
      mkdirSync(join(dir, '.superone'))
      writeFileSync(join(dir, '.superone', 'worktree.json'), content)
    }
    return dir
  }

  it('keeps only paths that stay inside the checkout', () => {
    expect(normalizeRepoRelativePath(' apps/desktop/ ')).toBe('apps/desktop')
    expect(normalizeRepoRelativePath('apps\\desktop')).toBe('apps/desktop')
    expect(normalizeRepoRelativePath('./packages/../apps')).toBe('apps')
    for (const bad of ['', '.', '..', '../x', 'a/../../x', '/etc', 'C:\\x', '.git', '.git/hooks', 7, null]) {
      expect(normalizeRepoRelativePath(bad)).toBeNull()
    }
  })

  it('reads sparse and shared paths, dropping invalid and repeated entries', () => {
    const dir = repoWith(JSON.stringify({
      sparsePaths: ['apps/desktop', 'apps/desktop/', '../outside'],
      sharedPaths: ['node_modules', '/abs', 3],
    }))
    expect(readWorktreeConfig(dir)).toEqual({ sparsePaths: ['apps/desktop'], sharedPaths: ['node_modules'] })
  })

  it('falls back to a full checkout when the file is missing or malformed', () => {
    const empty = { sparsePaths: [], sharedPaths: [] }
    expect(readWorktreeConfig(repoWith(null))).toEqual(empty)
    expect(readWorktreeConfig(repoWith('{ not json'))).toEqual(empty)
    expect(readWorktreeConfig(repoWith('[]'))).toEqual(empty)
    expect(readWorktreeConfig(repoWith('{"sparsePaths":"apps"}'))).toEqual(empty)
  })
})
