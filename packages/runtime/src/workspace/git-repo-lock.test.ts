import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { WorkspaceGitService } from './git-service'
import type { WorkspaceProjects } from './workspace-projects'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

/** Repo-mutating flows on one repo must not interleave across concurrent RPCs. */
describe('WorkspaceGitService repo serialization', () => {
  let dir: string
  let home: string
  let prevHome: string | undefined
  let svc: WorkspaceGitService

  beforeEach(() => {
    // Worktrees land under ~/.worktrees; keep them out of the real home.
    home = mkdtempSync(join(tmpdir(), 's1-home-'))
    prevHome = process.env.HOME
    process.env.HOME = home
    dir = mkdtempSync(join(tmpdir(), 's1-lock-'))
    git(dir, ['init', '-b', 'main'])
    git(dir, ['config', 'user.email', 't@example.com'])
    git(dir, ['config', 'user.name', 't'])
    writeFileSync(join(dir, 'README.md'), 'hi\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-m', 'init'])
    const projects = {
      get: () => ({ projectId: 'p1', path: dir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as WorkspaceProjects
    svc = new WorkspaceGitService(projects)
  })

  afterEach(() => {
    process.env.HOME = prevHome
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it('keeps the user stash when two carrying activations run at once', async () => {
    writeFileSync(join(dir, 'README.md'), 'user stash\n')
    git(dir, ['stash', 'push', '-m', 'user-s0'])
    const userStash = git(dir, ['rev-parse', 'refs/stash']).trim()
    writeFileSync(join(dir, 'README.md'), 'local edit\n')

    const input = { baseBranch: 'main', mode: 'detach' as const, carryLocalChanges: true }
    const [a, b] = await Promise.all([svc.activateWorktree('p1', input), svc.activateWorktree('p1', input)])

    expect(a.path).not.toBe(b.path)
    expect(existsSync(a.path) && existsSync(b.path)).toBe(true)
    expect(git(dir, ['rev-parse', 'refs/stash']).trim()).toBe(userStash)
    expect(git(dir, ['stash', 'list']).trim().split('\n')).toHaveLength(1)
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('local edit\n')
  })

  it('lets only one of two concurrent handoffs land on a clean main', async () => {
    const wts: string[] = []
    for (const name of ['a', 'b']) {
      const { path } = await svc.activateWorktree('p1', { baseBranch: 'main', mode: 'detach' })
      writeFileSync(join(path, `${name}.txt`), `${name}\n`)
      wts.push(path)
    }

    const results = await Promise.all(wts.map((wt) => svc.handoffToMain('p1', wt)))

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.reason === 'main-dirty')).toHaveLength(1)
    const landed = wts[results.findIndex((r) => r.ok)] === wts[0] ? 'a' : 'b'
    expect(git(dir, ['status', '--porcelain']).trim()).toBe(`?? ${landed}.txt`)
  })
})
