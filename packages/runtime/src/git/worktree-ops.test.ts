import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { gitRun, type GitRunOptions } from './run'
import { planNewWorktreePaths } from './worktree-plan'
import { activateWorktree, GIT_READ_OPTS, handoffPreview, handoffToMain, rollbackCollabWorktree, worktreeGit } from './worktree-ops'

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
    rmSync(join(homedir(), '.worktrees', basename(dir)), { recursive: true, force: true })
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

  describe('recreate-clean', () => {
    const branchName = 'superone/agent-11111111-1111-4111-8111-111111111111'
    const input = {
      baseBranch: 'main',
      mode: 'branch' as const,
      branchName,
      ifExists: 'recreate-clean' as const,
    }

    it('reuses a clean checkout that already matches the base', async () => {
      const g = worktreeGit()
      const first = await activateWorktree(g, dir, input)
      const second = await activateWorktree(g, dir, input)
      expect(second.path).toBe(first.path)
      expect(git(second.path, ['status', '--porcelain'])).toBe('')
      expect(git(second.path, ['rev-parse', 'HEAD'])).toBe(git(dir, ['rev-parse', 'HEAD']))
    })

    it('rebuilds a dirty checkout clean at the base', async () => {
      const g = worktreeGit()
      const first = await activateWorktree(g, dir, input)
      writeFileSync(join(first.path, 'dirty.txt'), 'x\n')
      const second = await activateWorktree(g, dir, input)
      expect(git(second.path, ['status', '--porcelain'])).toBe('')
      expect(existsSync(join(second.path, 'dirty.txt'))).toBe(false)
      expect(git(second.path, ['rev-parse', 'HEAD'])).toBe(git(dir, ['rev-parse', 'HEAD']))
    })

    it('resets a checkout whose HEAD is behind the base', async () => {
      const g = worktreeGit()
      const first = await activateWorktree(g, dir, input)
      const stale = git(first.path, ['rev-parse', 'HEAD'])
      writeFileSync(join(dir, 'next.txt'), 'n\n')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-m', 'move'])
      const second = await activateWorktree(g, dir, input)
      expect(git(second.path, ['rev-parse', 'HEAD'])).toBe(git(dir, ['rev-parse', 'HEAD']))
      expect(git(second.path, ['rev-parse', 'HEAD'])).not.toBe(stale)
      expect(git(second.path, ['status', '--porcelain'])).toBe('')
    })

    it('refuses to rebuild a checkout a session still occupies', async () => {
      const g = worktreeGit()
      const first = await activateWorktree(g, dir, input)
      await expect(activateWorktree(g, dir, { ...input, isOccupied: () => true }))
        .rejects.toMatchObject({ code: 'failed_precondition' })
      expect(existsSync(first.path)).toBe(true)
      expect(git(first.path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe(branchName)
    })

    it('force-updates a branch that exists and is not checked out', async () => {
      git(dir, ['branch', branchName])
      writeFileSync(join(dir, 'next.txt'), 'n\n')
      git(dir, ['add', '.'])
      git(dir, ['commit', '-m', 'move'])
      const created = await activateWorktree(worktreeGit(), dir, input)
      expect(git(created.path, ['rev-parse', 'HEAD'])).toBe(git(dir, ['rev-parse', 'HEAD']))
      expect(git(created.path, ['symbolic-ref', 'HEAD']).trim()).toBe(`refs/heads/${branchName}`)
    })

    it('rebuilds a checkout whose git file was never written', async () => {
      const g = worktreeGit()
      const first = await activateWorktree(g, dir, input)
      rmSync(join(first.path, '.git'))
      const second = await activateWorktree(g, dir, input)
      expect(git(second.path, ['status', '--porcelain'])).toBe('')
      expect(git(second.path, ['rev-parse', 'HEAD'])).toBe(git(dir, ['rev-parse', 'HEAD']))
      expect(git(second.path, ['symbolic-ref', 'HEAD']).trim()).toBe(`refs/heads/${branchName}`)
      expect(existsSync(join(second.path, '.git'))).toBe(true)
      if (second.path !== first.path) expect(existsSync(first.path)).toBe(false)
    })

    it('refuses a checkout whose git file is missing while a session still occupies it', async () => {
      const g = worktreeGit()
      const first = await activateWorktree(g, dir, input)
      rmSync(join(first.path, '.git'))
      let saw = false
      await expect(activateWorktree(g, dir, {
        ...input,
        isOccupied: (path) => {
          if (path === first.path) saw = true
          return path === first.path
        },
      })).rejects.toMatchObject({ code: 'failed_precondition' })
      expect(saw).toBe(true)
      expect(existsSync(first.path)).toBe(true)
      expect(existsSync(join(first.path, '.git'))).toBe(false)
    })
  })

  describe('rollbackCollabWorktree', () => {
    const branchName = 'superone/agent-22222222-2222-4222-8222-222222222222'

    it('removes an unoccupied checkout and its branch, and refuses one that is in use or the project', async () => {
      const g = worktreeGit()
      const created = await activateWorktree(g, dir, {
        baseBranch: 'main',
        mode: 'branch',
        branchName,
        ifExists: 'recreate-clean',
      })
      await rollbackCollabWorktree(g, dir, { path: created.path, branchName, isOccupied: () => false })
      expect(existsSync(created.path)).toBe(false)
      expect(() => git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`])).toThrow()

      const again = await activateWorktree(g, dir, {
        baseBranch: 'main',
        mode: 'branch',
        branchName,
        ifExists: 'recreate-clean',
      })
      await expect(rollbackCollabWorktree(g, dir, { path: again.path, branchName, isOccupied: () => true }))
        .rejects.toMatchObject({ code: 'failed_precondition' })
      expect(existsSync(again.path)).toBe(true)
      await expect(rollbackCollabWorktree(g, dir, { path: dir, branchName: 'main', isOccupied: () => false }))
        .rejects.toMatchObject({ code: 'failed_precondition' })
      expect(existsSync(join(dir, 'README.md'))).toBe(true)
    })

    it('removes a locked checkout and its branch', async () => {
      const g = worktreeGit()
      const created = await activateWorktree(g, dir, {
        baseBranch: 'main',
        mode: 'branch',
        branchName,
        ifExists: 'recreate-clean',
      })
      git(dir, ['worktree', 'lock', created.path])
      await rollbackCollabWorktree(g, dir, { path: created.path, branchName, isOccupied: () => false })
      expect(existsSync(created.path)).toBe(false)
      expect(() => git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`])).toThrow()
    })

    it('removes an unregistered leftover under the managed worktree directory', async () => {
      const g = worktreeGit()
      const created = await activateWorktree(g, dir, {
        baseBranch: 'main',
        mode: 'branch',
        branchName,
        ifExists: 'recreate-clean',
      })
      rmSync(join(created.path, '.git'))
      git(dir, ['worktree', 'prune'])
      expect(git(dir, ['worktree', 'list', '--porcelain'])).not.toContain(created.path)
      expect(existsSync(created.path)).toBe(true)
      await rollbackCollabWorktree(g, dir, { path: created.path, branchName, isOccupied: () => false })
      expect(existsSync(created.path)).toBe(false)
    })

    it('does not delete a path this repo does not own', async () => {
      const g = worktreeGit()
      const created = await activateWorktree(g, dir, {
        baseBranch: 'main',
        mode: 'branch',
        branchName,
        ifExists: 'recreate-clean',
      })
      mkdirSync(join(dir, 'src'))
      writeFileSync(join(dir, 'src', 'keep.txt'), 'k\n')
      await expect(rollbackCollabWorktree(g, dir, { path: join(dir, 'src'), branchName, isOccupied: () => false }))
        .rejects.toMatchObject({ code: 'failed_precondition' })
      expect(existsSync(join(dir, 'src', 'keep.txt'))).toBe(true)

      const outside = mkdtempSync(join(tmpdir(), 's1-wt-secret-'))
      trash.push(outside)
      writeFileSync(join(outside, 'secret'), 'x\n')
      await expect(rollbackCollabWorktree(g, dir, { path: outside, branchName, isOccupied: () => false }))
        .rejects.toMatchObject({ code: 'failed_precondition' })
      expect(existsSync(join(outside, 'secret'))).toBe(true)

      const wtDir = planNewWorktreePaths({ mainDir: dir, shortHash: '0' }).wtDir
      mkdirSync(wtDir, { recursive: true })
      const link = join(wtDir, 'escape')
      symlinkSync(outside, link)
      await expect(rollbackCollabWorktree(g, dir, { path: link, branchName, isOccupied: () => false }))
        .rejects.toMatchObject({ code: 'failed_precondition' })
      expect(existsSync(link)).toBe(true)
      expect(existsSync(join(outside, 'secret'))).toBe(true)

      await expect(rollbackCollabWorktree(g, created.path, { path: created.path, branchName, isOccupied: () => false }))
        .rejects.toMatchObject({ code: 'failed_precondition' })
      expect(existsSync(join(created.path, '.git'))).toBe(true)
      expect(existsSync(join(dir, 'README.md'))).toBe(true)
    })
  })
})
