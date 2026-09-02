import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { worktreeExists } from './worktree-alive'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

const trash: string[] = []

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wt-alive-'))
  trash.push(dir)
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  return dir
}

afterEach(() => {
  while (trash.length) rmSync(trash.pop()!, { recursive: true, force: true })
})

describe('worktreeExists', () => {
  it('reports a live worktree as alive', () => {
    const repo = makeRepo()
    const wt = join(repo, '..', `wt-live-${process.pid}`)
    trash.push(wt)
    git(repo, 'worktree', 'add', '-q', '--detach', wt)

    expect(worktreeExists(wt, repo)).toBe(true)
  })

  it('reports a removed worktree as gone even when residue keeps the directory alive', () => {
    const repo = makeRepo()
    const wt = join(repo, '..', `wt-residue-${process.pid}`)
    trash.push(wt)
    git(repo, 'worktree', 'add', '-q', '--detach', wt)
    git(repo, 'worktree', 'remove', '--force', wt)
    // What `git worktree remove` leaves behind in practice: an untracked
    // dotfile tree a harness process recreated in the old cwd.
    mkdirSync(join(wt, '.claude', '.cc-writes'), { recursive: true })

    expect(worktreeExists(wt, repo)).toBe(false)
  })

  it('reports a fully deleted worktree as gone', () => {
    const repo = makeRepo()
    expect(worktreeExists(join(repo, '..', 'never-existed'), repo)).toBe(false)
  })

  it('keeps a cwd inside the project checkout alive despite having no .git of its own', () => {
    const repo = makeRepo()
    const sub = join(repo, 'apps', 'desktop')
    mkdirSync(sub, { recursive: true })

    expect(worktreeExists(sub, repo)).toBe(true)
  })

  it('keeps the project root itself alive', () => {
    const repo = makeRepo()
    expect(worktreeExists(repo, repo)).toBe(true)
  })

  it('treats an empty path as gone', () => {
    expect(worktreeExists('', makeRepo())).toBe(false)
  })
})
