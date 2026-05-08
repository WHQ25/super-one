/** @vitest-environment jsdom */

import { useRef } from 'react'
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { collectActiveRows, SessionSwitcherPopup, SessionSwitcherView, type SwitcherRow } from './SessionSwitcherPopup'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore, type ProjectState, type PerSessionState } from '@/stores/chat'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'

function makeSession(overrides: Partial<PerSessionState>): PerSessionState {
  return { ...createDefaultPerSessionState(), ...overrides }
}

function makeProject(input: {
  active: string | null
  previous?: string | null
  sessions: Record<string, Partial<PerSessionState>>
}): ProjectState {
  const _sessions: Record<string, PerSessionState> = {}
  for (const [sid, partial] of Object.entries(input.sessions)) {
    _sessions[sid] = makeSession(partial)
  }
  return {
    ...createDefaultProjectState(),
    _activeSessionId: input.active,
    _previousSessionId: input.previous ?? null,
    _sessions,
  }
}

const liveStreaming: Partial<PerSessionState> = { status: 'streaming', awaitingAssistantReply: true, _historyHydrated: true, lastEventAt: 1000 }
const liveBackground: Partial<PerSessionState> = { status: 'background', _historyHydrated: true, lastEventAt: 500 }
const idleHydrated: Partial<PerSessionState> = { status: 'idle', _historyHydrated: true, lastEventAt: 100 }

describe('collectActiveRows', () => {
  it('inserts an idle previous session right after the current row', () => {
    const project = makeProject({
      active: 's1',
      previous: 's2',
      sessions: {
        s1: liveBackground,
        s2: idleHydrated,
      },
    })

    const rows = collectActiveRows(project, [])

    expect(rows.map((r) => r.sessionId)).toEqual(['s1', 's2'])
    expect(rows[0].isCurrent).toBe(true)
    expect(rows[1].isPrevious).toBe(true)
  })

  it('moves an already-active previous session into the slot after current', () => {
    const project = makeProject({
      active: 's1',
      previous: 's3',
      sessions: {
        s1: { ...liveStreaming, lastEventAt: 1000 },
        s2: { ...liveBackground, lastEventAt: 800 },
        s3: { ...liveBackground, lastEventAt: 500 },
      },
    })

    const rows = collectActiveRows(project, [])

    expect(rows.map((r) => r.sessionId)).toEqual(['s1', 's3', 's2'])
    expect(rows[1].isPrevious).toBe(true)
  })

  it('does not insert the previous session when it has no in-memory entry', () => {
    const project = makeProject({
      active: 's1',
      previous: 'gone-from-memory',
      sessions: {
        s1: liveBackground,
      },
    })

    const rows = collectActiveRows(project, [])

    expect(rows.map((r) => r.sessionId)).toEqual(['s1'])
    expect(rows.some((r) => r.isPrevious)).toBe(false)
  })

  it('does nothing special when previous equals current', () => {
    const project = makeProject({
      active: 's1',
      previous: 's1',
      sessions: { s1: liveBackground },
    })

    const rows = collectActiveRows(project, [])

    expect(rows).toHaveLength(1)
    expect(rows[0].isPrevious).toBe(false)
  })

  it('sorts active sessions by lastEventAt desc and keeps current at its natural slot', () => {
    const project = makeProject({
      active: 's-old',
      sessions: {
        's-old': { ...liveBackground, lastEventAt: 100 },
        's-new': { ...liveStreaming, lastEventAt: 1000 },
        's-mid': { ...liveBackground, lastEventAt: 500 },
      },
    })

    const rows = collectActiveRows(project, [])

    expect(rows.map((r) => r.sessionId)).toEqual(['s-new', 's-mid', 's-old'])
  })

  it('skips sessions with no messages and no history hydration', () => {
    const project = makeProject({
      active: null,
      sessions: {
        empty: { ...liveBackground, _historyHydrated: false, messages: [] },
        ready: liveBackground,
      },
    })

    const rows = collectActiveRows(project, [])

    expect(rows.map((r) => r.sessionId)).toEqual(['ready'])
  })

  it('flags remote sessions correctly', () => {
    const project = makeProject({
      active: null,
      sessions: { remote1: liveBackground, local1: liveBackground },
    })

    const rows = collectActiveRows(project, ['remote1'])

    const remote = rows.find((r) => r.sessionId === 'remote1')!
    const local = rows.find((r) => r.sessionId === 'local1')!
    expect(remote.isRemote).toBe(true)
    expect(local.isRemote).toBe(false)
  })

  it('includes idle previous when current is not active itself', () => {
    const project = makeProject({
      active: 's-current-idle',
      previous: 's-was-here',
      sessions: {
        's-current-idle': idleHydrated,
        's-active': liveBackground,
        's-was-here': idleHydrated,
      },
    })

    const rows = collectActiveRows(project, [])

    expect(rows.map((r) => r.sessionId)).toContain('s-was-here')
    expect(rows.find((r) => r.sessionId === 's-was-here')?.isPrevious).toBe(true)
  })
})

describe('SessionSwitcherView open delay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeRow(sessionId: string, overrides: Partial<SwitcherRow> = {}): SwitcherRow {
    return {
      sessionId,
      title: sessionId,
      status: 'background',
      lastEventAt: 0,
      isCurrent: false,
      isPrevious: false,
      isUnseen: false,
      isRemote: false,
      isAutomation: false,
      isWorktree: false,
      pendingReason: null,
      ...overrides,
    }
  }

  it('does not render the popup before the open delay elapses', () => {
    const rows = [makeRow('s1', { isCurrent: true }), makeRow('s2', { isPrevious: true })]
    const { queryByText } = render(<SessionSwitcherView rows={rows} selectedIndex={1} isOpen openDelayMs={200} />)

    expect(queryByText('Switch Between working sessions')).toBeNull()

    act(() => { vi.advanceTimersByTime(199) })
    expect(queryByText('Switch Between working sessions')).toBeNull()
  })

  it('renders the popup after the open delay elapses', () => {
    const rows = [makeRow('s1', { isCurrent: true }), makeRow('s2', { isPrevious: true })]
    const { queryByText } = render(<SessionSwitcherView rows={rows} selectedIndex={1} isOpen openDelayMs={200} />)

    act(() => { vi.advanceTimersByTime(200) })
    expect(queryByText('Switch Between working sessions')).not.toBeNull()
  })

  it('skips render entirely when isOpen flips to false before the delay (fast-tap)', () => {
    const rows = [makeRow('s1', { isCurrent: true }), makeRow('s2', { isPrevious: true })]
    const { queryByText, rerender } = render(<SessionSwitcherView rows={rows} selectedIndex={1} isOpen openDelayMs={200} />)

    act(() => { vi.advanceTimersByTime(50) })
    rerender(<SessionSwitcherView rows={[]} selectedIndex={0} isOpen={false} openDelayMs={200} />)

    act(() => { vi.advanceTimersByTime(500) })
    expect(queryByText('Switch Between working sessions')).toBeNull()
  })

  it('renders immediately when openDelayMs is 0', () => {
    const rows = [makeRow('s1', { isCurrent: true }), makeRow('s2', { isPrevious: true })]
    const { queryByText } = render(<SessionSwitcherView rows={rows} selectedIndex={1} isOpen openDelayMs={0} />)

    expect(queryByText('Switch Between working sessions')).not.toBeNull()
  })
})

describe('SessionSwitcherPopup frozen order', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    useChatStore.setState({ activeProject: null, projectSessions: {}, remoteSessions: {} })
  })

  function dbEntry(sessionId: string, title: string): SessionHistoryEntry {
    return { sessionId, title, lastActiveAt: '0', messageCount: 0 }
  }

  function Harness() {
    const ref = useRef<HTMLDivElement>(null)
    return (
      <div ref={ref} data-scope>
        <SessionSwitcherPopup scopeRef={ref} />
      </div>
    )
  }

  function readVisibleOrder(container: HTMLElement): string[] {
    const rows = container.querySelectorAll<HTMLElement>('[data-row-idx]')
    return Array.from(rows).map((row) => row.querySelector<HTMLElement>('.truncate')?.textContent?.trim() ?? '')
  }

  // Relies on SessionSwitcherPopup mounting useCtrlTabSwitcher with claimWhenUnfocused: true,
  // so jsdom's default body activeElement satisfies the open gate without focusing anything.
  it('keeps row order frozen after popup opens even when a non-current session lastEventAt jumps', () => {
    const project: ProjectState = {
      ...createDefaultProjectState(),
      _activeSessionId: 's1',
      _previousSessionId: null,
      _sessions: {
        s1: makeSession({ ...liveBackground, lastEventAt: 100 }),
        s2: makeSession({ ...liveBackground, lastEventAt: 200 }),
        s3: makeSession({ ...liveBackground, lastEventAt: 300 }),
      },
      sessions: [dbEntry('s1', 'one'), dbEntry('s2', 'two'), dbEntry('s3', 'three')],
    }
    useChatStore.setState({ activeProject: '/p', projectSessions: { '/p': project }, remoteSessions: {} })

    const { container } = render(<Harness />)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    act(() => { vi.advanceTimersByTime(220) })

    const initialOrder = readVisibleOrder(container)
    expect(initialOrder).toEqual(['three', 'two', 'one'])

    act(() => {
      const next: ProjectState = {
        ...project,
        _sessions: {
          ...project._sessions,
          s1: makeSession({ ...liveBackground, lastEventAt: 9999 }),
        },
      }
      useChatStore.setState({ projectSessions: { '/p': next } })
    })

    expect(readVisibleOrder(container)).toEqual(initialOrder)
  })
})
