import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { applyIncomingBranch, branchRelations, exportBranchBundle, readBranchTips, readBundleHaves } from './branch-bundle'
import { worktreeGit } from './worktree-ops'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function commit(cwd: string, file: string, body: string): string {
  writeFileSync(join(cwd, file), body)
  git(cwd, ['add', '.'])
  git(cwd, ['commit', '-qm', `${file}: ${body}`])
  return git(cwd, ['rev-parse', 'HEAD'])
}

describe('branch bundle', () => {
  const g = worktreeGit()
  const trash: string[] = []
  let source: string
  let local: string

  function repo(name: string): string {
    const dir = mkdtempSync(join(tmpdir(), `s1-bundle-${name}-`))
    trash.push(dir)
    return dir
  }

  beforeEach(() => {
    source = repo('source')
    git(source, ['init', '-qb', 'main'])
    git(source, ['config', 'user.email', 't@example.com'])
    git(source, ['config', 'user.name', 't'])
    commit(source, 'README.md', 'hi\n')
    // The local clone shares main, as two clones of one origin would.
    local = repo('local')
    git(local, ['clone', '-q', source, '.'])
    git(local, ['config', 'user.email', 't@example.com'])
    git(local, ['config', 'user.name', 't'])
    git(source, ['switch', '-qc', 'feat/x'])
  })

  afterEach(() => {
    while (trash.length) rmSync(trash.pop()!, { recursive: true, force: true })
  })

  async function sync(opts: { includeWorkingTree?: boolean; onDiverged?: 'stop' | 'overwrite'; targetBranch?: string; branch?: string } = {}) {
    const exported = await exportBranchBundle(g, source, {
      haves: await readBundleHaves(g, local),
      includeWorkingTree: opts.includeWorkingTree ?? false,
      ...(opts.branch ? { branch: opts.branch } : {}),
    })
    if (!exported.ok) throw new Error(exported.reason)
    if (exported.bundlePath) trash.push(join(exported.bundlePath, '..'))
    const result = await applyIncomingBranch(g, local, {
      ...exported,
      localName: opts.targetBranch ?? exported.branch,
      createOnly: !!opts.targetBranch,
      onDiverged: opts.onDiverged,
    })
    return { exported, result }
  }

  it('creates the local branch from an incremental bundle', async () => {
    const head = commit(source, 'a.txt', 'one\n')
    const { exported, result } = await sync()
    expect(exported).toMatchObject({ branch: 'feat/x', head, snapshot: null })
    expect(exported.ok && exported.bundlePath).toBeTruthy()
    // Prerequisites are commits the receiver offered: main is not re-sent.
    const prereqs = git(local, ['bundle', 'verify', (exported as { bundlePath: string }).bundlePath])
    expect(prereqs).toContain('requires')
    expect(result).toEqual({ ok: true, branch: 'feat/x', head, status: 'created', snapshot: false })
    expect(git(local, ['rev-parse', 'refs/heads/feat/x'])).toBe(head)
  })

  it('needs no bundle when the receiver already has the tip', async () => {
    const head = commit(source, 'a.txt', 'one\n')
    await sync()
    const { exported, result } = await sync()
    expect(exported).toMatchObject({ ok: true, bundlePath: null, head })
    expect(result).toMatchObject({ ok: true, status: 'unchanged' })
  })

  it('carries uncommitted work as a WIP commit without touching the source checkout', async () => {
    const head = commit(source, 'a.txt', 'one\n')
    writeFileSync(join(source, 'a.txt'), 'two\n')
    writeFileSync(join(source, 'new.txt'), 'untracked\n')
    const statusBefore = git(source, ['status', '--porcelain'])
    const { exported, result } = await sync({ includeWorkingTree: true })
    expect(exported.ok && exported.snapshot).toBeTruthy()
    expect(git(source, ['status', '--porcelain'])).toBe(statusBefore)
    expect(git(source, ['rev-parse', 'HEAD'])).toBe(head)
    expect(git(source, ['for-each-ref', 'refs/superone'])).toBe('')
    expect(result).toMatchObject({ ok: true, status: 'created', snapshot: true })
    expect(git(local, ['rev-parse', 'feat/x^'])).toBe(head)
    expect(git(local, ['show', 'feat/x:new.txt'])).toBe('untracked')

    // The next sync replaces the stale snapshot instead of reporting divergence.
    git(source, ['add', '.'])
    git(source, ['commit', '-qm', 'finish'])
    const next = await sync()
    expect(next.result).toMatchObject({ ok: true, status: 'updated', snapshot: false })
    expect(git(local, ['rev-parse', 'feat/x'])).toBe(git(source, ['rev-parse', 'HEAD']))
  })

  it('stops on a diverged local branch, then overwrites keeping a backup', async () => {
    commit(source, 'a.txt', 'one\n')
    await sync()
    git(local, ['switch', '-q', 'feat/x'])
    const localTip = commit(local, 'local.txt', 'mine\n')
    git(local, ['switch', '-q', 'main'])
    const remoteTip = commit(source, 'b.txt', 'two\n')

    expect((await sync()).result).toEqual({ ok: false, reason: 'diverged', branch: 'feat/x' })
    expect(git(local, ['rev-parse', 'feat/x'])).toBe(localTip)

    const { result } = await sync({ onDiverged: 'overwrite' })
    const backup = `superone-backup/feat/x/${localTip.slice(0, 7)}`
    expect(result).toMatchObject({ ok: true, status: 'updated', backupBranch: backup })
    expect(git(local, ['rev-parse', 'feat/x'])).toBe(remoteTip)
    expect(git(local, ['rev-parse', backup])).toBe(localTip)
  })

  it('saves under another name and refuses an existing one', async () => {
    const head = commit(source, 'a.txt', 'one\n')
    git(local, ['branch', 'taken'])
    expect((await sync({ targetBranch: 'taken' })).result).toEqual({ ok: false, reason: 'exists', branch: 'taken' })
    expect((await sync({ targetBranch: 'feat/x-remote' })).result).toMatchObject({ ok: true, branch: 'feat/x-remote', head })
  })

  it('moves a checked-out local branch with its files', async () => {
    commit(source, 'a.txt', 'one\n')
    await sync()
    git(local, ['switch', '-q', 'feat/x'])
    commit(source, 'a.txt', 'two\n')
    expect((await sync()).result).toMatchObject({ ok: true, status: 'updated' })
    expect(readFileSync(join(local, 'a.txt'), 'utf8')).toBe('two\n')
    expect(git(local, ['status', '--porcelain'])).toBe('')
  })

  it('reports a detached source checkout', async () => {
    git(source, ['switch', '-q', '--detach'])
    expect(await exportBranchBundle(g, source, { haves: [], includeWorkingTree: false })).toEqual({ ok: false, reason: 'detached' })
  })

  it('removes the bundle directory when bundling fails', async () => {
    commit(source, 'a.txt', 'one\n')
    const failing = { ...g, write: async (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => {
      if (args[0] === 'bundle') throw new Error('boom')
      return g.write(cwd, args, env)
    } }
    const bundleDirs = () => readdirSync(tmpdir()).filter((name) => name.startsWith('superone-bundle-')).sort()
    const before = bundleDirs()
    const result = await exportBranchBundle(failing, source, { haves: [], includeWorkingTree: false })
    expect(result).toMatchObject({ ok: false, reason: 'error' })
    expect(bundleDirs()).toEqual(before)
  })

  it('exports a named branch that is not checked out, without a snapshot', async () => {
    const head = commit(source, 'a.txt', 'one\n')
    git(source, ['switch', '-q', 'main'])
    writeFileSync(join(source, 'dirty.txt'), 'x\n')
    const { exported, result } = await sync({ branch: 'feat/x', includeWorkingTree: true })
    expect(exported).toMatchObject({ ok: true, branch: 'feat/x', head, snapshot: null })
    expect(result).toMatchObject({ ok: true, status: 'created' })
    expect(await exportBranchBundle(g, source, { haves: [], includeWorkingTree: false, branch: 'nope' }))
      .toMatchObject({ ok: false, reason: 'error' })
  })

  it('lists branch tips with the worktree that has each', async () => {
    const head = commit(source, 'a.txt', 'one\n')
    const tips = await readBranchTips(g, source)
    expect(tips.find((tip) => tip.name === 'feat/x')).toMatchObject({ head })
    expect(tips.find((tip) => tip.name === 'feat/x')?.worktreePath).toBeTruthy()
    expect(tips.find((tip) => tip.name === 'main')?.worktreePath).toBeUndefined()
  })

  it('classifies incoming tips against local branches', async () => {
    const base = git(local, ['rev-parse', 'main'])
    const ahead = commit(source, 'a.txt', 'one\n')
    await sync()
    const newer = commit(source, 'a.txt', 'two\n')
    await exportBranchBundle(g, source, { haves: [], includeWorkingTree: false }).then(async (e) => {
      if (e.ok && e.bundlePath) {
        trash.push(join(e.bundlePath, '..'))
        git(local, ['bundle', 'unbundle', e.bundlePath])
      }
    })
    const relations = await branchRelations(g, local, [
      { localName: 'brand-new', head: ahead },
      { localName: 'feat/x', head: ahead },
      { localName: 'feat/x', head: newer },
      { localName: 'main', head: base },
      { localName: 'feat/x', head: base },
      { localName: 'feat/x', head: 'f'.repeat(40) },
    ])
    expect(relations).toEqual([
      { relation: 'new' },
      { relation: 'same' },
      { relation: 'behind', behind: 1 },
      { relation: 'same' },
      { relation: 'ahead', ahead: 1 },
      { relation: 'update' },
    ])
  })
})
