import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { WorkspaceGitService } from './git-service'
import type { WorkspaceProjects } from './workspace-projects'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

describe('WorkspaceGitService checkout-source methods', () => {
  const trash: string[] = []
  let root: string
  let worktree: string
  let svc: WorkspaceGitService

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 's1-svc-source-'))
    trash.push(root)
    git(root, ['init', '-qb', 'main'])
    git(root, ['config', 'user.email', 't@example.com'])
    git(root, ['config', 'user.name', 't'])
    writeFileSync(join(root, 'a.txt'), 'one\n')
    git(root, ['add', '.'])
    git(root, ['commit', '-qm', 'init'])
    worktree = mkdtempSync(join(tmpdir(), 's1-svc-source-wt-'))
    trash.push(worktree)
    rmSync(worktree, { recursive: true })
    git(root, ['worktree', 'add', '-qb', 'feat/x', worktree])
    writeFileSync(join(worktree, 'a.txt'), 'two\n')
    svc = new WorkspaceGitService({
      get: () => ({ projectId: 'p1', path: root, name: 'repo', repoIdentity: null }),
      touch: () => {},
    } as unknown as WorkspaceProjects)
  })

  afterEach(() => {
    while (trash.length) rmSync(trash.pop()!, { recursive: true, force: true })
  })

  it('reports each branch tip with its checkout and that checkout\'s uncommitted work', async () => {
    const { branches } = await svc.branchTips('p1')
    expect(branches.find((tip) => tip.name === 'feat/x')).toMatchObject({
      dirty: { files: 1, insertions: 1, deletions: 1 },
    })
    expect(branches.find((tip) => tip.name === 'main')?.dirty).toBeUndefined()
  })

  it('bundles a named branch from the worktree that has it, carrying its WIP', async () => {
    const result = await svc.exportBundle('p1', { branch: 'feat/x', haves: [], includeWorkingTree: true })
    expect(result).toMatchObject({ ok: true, branch: 'feat/x' })
    if (result.ok && result.bundlePath) trash.push(join(result.bundlePath, '..'))
    expect(result.ok && result.snapshot).toBeTruthy()
    expect(git(worktree, ['status', '--porcelain'])).toBe('M a.txt')
  })

  it('receives a bundle in chunks and lands it as a branch, then drops the upload', async () => {
    const other = mkdtempSync(join(tmpdir(), 's1-svc-source-other-'))
    trash.push(other)
    git(other, ['clone', '-q', root, '.'])
    git(other, ['config', 'user.email', 't@example.com'])
    git(other, ['config', 'user.name', 't'])
    git(other, ['switch', '-qc', 'feat/sent'])
    writeFileSync(join(other, 'b.txt'), 'b\n')
    git(other, ['add', '.'])
    git(other, ['commit', '-qm', 'b'])
    const head = git(other, ['rev-parse', 'HEAD'])

    const { haves } = await svc.bundleHaves('p1')
    const { exportBranchBundle, worktreeGit } = await import('../git')
    const exported = await exportBranchBundle(worktreeGit(), other, { haves, includeWorkingTree: false })
    if (!exported.ok || !exported.bundlePath) throw new Error('expected a bundle')
    trash.push(join(exported.bundlePath, '..'))
    const bytes = readFileSync(exported.bundlePath)
    const uploadId = '123e4567-e89b-42d3-a456-426614174000'
    const half = Math.floor(bytes.length / 2)
    svc.uploadBundle('p1', { uploadId, offset: 0, chunk: bytes.subarray(0, half).toString('base64') })
    // A resent chunk rewrites the same bytes.
    svc.uploadBundle('p1', { uploadId, offset: 0, chunk: bytes.subarray(0, half).toString('base64') })
    expect(() => svc.uploadBundle('p1', { uploadId, offset: bytes.length + 1, chunk: 'AA==' })).toThrow(/out of order/)
    expect(svc.uploadBundle('p1', { uploadId, offset: half, chunk: bytes.subarray(half).toString('base64') })).toEqual({ size: bytes.length })

    expect((await svc.branchRelations('p1', [{ localName: 'feat/sent', head }])).relations).toEqual([{ relation: 'new' }])
    const result = await svc.applyIncomingBranch('p1', {
      upload: { uploadId, size: bytes.length }, localName: 'feat/sent', head, snapshot: null,
    })
    expect(result).toMatchObject({ ok: true, branch: 'feat/sent', status: 'created' })
    expect(git(root, ['rev-parse', 'feat/sent'])).toBe(head)
    await expect(svc.applyIncomingBranch('p1', { upload: { uploadId, size: bytes.length }, localName: 'x', head, snapshot: null }))
      .rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses a short upload and malformed ids', async () => {
    const uploadId = '223e4567-e89b-42d3-a456-426614174000'
    svc.uploadBundle('p1', { uploadId, offset: 0, chunk: 'AAAA' })
    await expect(svc.applyIncomingBranch('p1', { upload: { uploadId, size: 99 }, localName: 'x', head: 'a'.repeat(40), snapshot: null }))
      .rejects.toMatchObject({ code: 'invalid_argument' })
    expect(() => svc.uploadBundle('p1', { uploadId: '../x', offset: 0, chunk: '' })).toThrow(/invalid upload id/)
    expect(() => svc.uploadBundle('p1', { uploadId: '323e4567-e89b-42d3-a456-426614174000', offset: 5, chunk: '' })).toThrow(/offset 0/)
  })
})

