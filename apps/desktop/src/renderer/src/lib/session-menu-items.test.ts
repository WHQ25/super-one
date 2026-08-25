/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSessionMenuItems,
  resolveSessionIdForCopy,
} from './session-menu-items'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'

const getSession = vi.fn()

vi.stubGlobal('window', {
  // The convert path starts the fold, which tracks panel widths against window resizes.
  innerWidth: 1440,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  environment: {
    getSession,
  },
  app: {
    openSessionWindow: vi.fn(),
    convertWindowToMini: vi.fn(),
    showInFolder: vi.fn(),
  },
})

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
  onAddToChat: vi.fn(),
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
    expect(ids).toContain('addToChat')
    expect(ids).toContain('copyDir')
    expect(ids).toContain('delete')
    expect(ids).not.toContain('copyHarnessId')
    // Remote fork = node worktree / same-dir on the node
    expect(ids).toContain('forkWorktree')
    expect(ids).toContain('forkLocal')
    // Local-only actions
    expect(ids).not.toContain('openFolder')
  })

  it('uses Fork to Same Worktree for both remote and local', () => {
    for (const path of ['remote:conn-1:/work/app', '/Users/me/app'] as const) {
      const items = buildSessionMenuItems(base, path, t, handlers)
      const forkLocal = items.find(
        (e): e is Extract<typeof e, { kind: 'item' }> => e.kind === 'item' && e.id === 'forkLocal',
      )
      expect(forkLocal?.label).toBe('sidebar.contextMenu.forkToSameWorktree')
    }
  })

  it('includes openFolder and fork for local projects', () => {
    const ids = itemIds('/Users/me/app')
    expect(ids).toContain('mini')
    expect(ids).toContain('openFolder')
    expect(ids).toContain('forkWorktree')
    expect(ids).toContain('forkLocal')
  })

  it('omits addToChat when handler is missing', () => {
    const { onAddToChat: _, ...rest } = handlers
    const ids = buildSessionMenuItems(base, '/Users/me/app', t, rest)
      .filter((e): e is Extract<typeof e, { kind: 'item' }> => e.kind === 'item')
      .map((e) => e.id)
    expect(ids).not.toContain('addToChat')
  })

  it('places addToChat above copySessionId', () => {
    const ids = itemIds('/Users/me/app')
    expect(ids.indexOf('addToChat')).toBeLessThan(ids.indexOf('copyId'))
  })
})

describe('buildSessionMenuItems header vs sidebar shape', () => {
  function item(items: ReturnType<typeof buildSessionMenuItems>, id: string) {
    return items.find((e): e is Extract<typeof e, { kind: 'item' }> => e.kind === 'item' && e.id === id)
  }

  it('omits hide when no hide handler is given (chat header menu)', () => {
    const { onHide: _, onAddToChat: __, ...rest } = handlers
    const ids = buildSessionMenuItems(base, '/Users/me/app', t, rest, { miniWindow: 'convert' })
      .filter((e): e is Extract<typeof e, { kind: 'item' }> => e.kind === 'item')
      .map((e) => e.id)
    expect(ids).not.toContain('hide')
    expect(ids).not.toContain('addToChat')
    expect(ids).toContain('mini')
  })

  it('converts this window instead of spawning one when miniWindow is convert', () => {
    const items = buildSessionMenuItems(base, '/Users/me/app', t, handlers, { miniWindow: 'convert' })
    const mini = item(items, 'mini')
    expect(mini?.label).toBe('sidebar.contextMenu.convertToMiniWindow')
    mini?.onSelect()
    // Fourth argument is the measured fold choreography — covered by the store's test.
    expect(window.app.convertWindowToMini).toHaveBeenCalledWith('/Users/me/app', 'sid-1', 'Chat', expect.any(Array))
    expect(window.app.openSessionWindow).not.toHaveBeenCalled()
  })

  it('spawns a separate mini window by default (sidebar rows)', () => {
    const mini = item(buildSessionMenuItems(base, '/Users/me/app', t, handlers), 'mini')
    expect(mini?.label).toBe('sidebar.contextMenu.openInMiniWindow')
    mini?.onSelect()
    expect(window.app.openSessionWindow).toHaveBeenCalledWith('/Users/me/app', 'sid-1', 'Chat')
  })
})

describe('buildSessionMenuItems tags submenu', () => {
  function tagsSubmenu(session: SessionHistoryEntry) {
    const items = buildSessionMenuItems(session, '/Users/me/app', t, handlers)
    return items.find((e): e is Extract<typeof e, { kind: 'submenu' }> => e.kind === 'submenu' && e.id === 'tags')
  }

  it('shows a disabled empty-state item when the session has no tags', () => {
    const submenu = tagsSubmenu(base)
    expect(submenu).toBeDefined()
    expect(submenu?.items).toEqual([
      expect.objectContaining({ id: 'tags-empty', disabled: true, label: 'sidebar.contextMenu.noTags' }),
    ])
  })

  it('lists current tags as enabled items that copy on select', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const submenu = tagsSubmenu({ ...base, tags: ['ui', 'sidebar'] })
    expect(submenu?.items.map((e) => (e.kind === 'item' ? e.label : e.kind))).toEqual(['ui', 'sidebar'])
    expect(submenu?.items.every((e) => e.kind === 'item' && !e.disabled)).toBe(true)
    const first = submenu?.items[0]
    if (first?.kind === 'item') first.onSelect()
    expect(writeText).toHaveBeenCalledWith('ui')
  })
})

describe('resolveSessionIdForCopy', () => {
  beforeEach(() => {
    getSession.mockReset()
  })

  it('uses providerSessionId when already on the history entry', async () => {
    const result = await resolveSessionIdForCopy(
      { ...base, providerSessionId: 'sdk-abc' },
      'remote:conn-1:/work',
    )
    expect(result).toEqual({ id: 'sdk-abc', isHarnessId: true })
    expect(getSession).not.toHaveBeenCalled()
  })

  it('loads providerResume from remote session.get when list row has no harness id', async () => {
    getSession.mockResolvedValueOnce({ providerResume: 'claude-session:sdk-from-node' })
    const result = await resolveSessionIdForCopy(base, 'remote:conn-9:/work/app')
    expect(getSession).toHaveBeenCalledWith('conn-9', 'sid-1')
    expect(result).toEqual({ id: 'sdk-from-node', isHarnessId: true })
  })

  it('falls back to SuperOne session id when harness id is unavailable', async () => {
    getSession.mockResolvedValueOnce({ providerResume: null })
    const result = await resolveSessionIdForCopy(base, 'remote:conn-1:/work')
    expect(result).toEqual({ id: 'sid-1', isHarnessId: false })
  })

  it('does not call getSession for local sessions without providerSessionId', async () => {
    const result = await resolveSessionIdForCopy(base, '/Users/me/app')
    expect(getSession).not.toHaveBeenCalled()
    expect(result).toEqual({ id: 'sid-1', isHarnessId: false })
  })
})

