import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { gitRun, type GitRunOptions } from './run'
import { GIT_READ_OPTS, handoffPreview, handoffToMain, worktreeGit } from './worktree-ops'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

describe('worktree ops', () => {
  let dir: string
  const trash: string[] = []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 's1-wt-ops-'))
    trash.push(dir)
    git(dir, ['init', '-b', 'main'])
    git(dir, ['config', 'user.email', 't@example.com'])
    git(dir, ['config', 'user.name', 't'])
    writeFileSync(join(dir, 'README.md'), 'hi\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-m', 'init'])
  })

  afterEach(() => {
    while (trash.length) rmSync(trash.pop()!, { recursive: true, force: true })
  })

  function addWorktree(file: string): string {
    const wt = join(tmpdir(), `s1-wt-ops-wt-${Math.random().toString(36).slice(2)}`)
    trash.push(wt)
    git(dir, ['worktree', 'add', '--detach', wt, 'main'])
    writeFileSync(join(wt, file), `${file}\n`)
    return wt
  }

  it('snapshots the working tree for a preview with timed git only', async () => {
    const wt = addWorktree('a.txt')
    const calls: Array<{ args: string[]; opts?: GitRunOptions }> = []
    const recording: typeof gitRun = (cwd, args, env, opts) => {
      calls.push({ args, opts })
      return gitRun(cwd, args, env, opts)
    }

    expect(await handoffPreview(worktreeGit(recording), wt)).toEqual({ files: 1, insertions: 1, deletions: 0 })
    expect(calls.map((c) => c.args[0])).toEqual(expect.arrayContaining(['read-tree', 'add', 'write-tree']))
    expect(calls.every((c) => c.opts === GIT_READ_OPTS)).toBe(true)
  })

  it('queues handoffs reaching one repo through different spellings of its path', async () => {
    const link = join(tmpdir(), `s1-wt-ops-link-${Math.random().toString(36).slice(2)}`)
    symlinkSync(dir, link)
    trash.push(link)
    const viaReal = addWorktree('a.txt')
    const viaLink = addWorktree('b.txt')
    const g = worktreeGit()
    // Point the second worktree's main checkout at the symlink.
    const reached: typeof gitRun = (cwd, args, env, opts) =>
      gitRun(cwd, args, env, opts).then((out) =>
        args[0] === 'rev-parse' && args[1] === '--git-common-dir' ? join(link, '.git') : out,
      )

    const results = await Promise.all([handoffToMain(g, viaReal), handoffToMain(worktreeGit(reached), viaLink)])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.reason === 'main-dirty')).toHaveLength(1)
  })
})
