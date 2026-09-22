/** @vitest-environment jsdom */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalEvent, TerminalListItem } from '@superone/shared/agent-types'

const dropActivityTerminalTab = vi.fn()
const revealTerminalTabInActivity = vi.fn()
vi.mock('@/components/activity/activity-panel-api', () => ({ dropActivityTerminalTab, revealTerminalTabInActivity }))
vi.mock('./useTerminalPanel', () => ({ useTerminalPanel: () => ({ setOpen: vi.fn() }) }))
vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ currentFolder: '/proj' }) } }))

const removeTab = vi.fn()
const storeState = {
  byProject: { '/proj': { tabs: [{ terminalId: 't1' }] } },
  upsertTab: vi.fn(),
  removeTab,
  renameTab: vi.fn(),
  setTabOwner: vi.fn(),
  setTabControl: vi.fn(),
  setActive: vi.fn(),
}
vi.mock('@/stores/terminal', () => ({
  useTerminalStore: Object.assign(
    (selector: (s: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
}))

let emit: (event: TerminalEvent) => void = () => {}
Object.defineProperty(window, 'terminal', {
  configurable: true,
  value: {
    onTerminalEvent: (cb: (event: TerminalEvent) => void) => { emit = cb; return () => {} },
    list: vi.fn().mockResolvedValue([]),
  },
})

const { useTerminalSync } = await import('./useTerminalSync')

beforeEach(() => vi.clearAllMocks())

describe('useTerminalSync on terminal_exited', () => {
  it('drops the activity dock tab as well as the bottom-panel tab', () => {
    renderHook(() => useTerminalSync())
    emit({ type: 'terminal_exited', terminalId: 't1', exitCode: 0 } as TerminalEvent)
    expect(dropActivityTerminalTab).toHaveBeenCalledWith('t1')
    expect(removeTab).toHaveBeenCalledWith('/proj', 't1')
  })

  it('drops an agent-opened tab that only ever lived in the activity dock', () => {
    renderHook(() => useTerminalSync())
    emit({ type: 'terminal_exited', terminalId: 't-agent', exitCode: 0 } as TerminalEvent)
    expect(dropActivityTerminalTab).toHaveBeenCalledWith('t-agent')
    expect(removeTab).not.toHaveBeenCalled()
  })

  it('docks an agent-opened tab without forcing the panel open, and keeps it out of the bottom panel', () => {
    renderHook(() => useTerminalSync())
    const item = { terminalId: 't2', cwd: '/proj', projectPath: '/proj', agentSessionId: 'sess-a' } as TerminalListItem
    emit({ type: 'terminal_created', item } as TerminalEvent)
    expect(revealTerminalTabInActivity).toHaveBeenCalledWith(item, { reveal: false })
    // The bottom panel is per project: listing the tab there would show it to
    // every session in the project, not only the one whose agent opened it.
    expect(storeState.upsertTab).not.toHaveBeenCalled()
  })

  it('leaves a user-opened tab out of the activity dock', () => {
    renderHook(() => useTerminalSync())
    const item = { terminalId: 't3', cwd: '/proj', projectPath: '/proj' } as TerminalListItem
    emit({ type: 'terminal_created', item } as TerminalEvent)
    expect(revealTerminalTabInActivity).not.toHaveBeenCalled()
    expect(storeState.upsertTab).toHaveBeenCalledWith('/proj', item)
  })

  it('keeps a tab opened from the activity launcher out of the bottom panel', () => {
    renderHook(() => useTerminalSync())
    const item = { terminalId: 't4', cwd: '/proj', projectPath: '/proj', openedInActivity: true } as TerminalListItem
    emit({ type: 'terminal_created', item } as TerminalEvent)
    // The launcher docks the tab itself once create() resolves.
    expect(revealTerminalTabInActivity).not.toHaveBeenCalled()
    expect(storeState.upsertTab).not.toHaveBeenCalled()
  })
})
