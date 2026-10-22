import { describe, expect, it, vi } from 'vitest'
import { projectRef } from '@superone/shared/environment'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { buildSessionHover } from './session-hover'
import type { HostCheckout } from './types'

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

function checkout(): HostCheckout {
  return {
    ref: projectRef('env-1', 'p1'),
    environmentId: 'env-1',
    connectionId: 'env-1',
    projectId: 'p1',
    name: 'super-one',
    pathKey: 'remote:env-1:/srv/super-one',
    hostPath: '/srv/super-one',
    repoIdentity: 'git:git@github.com:acme/super-one.git',
    addedAt: 1,
    lastOpened: 2,
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
      checkout: checkout(),
      bucket: { label: 'dev-server', kind: 'cli-node', connection: 'offline' },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(model).toEqual({
      title: 'Fix the sidebar',
      environmentLabel: 'dev-server',
      kind: 'cli-node',
      connection: 'offline',
      worktreeName: 'feat-remote-build',
      lastActiveAt: '2026-10-22T00:00:00.000Z',
      tags: ['mobile'],
    })
    fetchSpy.mockRestore()
  })

  it('leaves the worktree empty for a session in the checkout', () => {
    const model = buildSessionHover({
      session: session(),
      checkout: checkout(),
      bucket: { label: 'This Mac', kind: 'local', connection: 'connected' },
    })
    expect(model.worktreeName).toBeNull()
  })

  it('falls back to the branch when a worktree session has no path', () => {
    const model = buildSessionHover({
      session: session({ isWorktree: true, gitBranch: 'feat/x' }),
      checkout: checkout(),
      bucket: { label: 'This Mac', kind: 'local', connection: 'connected' },
    })
    expect(model.worktreeName).toBe('feat/x')
  })
})
