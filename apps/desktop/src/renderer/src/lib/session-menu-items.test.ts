import { describe, expect, it, vi } from 'vitest'
import { buildSessionMenuItems } from './session-menu-items'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'

const t = ((key: string) => key) as never

const base: SessionHistoryEntry = {
  sessionId: 'sid-1',
  title: 'Chat',
  lastActiveAt: new Date().toISOString(),
  messageCount: 1,
  provider: 'claude',
  isPinned: false,
  isHidden: false,
}

const handlers = {
  onRename: vi.fn(),
  onPin: vi.fn(),
  onHide: vi.fn(),
  onFork: vi.fn(),
  onDelete: vi.fn(),
}

function itemIds(folderPath: string): string[] {
  return buildSessionMenuItems(base, folderPath, t, handlers)
    .filter((e): e is Extract<typeof e, { kind: 'item' }> => e.kind === 'item')
    .map((e) => e.id)
}

describe('buildSessionMenuItems remote vs local', () => {
  it('includes mini window and remote fork for remote project keys', () => {
    const ids = itemIds('remote:conn-1:/work/app')
    expect(ids).toContain('mini')
    expect(ids).toContain('rename')
    expect(ids).toContain('pin')
    expect(ids).toContain('hide')
    expect(ids).toContain('copyId')
    expect(ids).toContain('copyDir')
    expect(ids).toContain('delete')
    // Remote fork = node worktree / same-dir local
    expect(ids).toContain('forkWorktree')
    expect(ids).toContain('forkLocal')
    // Local-only actions
    expect(ids).not.toContain('openFolder')
  })

  it('includes openFolder and fork for local projects', () => {
    const ids = itemIds('/Users/me/app')
    expect(ids).toContain('mini')
    expect(ids).toContain('openFolder')
    expect(ids).toContain('forkWorktree')
    expect(ids).toContain('forkLocal')
  })
})
