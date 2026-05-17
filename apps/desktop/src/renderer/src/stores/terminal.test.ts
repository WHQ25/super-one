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
    s.addTab('/proj', item('t1'))
    s.addTab('/proj', item('t2'))
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
    s.addTab('/proj-a', item('a1'))
    s.addTab('/proj-b', item('b1'))
    expect(useTerminalStore.getState().byProject['/proj-a'].tabs).toHaveLength(1)
    expect(useTerminalStore.getState().byProject['/proj-b'].tabs).toHaveLength(1)
    expect(useTerminalStore.getState().byProject['/proj-a'].tabs[0].terminalId).toBe('a1')
  })

  it('promotes the previous tab as active after the active terminal is closed', () => {
    const s = useTerminalStore.getState()
    s.addTab('/proj', item('t1'))
    s.addTab('/proj', item('t2'))
    s.removeTab('/proj', 't2')
    expect(useTerminalStore.getState().byProject['/proj'].activeId).toBe('t1')
    s.removeTab('/proj', 't1')
    expect(useTerminalStore.getState().byProject['/proj'].activeId).toBeNull()
    expect(useTerminalStore.getState().byProject['/proj'].tabs).toHaveLength(0)
  })
})
