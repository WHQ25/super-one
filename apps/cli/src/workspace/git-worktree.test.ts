import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { WorkspaceGitService, parseShortstat, parseBranchPorcelain } from './git-service'
import type { ProjectRegistry } from './project-registry'

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
  let projects: ProjectRegistry
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
    } as unknown as ProjectRegistry
    svc = new WorkspaceGitService(projects)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('status includes shortstat insertions/deletions when dirty', () => {
    writeFileSync(join(dir, 'README.md'), 'changed\n')
    const st = svc.status('p1')
    expect(st.isRepo).toBe(true)
    expect(st.dirty).toBe(true)
    expect((st.insertions ?? 0) + (st.deletions ?? 0)).toBeGreaterThan(0)
  })

  it('creates a branch worktree under ~/.worktrees', () => {
    const result = svc.activateWorktree('p1', {
      baseBranch: 'main',
      mode: 'branch',
      branchName: 'feat/remote-wt',
    })
    expect(existsSync(result.path)).toBe(true)
    expect(result.recordedBranch).toBe('feat/remote-wt')
    expect(result.path.includes('.worktrees')).toBe(true)
    const list = svc.worktrees('p1')
    expect(list.some((w) => w.path === result.path)).toBe(true)
    // cleanup worktree
    try {
      execFileSync('git', ['-C', dir, 'worktree', 'remove', '--force', result.path], { stdio: 'ignore' })
    } catch { /* */ }
  })

  it('rejects path outside the repo for assertRepoWorktreePath', () => {
    expect(() => svc.assertRepoWorktreePath('p1', '/tmp/not-this-repo')).toThrow(/not a worktree/)
  })
})
