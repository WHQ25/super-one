import { describe, expect, it, vi } from 'vitest'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { buildSessionHover, presenterFor, sessionPresentation } from './session-hover'

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
})
