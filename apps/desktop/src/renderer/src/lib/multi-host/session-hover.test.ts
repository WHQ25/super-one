import { describe, expect, it, vi } from 'vitest'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { buildSessionHover, presenterFor, sessionPresentation, worktreeCheckoutLabel, worktreeInfoRoot } from './session-hover'

function session(extra?: Partial<SessionHistoryEntry>): SessionHistoryEntry {
  return {
    sessionId: 's1',
    title: 'Fix the sidebar',
    lastActiveAt: '2026-10-22T00:00:00.000Z',
    messageCount: 2,
    gitBranch: 'main',
    ...extra,
  }
}

describe('buildSessionHover', () => {
  it('reads the card from the list and does not touch the network', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const model = buildSessionHover({
      session: session({
        isWorktree: true,
        worktreePath: '/srv/super-one/.worktrees/feat-remote-build',
        gitBranch: 'feat/remote-build',
        tags: ['mobile'],
      }),
      bucket: { label: 'dev-server', kind: 'cli-node', connection: 'offline' },
      projectName: 'super-one',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(model).toEqual({
      title: 'Fix the sidebar',
      projectName: 'super-one',
      environmentLabel: 'dev-server',
      kind: 'cli-node',
      connection: 'offline',
      worktreeName: 'feat/remote-build',
      worktreePath: '/srv/super-one/.worktrees/feat-remote-build',
      lastActiveAt: '2026-10-22T00:00:00.000Z',
      tags: ['mobile'],
    })
    fetchSpy.mockRestore()
  })

  it('leaves the worktree empty for a session in the checkout', () => {
    const model = buildSessionHover({
      session: session(),
      bucket: { label: 'This Mac', kind: 'local', connection: 'connected' },
    })
    expect(model.worktreeName).toBeNull()
  })

  it('falls back to the branch when a worktree session has no path', () => {
    const model = buildSessionHover({
      session: session({ isWorktree: true, gitBranch: 'feat/x' }),
      bucket: { label: 'This Mac', kind: 'local', connection: 'connected' },
    })
    expect(model.worktreeName).toBe('feat/x')
    expect(model.worktreePath).toBeUndefined()
  })

  it('keeps a detached worktree unlabeled until its commit is read', () => {
    const model = buildSessionHover({
      session: session({
        isWorktree: true,
        gitBranch: undefined,
        worktreePath: '/Users/me/.worktrees/super-one/m1abc-abc1234',
      }),
      bucket: { label: 'This Mac', kind: 'local', connection: 'connected' },
      projectPath: '/Users/me/Developer/super-one',
    })
    expect(model.worktreeName).toBeNull()
    expect(model.worktreePath).toBe('/Users/me/.worktrees/super-one/m1abc-abc1234')
    expect(model.projectPath).toBe('/Users/me/Developer/super-one')
  })
})

describe('worktreeCheckoutLabel', () => {
  const path = '/Users/me/.worktrees/super-one/m1abc-abc1234'

  it('uses the branch name when the worktree has one', () => {
    expect(worktreeCheckoutLabel([
      { path, branch: 'feat/sidebar', head: 'deadbeef' },
    ], path)).toEqual({ kind: 'branch', name: 'feat/sidebar' })
  })

  it('uses the short commit when the worktree is detached', () => {
    expect(worktreeCheckoutLabel([
      { path, branch: '', head: 'abc1234deadbeef' },
    ], path)).toEqual({ kind: 'commit', hash: 'abc1234' })
  })

  it('matches a remote project key to the host path', () => {
    expect(worktreeCheckoutLabel([
      { path, branch: '', head: 'abc1234deadbeef' },
    ], 'remote:office:' + path)?.kind).toBe('commit')
  })

  it('says the checkout is detached when git has no branch and no HEAD', () => {
    expect(worktreeCheckoutLabel([{ path, branch: '  ', head: '' }], path)).toEqual({ kind: 'detached' })
  })

  it('reads a remote project through its project key', () => {
    expect(worktreeInfoRoot('remote:office:/srv/app', path)).toBe('remote:office:/srv/app')
    expect(worktreeInfoRoot('/srv/app', path)).toBe(path)
  })
})

describe('sessionPresentation', () => {
  const bucket = { label: 'This Mac', kind: 'local', connection: 'connected' } as const

  it('keeps the object while the session row and environment fields stay', () => {
    const row = session()
    const first = sessionPresentation(row, bucket)
    expect(sessionPresentation(row, { ...bucket })).toBe(first)
    expect(sessionPresentation(row, { ...bucket, connection: 'offline' })).not.toBe(first)
  })

  it('hands one presenter to every bucket in the same state', () => {
    expect(presenterFor({ ...bucket })).toBe(presenterFor({ ...bucket }))
  })

  it('keeps presenters for different projects apart', () => {
    const row = session()
    expect(presenterFor(bucket, 'app')).not.toBe(presenterFor(bucket, 'web'))
    expect(presenterFor(bucket, 'app')(row).hover.projectName).toBe('app')
    expect(presenterFor(bucket, 'web')(row).hover.projectName).toBe('web')
  })
})
