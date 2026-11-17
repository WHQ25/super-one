import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { worktreeGit } from '@superone/runtime/git'
import { directoryBytes, listManagedWorktrees, removeUnusedWorktrees, type WorktreeStorageContext } from './storage-worktrees'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

describe('worktree storage', () => {
  let home: string
  let repo: string
  let root: string
  let referenced: string[]
  let ctx: WorktreeStorageContext

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'superone-storage-wt-')))
    repo = join(home, 'repo')
    root = join(home, '.worktrees')
    mkdirSync(repo)
    git(repo, ['init', '-b', 'main'])
    git(repo, ['config', 'user.email', 't@example.com'])
    git(repo, ['config', 'user.name', 't'])
    writeFileSync(join(repo, 'README.md'), 'hello\n')
    git(repo, ['add', '.'])
    git(repo, ['commit', '-m', 'init'])
    referenced = [repo]
    ctx = { root, git: worktreeGit(), referencedPaths: () => referenced }
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  function addWorktree(name: string, ...args: string[]): string {
    const path = join(root, 'repo', name)
    mkdirSync(join(root, 'repo'), { recursive: true })
    git(repo, ['worktree', 'add', ...args, path, 'main'])
    return path
  }

  it('lists nothing when no worktree was ever created', async () => {
    expect(await listManagedWorktrees(ctx)).toEqual([])
  })

  it('reports size, branch, changes and whether a session still uses each worktree', async () => {
    const used = addWorktree('used', '--detach')
    const idle = addWorktree('idle', '-b', 'feat/idle')
    writeFileSync(join(idle, 'draft.txt'), 'x'.repeat(1000))
    referenced.push(join(used, 'packages'))

    const rows = await listManagedWorktrees(ctx)

    expect(rows.map((row) => row.path)).toEqual([idle, used])
    expect(rows[0]).toMatchObject({ repo: 'repo', branch: 'feat/idle', inUse: false, dirty: true })
    expect(rows[0]!.bytes).toBeGreaterThanOrEqual(1000)
    expect(rows[1]).toMatchObject({ repo: 'repo', branch: null, inUse: true, dirty: false })
  })

  it('does not count a linked directory as the worktree\'s own bytes', async () => {
    const shared = join(home, 'shared')
    mkdirSync(shared)
    writeFileSync(join(shared, 'big.bin'), 'x'.repeat(5000))
    const wt = addWorktree('linked', '--detach')
    const before = await directoryBytes(wt)
    symlinkSync(shared, join(wt, 'node_modules'))
    expect(await directoryBytes(wt)).toBe(before)
  })

  it('removes an unused worktree, keeps its branch, and drops the empty repository directory', async () => {
    const idle = addWorktree('idle', '-b', 'feat/idle')
    writeFileSync(join(idle, 'draft.txt'), 'draft\n')

    expect(await removeUnusedWorktrees(ctx, [idle])).toEqual({ removed: [idle], failed: [] })

    expect(existsSync(idle)).toBe(false)
    expect(existsSync(join(root, 'repo'))).toBe(false)
    expect(git(repo, ['branch', '--list', 'feat/idle'])).toContain('feat/idle')
    expect(git(repo, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)).toHaveLength(1)
  })

  it('refuses a worktree a session adopted after it was listed', async () => {
    const wt = addWorktree('adopted', '--detach')
    referenced.push(wt)

    const result = await removeUnusedWorktrees(ctx, [wt])

    expect(result.removed).toEqual([])
    expect(result.failed).toEqual([{ path: wt, error: 'Worktree is in use' }])
    expect(existsSync(join(wt, 'README.md'))).toBe(true)
  })

  it('refuses anything that is not a worktree directly under the managed root', async () => {
    const wt = addWorktree('kept', '--detach')
    const outside = join(home, 'elsewhere')
    mkdirSync(outside)
    const targets = [repo, outside, root, join(root, 'repo'), join(wt, '..', '..', '..', 'repo'), join(wt, '.git')]

    const result = await removeUnusedWorktrees(ctx, targets)

    expect(result.removed).toEqual([])
    expect(result.failed).toHaveLength(targets.length)
    expect(existsSync(join(repo, 'README.md'))).toBe(true)
    expect(existsSync(outside)).toBe(true)
    expect(existsSync(join(wt, 'README.md'))).toBe(true)
  })

  it('removes one worktree and keeps going when another fails', async () => {
    const gone = addWorktree('gone', '--detach')
    const kept = addWorktree('kept', '--detach')
    referenced.push(kept)

    const result = await removeUnusedWorktrees(ctx, [kept, gone])

    expect(result.removed).toEqual([gone])
    expect(result.failed.map((failure) => failure.path)).toEqual([kept])
    expect(existsSync(join(root, 'repo'))).toBe(true)
  })
})
