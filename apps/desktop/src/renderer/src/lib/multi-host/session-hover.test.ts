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
        worktreePath: '/srv/wt',
        gitBranch: 'feat/remote-build',
        provider: 'codex',
        tags: ['mobile'],
        parentSessionId: 'parent',
        remoteController: { label: 'This Mac' },
      }),
      checkout: checkout(),
      bucket: { label: 'dev-server', kind: 'cli-node', connection: 'offline' },
      parentTitle: 'Parent session',
      childCount: 2,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(model).toMatchObject({
      environmentLabel: 'dev-server',
      kind: 'cli-node',
      connection: 'offline',
      locationKind: 'worktree',
      locationPath: '/srv/wt',
      branch: 'feat/remote-build',
      provider: 'codex',
      parentTitle: 'Parent session',
      childCount: 2,
      startedFrom: 'This Mac',
      tags: ['mobile'],
    })
    fetchSpy.mockRestore()
  })
})
