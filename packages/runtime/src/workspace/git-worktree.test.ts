import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { gitRun } from '@superone/runtime/git'
import { WorkspaceGitService, parseShortstat, parseBranchPorcelain } from './git-service'
import type { WorkspaceProjects } from './workspace-projects'

function git(cwd: string, args: string[]) {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' })
}

describe('parseShortstat', () => {
  it('parses insertion and deletion counts', () => {
    expect(
      parseShortstat(' 2 files changed, 10 insertions(+), 4 deletions(-)\n'),
    ).toEqual({ insertions: 10, deletions: 4 })
  })

  it('returns zeros for empty shortstat', () => {
    expect(parseShortstat('')).toEqual({ insertions: 0, deletions: 0 })
  })
})

describe('parseBranchPorcelain', () => {
  it('parses branch and file lines from status -b output', () => {
    const raw = '## main...origin/main [ahead 1, behind 2]\n M a.ts\n?? b.ts\n'
    expect(parseBranchPorcelain(raw)).toEqual({
      branch: 'main',
      ahead: 1,
      behind: 2,
      porcelain: ' M a.ts\n?? b.ts\n',
    })
  })

  it('handles detached HEAD', () => {
    expect(parseBranchPorcelain('## HEAD (no branch)\n')).toEqual({
      branch: null,
      ahead: 0,
      behind: 0,
      porcelain: '',
    })
  })
})

describe('WorkspaceGitService worktree activate', () => {
  let dir: string
  let projects: WorkspaceProjects
  let svc: WorkspaceGitService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 's1-wt-'))
    git(dir, ['init'])
    git(dir, ['config', 'user.email', 't@example.com'])
    git(dir, ['config', 'user.name', 't'])
    writeFileSync(join(dir, 'README.md'), 'hi\n')
    git(dir, ['add', '.'])
    git(dir, ['commit', '-m', 'init'])
    // ensure main branch name
    try { git(dir, ['branch', '-M', 'main']) } catch { /* */ }
    projects = {
      get: () => ({ projectId: 'p1', path: dir, name: 't', repoIdentity: null }),
      touch: () => {},
    } as unknown as WorkspaceProjects
    svc = new WorkspaceGitService(projects)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('status includes shortstat insertions/deletions when dirty', async () => {
    writeFileSync(join(dir, 'README.md'), 'changed\n')
    const st = await svc.status('p1')
    expect(st.isRepo).toBe(true)
    expect(st.dirty).toBe(true)
    expect((st.insertions ?? 0) + (st.deletions ?? 0)).toBeGreaterThan(0)
  })

  it('names the detached commit instead of presenting HEAD as a branch', async () => {
    git(dir, ['checkout', '--detach'])
    const head = execFileSync('git', ['-C', dir, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim()
    expect(await svc.status('p1')).toMatchObject({ branch: null, head })
  })

  it('creates a branch worktree under ~/.worktrees', async () => {
    const result = await svc.activateWorktree('p1', {
      baseBranch: 'main',
      mode: 'branch',
      branchName: 'feat/remote-wt',
    })
    expect(existsSync(result.path)).toBe(true)
    expect(result.recordedBranch).toBe('feat/remote-wt')
    expect(result.path.includes('.worktrees')).toBe(true)
    const list = await svc.worktrees('p1')
    expect(list.some((w) => w.path === result.path)).toBe(true)
    // cleanup worktree
    try {
      execFileSync('git', ['-C', dir, 'worktree', 'remove', '--force', result.path], { stdio: 'ignore' })
    } catch { /* */ }
  })

  it('rejects path outside the repo for assertRepoWorktreePath', async () => {
    await expect(svc.assertRepoWorktreePath('p1', '/tmp/not-this-repo')).rejects.toThrow(/not a worktree/)
  })

  it('fails a hung read after its timeout without blocking the event loop', async () => {
    // A `git` that never answers, as one stuck on a lock or a dead mount would.
    const bin = mkdtempSync(join(tmpdir(), 's1-hung-git-'))
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec sleep 30\n')
    chmodSync(join(bin, 'git'), 0o755)
    const path = process.env.PATH
    process.env.PATH = `${bin}:${path}`
    try {
      const hung = new WorkspaceGitService(projects, {
        // Keep the production read/write split, with a test-sized read timeout.
        gitRun: (cwd, args, env, opts) => gitRun(cwd, args, env, opts?.timeoutMs ? { timeoutMs: 200 } : opts),
      })
      const order: string[] = []
      const started = Date.now()
      const status = hung.status('p1').finally(() => order.push('status'))
      expect(Date.now() - started).toBeLessThan(100)
      await new Promise((r) => setTimeout(r, 20)).then(() => order.push('timer'))
      await expect(status).rejects.toMatchObject({ code: 'internal', message: expect.stringMatching(/timed out after 200ms/) })
      expect(order).toEqual(['timer', 'status'])
    } finally {
      process.env.PATH = path
      rmSync(bin, { recursive: true, force: true })
    }
  })
})
