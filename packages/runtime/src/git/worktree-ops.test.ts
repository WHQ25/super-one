import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { gitRun, type GitRunOptions } from './run'
import { planNewWorktreePaths } from './worktree-plan'
import { GIT_READ_OPTS, activateWorktree, handoffPreview, handoffToMain, removeWorktree, rollbackCollabWorktree, worktreeGit } from './worktree-ops'

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

describe('worktree space settings', () => {
  let home: string
  let dir: string
  const realHome = process.env.HOME
  const g = worktreeGit()

  beforeEach(() => {
    // Worktrees land under `~/.worktrees`; keep them out of the real home.
    home = realpathSync(mkdtempSync(join(tmpdir(), 's1-wt-home-')))
    process.env.HOME = home
    dir = join(home, 'repo')
    mkdirSync(dir)
    git(dir, ['init', '-b', 'main'])
    git(dir, ['config', 'user.email', 't@example.com'])
    git(dir, ['config', 'user.name', 't'])
    for (const file of ['apps/a/a.txt', 'apps/b/b.txt', 'packages/p/p.txt', 'README.md']) {
      mkdirSync(join(dir, file, '..'), { recursive: true })
      writeFileSync(join(dir, file), `${file}\n`)
    }
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.superone/\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-m', 'init'])
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'node_modules', 'dep.js'), 'dep\n')
  })

  afterEach(() => {
    process.env.HOME = realHome
    rmSync(home, { recursive: true, force: true })
  })

  function configure(config: object): void {
    mkdirSync(join(dir, '.superone'), { recursive: true })
    writeFileSync(join(dir, '.superone', 'worktree.json'), JSON.stringify(config))
  }

  it('checks out everything and links nothing without settings', async () => {
    const { path } = await activateWorktree(g, dir, { baseBranch: 'main', mode: 'detach' })
    expect(existsSync(join(path, 'apps/b/b.txt'))).toBe(true)
    expect(existsSync(join(path, 'node_modules'))).toBe(false)
  })

  it('checks out only the configured directories, on the requested branch', async () => {
    configure({ sparsePaths: ['apps/a'] })
    const result = await activateWorktree(g, dir, { baseBranch: 'main', mode: 'branch', branchName: 'feat/sparse' })
    expect(existsSync(join(result.path, 'apps/a/a.txt'))).toBe(true)
    expect(existsSync(join(result.path, 'README.md'))).toBe(true)
    expect(existsSync(join(result.path, 'apps/b'))).toBe(false)
    expect(existsSync(join(result.path, 'packages'))).toBe(false)
    expect(git(result.path, ['symbolic-ref', '--short', 'HEAD']).trim()).toBe('feat/sparse')
    expect(git(result.path, ['status', '--porcelain']).trim()).toBe('')
    expect(result.recordedBranch).toBe('feat/sparse')
  })

  it('keeps a sparse detached worktree detached and clean', async () => {
    configure({ sparsePaths: ['packages/p'] })
    const { path } = await activateWorktree(g, dir, { baseBranch: 'main', mode: 'detach' })
    expect(existsSync(join(path, 'packages/p/p.txt'))).toBe(true)
    expect(existsSync(join(path, 'apps'))).toBe(false)
    expect(() => git(path, ['symbolic-ref', '-q', 'HEAD'])).toThrow()
    expect(git(path, ['status', '--porcelain']).trim()).toBe('')
  })

  it('removes the worktree and its new branch when the sparse checkout fails', async () => {
    configure({ sparsePaths: ['apps/a'] })
    const failing: typeof gitRun = (cwd, args, env, opts) =>
      args[0] === 'checkout' ? Promise.reject(new Error('checkout failed')) : gitRun(cwd, args, env, opts)
    await expect(
      activateWorktree(worktreeGit(failing), dir, { baseBranch: 'main', mode: 'branch', branchName: 'feat/broken' }),
    ).rejects.toThrow('checkout failed')
    expect(git(dir, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)).toHaveLength(1)
    expect(git(dir, ['branch', '--list', 'feat/broken']).trim()).toBe('')
  })

  it('links an ignored path from the main checkout and keeps the link out of git status', async () => {
    configure({ sharedPaths: ['node_modules', 'apps/a', 'missing'] })
    const { path } = await activateWorktree(g, dir, { baseBranch: 'main', mode: 'detach' })
    expect(lstatSync(join(path, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(path, 'node_modules', 'dep.js'), 'utf8')).toBe('dep\n')
    // A tracked path stays a real checkout; a missing one is skipped.
    expect(lstatSync(join(path, 'apps/a')).isSymbolicLink()).toBe(false)
    expect(existsSync(join(path, 'missing'))).toBe(false)
    expect(git(path, ['status', '--porcelain']).trim()).toBe('')
    expect(git(dir, ['status', '--porcelain']).trim()).toBe('')

    // A second worktree does not repeat the exclude rule.
    await activateWorktree(g, dir, { baseBranch: 'main', mode: 'detach' })
    const exclude = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude.split('\n').filter((line) => line === '/node_modules')).toHaveLength(1)
  })

  it('removes an unused worktree without touching the shared directory or its branch', async () => {
    configure({ sharedPaths: ['node_modules'] })
    const { path } = await activateWorktree(g, dir, { baseBranch: 'main', mode: 'branch', branchName: 'feat/keep' })
    writeFileSync(join(path, 'scratch.txt'), 'uncommitted\n')

    await removeWorktree(g, path)

    expect(existsSync(path)).toBe(false)
    expect(existsSync(join(dir, 'node_modules', 'dep.js'))).toBe(true)
    expect(git(dir, ['branch', '--list', 'feat/keep']).trim()).toContain('feat/keep')
    expect(git(dir, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)).toHaveLength(1)
  })

  it('deletes a leftover directory git no longer tracks and refuses the main checkout', async () => {
    const { path } = await activateWorktree(g, dir, { baseBranch: 'main', mode: 'detach' })
    rmSync(join(path, '.git'))
    await removeWorktree(g, path)
    expect(existsSync(path)).toBe(false)

    await expect(removeWorktree(g, dir)).rejects.toThrow(/main checkout/)
    expect(existsSync(join(dir, 'README.md'))).toBe(true)
  })
})
