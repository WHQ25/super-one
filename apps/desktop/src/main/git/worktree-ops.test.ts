import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// worktree-ops → git-diagnostics → logger pulls in electron, unavailable here.
vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
// activateWorktree writes into `~/.worktrees` — redirect it into a temp home.
const FAKE_HOME = join(tmpdir(), `wt-home-${process.pid}-${Date.now().toString(36)}`)
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => FAKE_HOME }
})

import { activateWorktree, assignBranch, carryUncommittedChanges, getHandoffPreview, handoffToLocal } from './worktree-ops'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

const trash: string[] = []

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-repo-'))
  trash.push(dir)
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  writeFileSync(join(dir, 'README.md'), 'hello\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'init')
  return dir
}

function addWorktree(repo: string, branch = 'feature'): string {
  const wt = join(tmpdir(), `handoff-wt-${Math.random().toString(36).slice(2)}`)
  trash.push(wt)
  git(repo, 'worktree', 'add', '-b', branch, wt, 'main')
  return wt
}

function addDetachedWorktree(repo: string): string {
  const wt = join(tmpdir(), `handoff-wt-${Math.random().toString(36).slice(2)}`)
  trash.push(wt)
  git(repo, 'worktree', 'add', '--detach', wt, 'main')
  return wt
}

afterEach(() => {
  while (trash.length) {
    try { rmSync(trash.pop()!, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  try { rmSync(FAKE_HOME, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('activateWorktree', () => {
  it('gives every concurrent activation its own worktree instead of colliding on the same path', async () => {
    const repo = makeRepo()

    const results = await Promise.all([
      activateWorktree(repo, { baseBranch: 'main', mode: 'detach' }),
      activateWorktree(repo, { baseBranch: 'main', mode: 'detach' }),
      activateWorktree(repo, { baseBranch: 'main', mode: 'detach' }),
    ])

    const paths = results.map((r) => r.path)
    expect(new Set(paths).size).toBe(3)
    for (const path of paths) expect(existsSync(join(path, 'README.md'))).toBe(true)
    // git itself agrees all three are registered worktrees of this repo
    const registered = git(repo, 'worktree', 'list', '--porcelain')
    for (const path of paths) expect(registered).toContain(path)
  })

  it('keeps the source repo intact when concurrent activations carry local changes', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'README.md'), 'hello\nlocal edit\n')
    writeFileSync(join(repo, 'scratch.txt'), 'untracked local\n')

    const results = await Promise.all([
      activateWorktree(repo, { baseBranch: 'main', mode: 'detach', carryLocalChanges: true }),
      activateWorktree(repo, { baseBranch: 'main', mode: 'detach', carryLocalChanges: true }),
    ])

    // Interleaved stash push/pop would leave the source bare or the entry stuck.
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toContain('local edit')
    expect(readFileSync(join(repo, 'scratch.txt'), 'utf8')).toContain('untracked local')
    expect(git(repo, 'stash', 'list')).toBe('')
    for (const result of results) {
      expect(readFileSync(join(result.path, 'README.md'), 'utf8')).toContain('local edit')
    }
  })

  it('rejects a duplicate branch name instead of silently reusing another session worktree', async () => {
    const repo = makeRepo()

    const first = await activateWorktree(repo, { baseBranch: 'main', mode: 'branch', branchName: 'shared' })
    expect(first.recordedBranch).toBe('shared')
    await expect(
      activateWorktree(repo, { baseBranch: 'main', mode: 'branch', branchName: 'shared' }),
    ).rejects.toThrow()
  })
})

describe('handoffToLocal', () => {
  it('copies a branch worktree\'s uncommitted changes onto main and leaves the worktree intact', async () => {
    const repo = makeRepo()
    const wt = addWorktree(repo)
    writeFileSync(join(wt, 'README.md'), 'hello\nfrom worktree\n')
    writeFileSync(join(wt, 'new.txt'), 'untracked content\n')

    const result = await handoffToLocal(wt)

    expect(result).toEqual({ ok: true })
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toContain('from worktree')
    expect(readFileSync(join(repo, 'new.txt'), 'utf8')).toContain('untracked content')
    // non-destructive: the worktree keeps its changes
    expect(readFileSync(join(wt, 'README.md'), 'utf8')).toContain('from worktree')
    expect(git(wt, 'status', '--porcelain')).not.toBe('')
  })

  it('squashes a detached worktree\'s commits and uncommitted changes onto main', async () => {
    const repo = makeRepo()
    const wt = addDetachedWorktree(repo)
    writeFileSync(join(wt, 'feature.txt'), 'committed feature\n')
    git(wt, 'add', '.')
    git(wt, 'commit', '-m', 'add feature')
    writeFileSync(join(wt, 'README.md'), 'hello\nwip\n')

    const result = await handoffToLocal(wt)

    expect(result).toEqual({ ok: true })
    // both the committed work and the uncommitted edit land in main, uncommitted
    expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toContain('committed feature')
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toContain('wip')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'main'))
    // the detached worktree keeps its commit
    expect(readFileSync(join(wt, 'feature.txt'), 'utf8')).toContain('committed feature')
  })

  it('carries only uncommitted work from a branch worktree, leaving its commits on the branch', async () => {
    const repo = makeRepo()
    const wt = addWorktree(repo)
    writeFileSync(join(wt, 'committed.txt'), 'on the branch\n')
    git(wt, 'add', '.')
    git(wt, 'commit', '-m', 'branch commit')
    writeFileSync(join(wt, 'wip.txt'), 'work in progress\n')

    const result = await handoffToLocal(wt)

    expect(result).toEqual({ ok: true })
    expect(readFileSync(join(repo, 'wip.txt'), 'utf8')).toContain('work in progress')
    // the branch commit is the branch's deliverable — it must not leak into main
    expect(existsSync(join(repo, 'committed.txt'))).toBe(false)
  })

  it('refuses when the main repo has uncommitted changes', async () => {
    const repo = makeRepo()
    const wt = addWorktree(repo)
    writeFileSync(join(wt, 'README.md'), 'hello\nworktree edit\n')
    writeFileSync(join(repo, 'README.md'), 'hello\nmain edit\n')

    const result = await handoffToLocal(wt)

    expect(result).toEqual({ ok: false, reason: 'local-dirty' })
    expect(git(wt, 'status', '--porcelain')).not.toBe('')
  })

  it('reports no-changes for a worktree that has not diverged from main', async () => {
    const repo = makeRepo()
    const wt = addWorktree(repo)

    expect(await handoffToLocal(wt)).toEqual({ ok: false, reason: 'no-changes' })
  })

  it('reports not-worktree when called on the main repo itself', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'README.md'), 'hello\nchanged\n')

    expect(await handoffToLocal(repo)).toEqual({ ok: false, reason: 'not-worktree' })
  })

  it('rolls main back to clean when the patch conflicts with diverged branches', async () => {
    const repo = makeRepo()
    const wt = addWorktree(repo)
    // worktree edits line 1; main commits a different line 1 -> 3-way conflict
    writeFileSync(join(wt, 'README.md'), 'WORKTREE\n')
    writeFileSync(join(repo, 'README.md'), 'MAINEDIT\n')
    git(repo, 'commit', '-am', 'main diverges')

    const result = await handoffToLocal(wt)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('conflict')
    // main rolled back: clean working tree, its own committed content intact
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('MAINEDIT\n')
    // worktree changes never lost
    expect(readFileSync(join(wt, 'README.md'), 'utf8')).toBe('WORKTREE\n')
  })
})

describe('assignBranch', () => {
  it('names a detached worktree as a new branch in place, preserving its commits', async () => {
    const repo = makeRepo()
    const wt = addDetachedWorktree(repo)
    writeFileSync(join(wt, 'feature.txt'), 'committed feature\n')
    git(wt, 'add', '.')
    git(wt, 'commit', '-m', 'add feature')
    const headBefore = git(wt, 'rev-parse', 'HEAD')

    const result = await assignBranch(wt, 'feat/login')

    expect(result).toEqual({ ok: true, branch: 'feat/login' })
    // worktree is now on the branch, pointing at the same commit
    expect(git(wt, 'symbolic-ref', '--short', 'HEAD')).toBe('feat/login')
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(headBefore)
    expect(readFileSync(join(wt, 'feature.txt'), 'utf8')).toContain('committed feature')
  })

  it('keeps uncommitted changes when assigning a branch', async () => {
    const repo = makeRepo()
    const wt = addDetachedWorktree(repo)
    writeFileSync(join(wt, 'wip.txt'), 'work in progress\n')

    const result = await assignBranch(wt, 'feat/wip')

    expect(result).toEqual({ ok: true, branch: 'feat/wip' })
    expect(git(wt, 'symbolic-ref', '--short', 'HEAD')).toBe('feat/wip')
    expect(readFileSync(join(wt, 'wip.txt'), 'utf8')).toContain('work in progress')
  })

  it('rejects an empty name', async () => {
    const repo = makeRepo()
    const wt = addDetachedWorktree(repo)

    expect(await assignBranch(wt, '   ')).toEqual({ ok: false, reason: 'name-required' })
  })

  it('rejects a name that already exists as a branch', async () => {
    const repo = makeRepo()
    git(repo, 'branch', 'existing')
    const wt = addDetachedWorktree(repo)

    expect(await assignBranch(wt, 'existing')).toEqual({ ok: false, reason: 'exists' })
    // worktree stays detached
    expect(() => git(wt, 'symbolic-ref', 'HEAD')).toThrow()
  })

  it('rejects a name checked out in another worktree', async () => {
    const repo = makeRepo()
    addWorktree(repo, 'develop')
    const wt = addDetachedWorktree(repo)

    expect(await assignBranch(wt, 'develop')).toEqual({ ok: false, reason: 'checked-out' })
  })

  it('rejects when the worktree is already on a branch', async () => {
    const repo = makeRepo()
    const wt = addWorktree(repo, 'already')

    expect(await assignBranch(wt, 'feat/new')).toEqual({ ok: false, reason: 'not-detached' })
  })
})

describe('getHandoffPreview', () => {
  it('reports the file and line stat of what a handoff would carry', async () => {
    const repo = makeRepo()
    const wt = addWorktree(repo)
    writeFileSync(join(wt, 'README.md'), 'hello\nline two\n')
    writeFileSync(join(wt, 'new.txt'), 'a\nb\n')

    const preview = await getHandoffPreview(wt)

    expect(preview).toEqual({ files: 2, insertions: 3, deletions: 0 })
  })

  it('returns null when called on the main repo itself', async () => {
    const repo = makeRepo()

    expect(await getHandoffPreview(repo)).toBeNull()
  })
})

describe('carryUncommittedChanges', () => {
  it('copies staged, unstaged and untracked changes into the target, leaving the source intact', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'tracked.txt'), 'original\n')
    git(repo, 'add', 'tracked.txt')
    git(repo, 'commit', '-m', 'add tracked')
    const wt = addWorktree(repo)

    writeFileSync(join(repo, 'README.md'), 'hello\nstaged\n')
    git(repo, 'add', 'README.md')
    writeFileSync(join(repo, 'tracked.txt'), 'original\nunstaged\n')
    writeFileSync(join(repo, 'fresh.txt'), 'untracked\n')

    await carryUncommittedChanges(repo, wt)

    expect(readFileSync(join(wt, 'README.md'), 'utf8')).toContain('staged')
    expect(readFileSync(join(wt, 'tracked.txt'), 'utf8')).toContain('unstaged')
    expect(readFileSync(join(wt, 'fresh.txt'), 'utf8')).toContain('untracked')
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toContain('staged')
    expect(readFileSync(join(repo, 'fresh.txt'), 'utf8')).toContain('untracked')
    expect(git(repo, 'stash', 'list')).toBe('')
  })

  it('does nothing when the source has no uncommitted changes', async () => {
    const repo = makeRepo()
    const wt = addWorktree(repo)

    await carryUncommittedChanges(repo, wt)

    expect(git(wt, 'status', '--porcelain')).toBe('')
  })

  it('leaves a pre-existing stash untouched', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'README.md'), 'hello\nold work\n')
    git(repo, 'stash', 'push', '-m', 'user-stash')
    const wt = addWorktree(repo)
    writeFileSync(join(repo, 'fresh.txt'), 'carried\n')

    await carryUncommittedChanges(repo, wt)

    expect(readFileSync(join(wt, 'fresh.txt'), 'utf8')).toContain('carried')
    expect(git(repo, 'stash', 'list')).toContain('user-stash')
  })
})
