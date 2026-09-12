import { beforeEach, describe, expect, it } from 'vitest'
import type { TerminalListItem } from '@superone/shared/agent-types'
import { useTerminalStore } from './terminal'

const item = (id: string, title = id): TerminalListItem =>
  ({ terminalId: id, title, cwd: '/p', status: 'running' }) as unknown as TerminalListItem

describe('terminal panel open state is per session', () => {
  beforeEach(() => {
    useTerminalStore.setState({ openBySession: {}, byProject: {}, instances: new Map() })
  })

  it('keeps each session independent and does not bleed open state across sessions', () => {
    const s = useTerminalStore.getState()
    s.setOpen('sess-a', true)
    expect(useTerminalStore.getState().openBySession['sess-a']).toBe(true)
    expect(useTerminalStore.getState().openBySession['sess-b'] ?? false).toBe(false)
    s.toggleOpen('sess-b')
    expect(useTerminalStore.getState().openBySession['sess-b']).toBe(true)
    expect(useTerminalStore.getState().openBySession['sess-a']).toBe(true)
  })

  it('routes a null session to the no-session bucket without throwing', () => {
    useTerminalStore.getState().toggleOpen(null)
    expect(useTerminalStore.getState().openBySession['__no_session__']).toBe(true)
  })
})

describe('terminal instances are shared per project across session switches', () => {
  beforeEach(() => {
    useTerminalStore.setState({ openBySession: {}, byProject: {}, instances: new Map() })
  })

  it('still exposes the same tabs after leaving and returning to a session of the same project', () => {
    const s = useTerminalStore.getState()
    s.upsertTab('/proj', item('t1'), true)
    s.upsertTab('/proj', item('t2'), true)
    // Switching session does NOT touch byProject — simulate a session round-trip
    s.setOpen('sess-a', true)
    s.setOpen('sess-b', false)
    s.setOpen('sess-a', true)
    const proj = useTerminalStore.getState().byProject['/proj']
    expect(proj.tabs.map((t) => t.terminalId)).toEqual(['t1', 't2'])
    expect(proj.activeId).toBe('t2')
  })

  it('isolates terminals between different projects', () => {
    const s = useTerminalStore.getState()
    s.upsertTab('/proj-a', item('a1'), true)
    s.upsertTab('/proj-b', item('b1'), true)
    expect(useTerminalStore.getState().byProject['/proj-a'].tabs).toHaveLength(1)
    expect(useTerminalStore.getState().byProject['/proj-b'].tabs).toHaveLength(1)
    expect(useTerminalStore.getState().byProject['/proj-a'].tabs[0].terminalId).toBe('a1')
  })

  it('promotes the previous tab as active after the active terminal is closed', () => {
    const s = useTerminalStore.getState()
    s.upsertTab('/proj', item('t1'), true)
    s.upsertTab('/proj', item('t2'), true)
    s.removeTab('/proj', 't2')
    expect(useTerminalStore.getState().byProject['/proj'].activeId).toBe('t1')
    s.removeTab('/proj', 't1')
    expect(useTerminalStore.getState().byProject['/proj'].activeId).toBeNull()
    expect(useTerminalStore.getState().byProject['/proj'].tabs).toHaveLength(0)
  })
})

describe('terminal tabs reorder by drag', () => {
  beforeEach(() => {
    useTerminalStore.setState({ openBySession: {}, byProject: {}, instances: new Map() })
  })

  it('moves a dragged tab to the drop target slot while keeping the active tab', () => {
    const s = useTerminalStore.getState()
    s.upsertTab('/proj', item('t1'), true)
    s.upsertTab('/proj', item('t2'), true)
    s.upsertTab('/proj', item('t3'), true)
    s.setActive('/proj', 't1')
    s.reorderTabs('/proj', 't1', 't3')
    const proj = useTerminalStore.getState().byProject['/proj']
    expect(proj.tabs.map((t) => t.terminalId)).toEqual(['t2', 't3', 't1'])
    expect(proj.activeId).toBe('t1')
  })

  it('no-ops on unknown ids, same source/target, or missing project', () => {
    const s = useTerminalStore.getState()
    s.upsertTab('/proj', item('t1'), true)
    s.upsertTab('/proj', item('t2'), true)
    const before = useTerminalStore.getState().byProject
    s.reorderTabs('/proj', 't1', 't1')
    s.reorderTabs('/proj', 't1', 'missing')
    s.reorderTabs('/nope', 't1', 't2')
    expect(useTerminalStore.getState().byProject).toBe(before)
  })
})

describe('tabs upserted from a remote create keep the current tab', () => {
  beforeEach(() => {
    useTerminalStore.setState({ openBySession: {}, byProject: {}, instances: new Map() })
  })

  it('keeps a single tab when the terminal_created event lands before the create() result', () => {
    const s = useTerminalStore.getState()
    // Main emits terminal_created synchronously inside create(), so the
    // broadcast reaches the renderer before the IPC invoke resolves.
    s.upsertTab('/proj', item('t1', 'super-one'))
    s.upsertTab('/proj', item('t1', 'super-one'), true)
    s.renameTab('t1', 'user@host')
    const proj = useTerminalStore.getState().byProject['/proj']
    expect(proj.tabs.map((t) => t.title)).toEqual(['user@host'])
    expect(proj.activeId).toBe('t1')
  })

  it('appends a new terminal without stealing the active tab', () => {
    const s = useTerminalStore.getState()
    s.upsertTab('/proj', item('t1', 'zsh'), true)
    s.upsertTab('/proj', item('t2', 'npm run dev'))
    const proj = useTerminalStore.getState().byProject['/proj']
    expect(proj.tabs.map((t) => t.terminalId)).toEqual(['t1', 't2'])
    expect(proj.activeId).toBe('t1')
  })

  it('marks a phone as the owner of a tab', () => {
    const s = useTerminalStore.getState()
    s.upsertTab('/proj', item('t1'), true)
    s.setTabOwner('t1', 'phone-1')
    expect(useTerminalStore.getState().byProject['/proj'].tabs[0].ownerDeviceId).toBe('phone-1')
    s.setTabOwner('t1', null)
    expect(useTerminalStore.getState().byProject['/proj'].tabs[0].ownerDeviceId).toBeNull()
  })
})

describe('tab title auto-updates from the shell OSC title sequence', () => {
  beforeEach(() => {
    useTerminalStore.setState({ openBySession: {}, byProject: {}, instances: new Map() })
  })

  it('renames the owning project tab when the shell emits a new title', () => {
    const s = useTerminalStore.getState()
    s.upsertTab('/proj-a', item('a1', 'zsh'), true)
    s.upsertTab('/proj-b', item('b1', 'zsh'), true)
    s.renameTab('a1', '~/super-one — vitest')
    expect(useTerminalStore.getState().byProject['/proj-a'].tabs[0].title).toBe(
      '~/super-one — vitest',
    )
    expect(useTerminalStore.getState().byProject['/proj-b'].tabs[0].title).toBe('zsh')
  })

  it('ignores blank titles and no-ops when the title is unchanged or the terminal is gone', () => {
    const s = useTerminalStore.getState()
    s.upsertTab('/proj', item('t1', 'zsh'), true)
    const before = useTerminalStore.getState().byProject
    s.renameTab('t1', '   ')
    s.renameTab('t1', 'zsh')
    s.renameTab('missing', 'x')
    expect(useTerminalStore.getState().byProject).toBe(before)
  })
})
