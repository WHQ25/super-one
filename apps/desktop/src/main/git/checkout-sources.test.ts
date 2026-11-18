import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { applyIncomingBranch, branchRelations, exportBranchBundle, gitRun, presentCommits, readAncestryPage, readBranchTips, readBundleHaves, worktreeGit } from '@superone/runtime/git'
import type { CheckoutProgressPhase, CheckoutSource } from '@superone/shared/agent-types'
import {
  checkoutFromSource,
  checkoutSourcesInfo,
  listSourceBranches,
  localBranchSources,
  type CheckoutSourceDeps,
} from './checkout-sources'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function commit(cwd: string, file: string, body: string): string {
  writeFileSync(join(cwd, file), body)
  git(cwd, ['add', '.'])
  git(cwd, ['commit', '-qm', `${file}: ${body}`])
  return git(cwd, ['rev-parse', 'HEAD'])
}

describe('checkout sources', () => {
  const g = worktreeGit(gitRun)
  const trash: string[] = []
  let origin: string
  let local: string
  let node: string
  /** A second node checkout, reached as `remote:lab:/work/app`, that receives branches. */
  let lab: string
  let pulls: unknown[]
  const LAB = 'remote:lab:/work/app'
  const NODE: CheckoutSource = { kind: 'node', connectionId: 'office', folderPath: 'remote:office:/work/app' }

  function dir(name: string): string {
    const path = mkdtempSync(join(tmpdir(), `s1-sources-${name}-`))
    trash.push(path)
    return path
  }

  function clone(name: string): string {
    const path = dir(name)
    git(path, ['clone', '-q', origin, '.'])
    git(path, ['config', 'user.email', 't@example.com'])
    git(path, ['config', 'user.name', 't'])
    return path
  }

  const deps: CheckoutSourceDeps = {
    git: g,
    gh: async () => JSON.stringify(pulls),
    github: async () => true,
    node: {
      // As the node's service does: checkouts that have a branch report their uncommitted work.
      branchTips: async () => ({
        ok: true,
        branches: (await readBranchTips(g, node)).map((tip) => {
          const files = tip.worktreePath ? git(tip.worktreePath, ['status', '--porcelain']).split('\n').filter(Boolean).length : 0
          return files ? { ...tip, dirty: { files, insertions: 1, deletions: 1 } } : tip
        }),
      }),
      withBundle: async (input, use, control) => {
        control?.onProgress?.('bundling')
        const exported = await exportBranchBundle(g, node, input)
        if (!exported.ok) return { ok: false, reason: exported.reason }
        if (exported.bundlePath) {
          trash.push(join(exported.bundlePath, '..'))
          control?.onProgress?.('downloading', exported.size, exported.size)
        }
        return use(exported)
      },
      // The lab node as a target, as its service would answer.
      haves: async (folderPath) => { expect(folderPath).toBe(LAB); return readBundleHaves(g, lab) },
      revList: async (folderPath, branch, skip, maxCount) => {
        expect(folderPath).toBe(NODE.folderPath)
        return readAncestryPage(g, node, branch, skip, maxCount)
      },
      present: async (folderPath, commits) => {
        expect(folderPath).toBe(LAB)
        return presentCommits(g, lab, commits)
      },
      relations: async (_folderPath, items) => branchRelations(g, lab, items),
      land: async (_folderPath, incoming, control) => {
        if (incoming.bundlePath) control?.onProgress?.('uploading', 1, 1)
        control?.onProgress?.('applying')
        return applyIncomingBranch(g, lab, incoming)
      },
    },
  }

  beforeEach(() => {
    const seed = dir('seed')
    git(seed, ['init', '-qb', 'main'])
    git(seed, ['config', 'user.email', 't@example.com'])
    git(seed, ['config', 'user.name', 't'])
    commit(seed, 'README.md', 'hi\n')
    origin = dir('origin')
    git(origin, ['clone', '-q', '--bare', seed, '.'])
    local = clone('local')
    node = clone('node')
    lab = clone('lab')
    pulls = []
  })

  afterEach(() => {
    while (trash.length) rmSync(trash.pop()!, { recursive: true, force: true })
  })

  it('reports git remotes and pull request availability', async () => {
    expect(await checkoutSourcesInfo(deps, local)).toEqual({ remotes: [{ name: 'origin', url: origin }], github: true })
  })

  it('lists node branches with their worktree state and checks one out with its WIP', async () => {
    git(node, ['switch', '-qc', 'feat/x'])
    const head = commit(node, 'a.txt', 'one\n')
    writeFileSync(join(node, 'a.txt'), 'wip\n')

    const listed = await listSourceBranches(deps, local, NODE)
    expect(listed.ok && listed.branches.find((b) => b.ref === 'feat/x')).toMatchObject({
      head, localName: 'feat/x', relation: 'new', checkedOut: true, dirty: { files: 1 },
    })

    const result = await checkoutFromSource(deps, {
      folderPath: local, source: NODE, branch: { ref: 'feat/x', head }, localName: 'feat/x', includeWorkingTree: true,
    })
    expect(result).toMatchObject({ ok: true, branch: 'feat/x', status: 'created', snapshot: true })
    expect(git(local, ['show', 'feat/x:a.txt'])).toBe('wip')

    // The branch remembers its node and shows the node's next commits.
    git(node, ['checkout', '-q', '--', 'a.txt'])
    const next = commit(node, 'a.txt', 'two\n')
    const sources = await localBranchSources(deps, local)
    expect(sources['feat/x']).toMatchObject({ source: NODE, ref: 'feat/x', head: next, relation: 'update' })

    const synced = await checkoutFromSource(deps, {
      folderPath: local, source: NODE, branch: { ref: 'feat/x', head: next }, localName: 'feat/x',
    })
    // The stale WIP snapshot is replaced, not reported as divergence.
    expect(synced).toMatchObject({ ok: true, status: 'updated', snapshot: false })
    expect((await localBranchSources(deps, local))['feat/x']).toMatchObject({ relation: 'same' })
  })

  it('fetches remote branches and tracks the checked-out one upstream', async () => {
    git(node, ['switch', '-qc', 'release/2.4'])
    const head = commit(node, 'r.txt', 'r\n')
    git(node, ['push', '-q', 'origin', 'release/2.4'])

    const listed = await listSourceBranches(deps, local, { kind: 'remote', remote: 'origin' }, { fetch: true })
    expect(listed.ok && listed.branches.map((b) => [b.ref, b.relation])).toEqual(expect.arrayContaining([
      ['release/2.4', 'new'], ['main', 'same'],
    ]))
    expect(listed.ok && listed.branches.some((b) => b.ref === 'HEAD')).toBe(false)

    const result = await checkoutFromSource(deps, {
      folderPath: local, source: { kind: 'remote', remote: 'origin' }, branch: { ref: 'release/2.4', head }, localName: 'release/2.4',
    })
    expect(result).toMatchObject({ ok: true, status: 'created' })
    expect(git(local, ['rev-parse', '--abbrev-ref', 'release/2.4@{upstream}'])).toBe('origin/release/2.4')

    commit(node, 'r.txt', 'r2\n')
    git(node, ['push', '-q', 'origin', 'release/2.4'])
    git(local, ['fetch', '-q', 'origin'])
    expect((await localBranchSources(deps, local))['release/2.4']).toMatchObject({
      source: { kind: 'remote', remote: 'origin' }, ref: 'release/2.4', relation: 'behind', behind: 1,
    })
  })

  it('checks out a fork pull request under its own name', async () => {
    git(node, ['switch', '-qc', 'fix'])
    const head = commit(node, 'f.txt', 'f\n')
    git(node, ['push', '-q', 'origin', 'HEAD:refs/pull/7/head'])
    pulls = [{ number: 7, title: 'Fix it', headRefName: 'fix', headRefOid: head, isCrossRepository: true, author: { login: 'someone' } }]

    const listed = await listSourceBranches(deps, local, { kind: 'pr' })
    expect(listed.ok && listed.branches[0]).toMatchObject({
      ref: '7', title: '#7 Fix it', detail: 'someone', localName: 'pr/7-fix', relation: 'new', fork: true,
    })

    const result = await checkoutFromSource(deps, {
      folderPath: local, source: { kind: 'pr' }, branch: { ref: '7', head }, localName: 'pr/7-fix',
    })
    expect(result).toMatchObject({ ok: true, branch: 'pr/7-fix', head })
    expect((await localBranchSources(deps, local))['pr/7-fix']).toEqual({ source: { kind: 'pr' }, ref: '7' })
  })

  it('refuses flag-like remotes and pull request refs', async () => {
    expect(await listSourceBranches(deps, local, { kind: 'remote', remote: '--upload-pack=x' })).toMatchObject({ ok: false })
    expect(await checkoutFromSource(deps, {
      folderPath: local, source: { kind: 'pr' }, branch: { ref: '1 --x', head: 'a'.repeat(40) }, localName: 'x',
    })).toMatchObject({ ok: false, reason: 'error' })
  })

  it('lists a git remote as last fetched unless asked to fetch', async () => {
    git(node, ['switch', '-qc', 'later'])
    const head = commit(node, 'l.txt', 'l\n')
    git(node, ['push', '-q', 'origin', 'later'])

    const cached = await listSourceBranches(deps, local, { kind: 'remote', remote: 'origin' })
    expect(cached.ok && cached.branches.some((b) => b.ref === 'later')).toBe(false)
    const fetched = await listSourceBranches(deps, local, { kind: 'remote', remote: 'origin' }, { fetch: true })
    expect(fetched.ok && fetched.branches.find((b) => b.ref === 'later')).toMatchObject({ head })
    expect(fetched.ok && fetched.fetchedAt).toBeGreaterThan(Date.now() - 60_000)
  })

  it('sends a branch from this computer to a node checkout', async () => {
    git(local, ['switch', '-qc', 'feat/local'])
    const head = commit(local, 'l.txt', 'mine\n')
    writeFileSync(join(local, 'l.txt'), 'wip\n')
    const THIS_PC: CheckoutSource = { kind: 'node', connectionId: 'local', folderPath: local }

    const listed = await listSourceBranches(deps, LAB, THIS_PC)
    expect(listed.ok && listed.branches.find((b) => b.ref === 'feat/local')).toMatchObject({ head, relation: 'new', dirty: { files: 1 } })

    const phases: CheckoutProgressPhase[] = []
    const result = await checkoutFromSource(deps, {
      folderPath: LAB, source: THIS_PC, branch: { ref: 'feat/local', head }, localName: 'feat/local', includeWorkingTree: true,
    }, { onProgress: (phase) => phases.push(phase) })
    expect(result).toMatchObject({ ok: true, status: 'created', snapshot: true })
    expect(git(lab, ['show', 'feat/local:l.txt'])).toBe('wip')
    expect(phases).toEqual(['bundling', 'uploading', 'applying'])
    // A node target keeps no source record, and this computer is untouched.
    expect(() => git(lab, ['config', '--get-regexp', 'superonesource'])).toThrow()
    expect(git(local, ['status', '--porcelain'])).toBe('M l.txt')
    expect(await listSourceBranches(deps, LAB, { kind: 'remote', remote: 'origin' })).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('relays a branch from one node to another', async () => {
    git(node, ['switch', '-qc', 'feat/relay'])
    const head = commit(node, 'r.txt', 'relay\n')
    const phases: CheckoutProgressPhase[] = []
    const result = await checkoutFromSource(deps, {
      folderPath: LAB, source: NODE, branch: { ref: 'feat/relay', head }, localName: 'feat/relay',
    }, { onProgress: (phase) => phases.push(phase) })
    expect(result).toMatchObject({ ok: true, branch: 'feat/relay', head })
    expect(git(lab, ['rev-parse', 'feat/relay'])).toBe(head)
    expect(phases).toEqual(['bundling', 'downloading', 'uploading', 'applying'])
  })

  it('stops before the target changes when cancelled', async () => {
    git(node, ['switch', '-qc', 'feat/cancel'])
    const head = commit(node, 'c.txt', 'c\n')
    const abort = new AbortController()
    const result = await checkoutFromSource(deps, {
      folderPath: local, source: NODE, branch: { ref: 'feat/cancel', head }, localName: 'feat/cancel',
    }, { signal: abort.signal, onProgress: (phase) => { if (phase === 'downloading') abort.abort() } })
    expect(result).toEqual({ ok: false, reason: 'cancelled' })
    expect(() => git(local, ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/cancel'])).toThrow()
  })

  it('bundles against the ancestor when this checkout has moved ahead of the node', async () => {
    const base = git(node, ['rev-parse', 'main'])
    const ahead = commit(local, 'ahead.txt', '1\n')
    git(local, ['update-ref', 'refs/remotes/origin/main', ahead])
    git(node, ['switch', '-qc', 'feat/x'])
    const head = commit(node, 'a.txt', 'one\n')
    let haves: string[] = []
    const bundled = deps.node.withBundle
    deps.node.withBundle = async (input, use, control) => {
      haves = input.haves
      return bundled(input, use, control)
    }
    try {
      const result = await checkoutFromSource(deps, {
        folderPath: local, source: NODE, branch: { ref: 'feat/x', head }, localName: 'feat/x',
      })
      expect(result).toMatchObject({ ok: true, status: 'created', head })
      expect(haves).toEqual([base])
    } finally {
      deps.node.withBundle = bundled
    }
  })

  it('refuses a checkout as its own source', async () => {
    expect(await listSourceBranches(deps, LAB, { kind: 'node', connectionId: 'lab', folderPath: LAB })).toMatchObject({ ok: false, reason: 'error' })
  })
})

