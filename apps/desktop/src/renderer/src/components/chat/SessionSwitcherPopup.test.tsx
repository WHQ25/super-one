/** @vitest-environment jsdom */

import { useRef } from 'react'
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { collectAllActiveRows, SessionSwitcherPopup, SessionSwitcherView, type SwitcherRow } from './SessionSwitcherPopup'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore, type ProjectState, type PerSessionState } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
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

interface CollectArgs {
  projects: Record<string, ProjectState>
  active: string | null
  previous?: { projectPath: string; sessionId: string } | null
  remote?: Record<string, ReadonlyArray<string>>
}

function collect({ projects, active, previous = null, remote = {} }: CollectArgs) {
  return collectAllActiveRows({
    projectSessions: projects,
    remoteSessions: remote,
    activeProject: active,
    previousFocusedSession: previous,
  })
}

const liveStreaming: Partial<PerSessionState> = { status: 'streaming', awaitingAssistantReply: true, _historyHydrated: true, lastEventAt: 1000 }
const liveBackground: Partial<PerSessionState> = { status: 'background', _historyHydrated: true, lastEventAt: 500 }
const idleHydrated: Partial<PerSessionState> = { status: 'idle', _historyHydrated: true, lastEventAt: 100 }

describe('collectAllActiveRows', () => {
  it('inserts an idle previous session right after the current row', () => {
    const project = makeProject({
      active: 's1',
      sessions: {
        s1: liveBackground,
        s2: idleHydrated,
      },
    })

    const rows = collect({
      projects: { '/p': project },
      active: '/p',
      previous: { projectPath: '/p', sessionId: 's2' },
    })

    expect(rows.map((r) => r.sessionId)).toEqual(['s1', 's2'])
    expect(rows[0].isCurrent).toBe(true)
    expect(rows[1].isPrevious).toBe(true)
  })

  it('moves an already-active previous session into the slot after current', () => {
    const project = makeProject({
      active: 's1',
      sessions: {
        s1: { ...liveStreaming, lastEventAt: 1000 },
        s2: { ...liveBackground, lastEventAt: 800 },
        s3: { ...liveBackground, lastEventAt: 500 },
      },
    })

    const rows = collect({
      projects: { '/p': project },
      active: '/p',
      previous: { projectPath: '/p', sessionId: 's3' },
    })

    expect(rows.map((r) => r.sessionId)).toEqual(['s1', 's3', 's2'])
    expect(rows[1].isPrevious).toBe(true)
  })

  it('does not insert the previous session when it has no in-memory entry', () => {
    const project = makeProject({
      active: 's1',
      sessions: {
        s1: liveBackground,
      },
    })

    const rows = collect({
      projects: { '/p': project },
      active: '/p',
      previous: { projectPath: '/p', sessionId: 'gone-from-memory' },
    })

    expect(rows.map((r) => r.sessionId)).toEqual(['s1'])
    expect(rows.some((r) => r.isPrevious)).toBe(false)
  })

  it('does nothing special when previous equals current', () => {
    const project = makeProject({
      active: 's1',
      sessions: { s1: liveBackground },
    })

    const rows = collect({
      projects: { '/p': project },
      active: '/p',
      previous: { projectPath: '/p', sessionId: 's1' },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].isPrevious).toBe(false)
  })

  it('sorts active sessions by lastEventAt desc and pins current to slot 0', () => {
    const project = makeProject({
      active: 's-old',
      sessions: {
        's-old': { ...liveBackground, lastEventAt: 100 },
        's-new': { ...liveStreaming, lastEventAt: 1000 },
        's-mid': { ...liveBackground, lastEventAt: 500 },
      },
    })

    const rows = collect({
      projects: { '/p': project },
      active: '/p',
    })

    expect(rows.map((r) => r.sessionId)).toEqual(['s-old', 's-new', 's-mid'])
    expect(rows[0].isCurrent).toBe(true)
  })

  it('skips sessions with no messages and no history hydration', () => {
    const project = makeProject({
      active: null,
      sessions: {
        empty: { ...liveBackground, _historyHydrated: false, messages: [] },
        ready: liveBackground,
      },
    })

    const rows = collect({
      projects: { '/p': project },
      active: '/p',
    })

    expect(rows.map((r) => r.sessionId)).toEqual(['ready'])
  })

  it('flags remote sessions correctly based on each session’s own project', () => {
    const project = makeProject({
      active: null,
      sessions: { remote1: liveBackground, local1: liveBackground },
    })

    const rows = collect({
      projects: { '/p': project },
      active: '/p',
      remote: { '/p': ['remote1'] },
    })

    const remote = rows.find((r) => r.sessionId === 'remote1')!
    const local = rows.find((r) => r.sessionId === 'local1')!
    expect(remote.isRemote).toBe(true)
    expect(local.isRemote).toBe(false)
  })

  it('collects sessions from every project, not just the active one', () => {
    const projectA = makeProject({
      active: 'a1',
      sessions: {
        a1: { ...liveStreaming, lastEventAt: 2000 },
        a2: { ...liveBackground, lastEventAt: 1500 },
      },
    })
    const projectB = makeProject({
      active: 'b1',
      sessions: {
        b1: { ...liveBackground, lastEventAt: 1800 },
        b2: { ...liveBackground, lastEventAt: 800 },
      },
    })

    const rows = collect({
      projects: { '/a': projectA, '/b': projectB },
      active: '/a',
    })

    expect(rows.map((r) => r.sessionId).sort()).toEqual(['a1', 'a2', 'b1', 'b2'])
    expect(rows[0].sessionId).toBe('a1')
    expect(rows[0].isCurrent).toBe(true)
    const remainder = rows.slice(1).map((r) => r.sessionId)
    expect(remainder).toEqual(['b1', 'a2', 'b2'])
  })

  it('treats previous tuple as global across projects', () => {
    const projectA = makeProject({
      active: 'a1',
      sessions: { a1: { ...liveStreaming, lastEventAt: 2000 } },
    })
    const projectB = makeProject({
      active: 'b1',
      sessions: {
        b1: { ...liveBackground, lastEventAt: 1500 },
        b2: { ...idleHydrated, lastEventAt: 50 },
      },
    })

    const rows = collect({
      projects: { '/a': projectA, '/b': projectB },
      active: '/a',
      previous: { projectPath: '/b', sessionId: 'b2' },
    })

    expect(rows[0]).toMatchObject({ projectPath: '/a', sessionId: 'a1', isCurrent: true })
    expect(rows[1]).toMatchObject({ projectPath: '/b', sessionId: 'b2', isPrevious: true })
  })

  it('pins the current row even when it is idle and not the previous tuple', () => {
    const project = makeProject({
      active: 's-idle-current',
      sessions: {
        's-idle-current': idleHydrated,
        's-active': liveBackground,
      },
    })

    const rows = collect({
      projects: { '/p': project },
      active: '/p',
    })

    const current = rows.find((r) => r.isCurrent)!
    expect(current.sessionId).toBe('s-idle-current')
    expect(rows.map((r) => r.sessionId)).toContain('s-active')
  })

  it('pins the current row even when it is a brand-new draft (empty messages, not yet hydrated)', () => {
    const project = makeProject({
      active: 's-draft',
      sessions: {
        's-draft': { status: 'idle', messages: [], _historyHydrated: false, lastEventAt: 0 },
        's-active': liveBackground,
      },
    })

    const rows = collect({
      projects: { '/p': project },
      active: '/p',
    })

    expect(rows[0]).toMatchObject({ sessionId: 's-draft', isCurrent: true })
  })

  it('pins the previous row even when it is an unhydrated stub (covers B1 hydration race)', () => {
    const projectA = makeProject({
      active: 'a-active',
      sessions: { 'a-active': liveBackground },
    })
    const projectB = makeProject({
      active: 'b-current',
      sessions: {
        'b-current': liveBackground,
        'b-stub': { status: 'idle', messages: [], _historyHydrated: false, lastEventAt: 0 },
      },
    })

    const rows = collect({
      projects: { '/a': projectA, '/b': projectB },
      active: '/b',
      previous: { projectPath: '/b', sessionId: 'b-stub' },
    })

    const previous = rows.find((r) => r.isPrevious)!
    expect(previous).toMatchObject({ projectPath: '/b', sessionId: 'b-stub' })
  })

  it('marks isCurrent only on the active project’s active session, not on same-id sessions in other projects', () => {
    const projectA = makeProject({
      active: 'shared-id',
      sessions: { 'shared-id': liveBackground },
    })
    const projectB = makeProject({
      active: 'shared-id',
      sessions: { 'shared-id': liveBackground },
    })

    const rows = collect({
      projects: { '/a': projectA, '/b': projectB },
      active: '/a',
    })

    const aRow = rows.find((r) => r.projectPath === '/a')!
    const bRow = rows.find((r) => r.projectPath === '/b')!
    expect(aRow.isCurrent).toBe(true)
    expect(bRow.isCurrent).toBe(false)
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
      projectPath: '/p',
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
      provider: 'claude',
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
    useChatStore.setState({ activeProject: null, projectSessions: {}, remoteSessions: {}, _previousFocusedSession: null })
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
    // Current row ('s1' a.k.a. "one") is pinned to slot 0, the rest follow by lastEventAt desc.
    expect(initialOrder).toEqual(['one', 'three', 'two'])

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

describe('SessionSwitcherPopup commit routing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    useChatStore.setState({ activeProject: null, projectSessions: {}, remoteSessions: {}, _previousFocusedSession: null })
  })

  function Harness() {
    const ref = useRef<HTMLDivElement>(null)
    return (
      <div ref={ref} data-scope>
        <SessionSwitcherPopup scopeRef={ref} />
      </div>
    )
  }

  it('routes a cross-project commit through useAppStore.switchToProject so sidebar selection stays in sync', async () => {
    const projectA: ProjectState = {
      ...createDefaultProjectState(),
      _activeSessionId: 'a1',
      _sessions: { a1: makeSession({ ...liveBackground, lastEventAt: 2000 }) },
    }
    const projectB: ProjectState = {
      ...createDefaultProjectState(),
      _activeSessionId: 'b1',
      _sessions: { b1: makeSession({ ...liveBackground, lastEventAt: 1000 }) },
    }
    useChatStore.setState({
      activeProject: '/a',
      projectSessions: { '/a': projectA, '/b': projectB },
      remoteSessions: {},
      _previousFocusedSession: { projectPath: '/b', sessionId: 'b1' },
    })

    const switchToProjectMock = vi.fn().mockResolvedValue(undefined)
    const switchSessionMock = vi.fn().mockResolvedValue(undefined)
    const switchProjectMock = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ switchToProject: switchToProjectMock })
    useChatStore.setState({ switchSession: switchSessionMock, switchProject: switchProjectMock })

    render(<Harness />)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    act(() => { vi.advanceTimersByTime(220) })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true, cancelable: true }))
    })
    await act(async () => { await Promise.resolve() })

    expect(switchToProjectMock).toHaveBeenCalledWith('/b')
    // Cross-project path must NOT call useChatStore.switchProject directly — that would skip sidebar sync.
    expect(switchProjectMock).not.toHaveBeenCalled()
  })

  it('routes a same-project commit through useChatStore.switchSession only (no project hop)', async () => {
    const project: ProjectState = {
      ...createDefaultProjectState(),
      _activeSessionId: 's1',
      _sessions: {
        s1: makeSession({ ...liveBackground, lastEventAt: 2000 }),
        s2: makeSession({ ...liveBackground, lastEventAt: 1000 }),
      },
    }
    useChatStore.setState({
      activeProject: '/p',
      projectSessions: { '/p': project },
      remoteSessions: {},
      _previousFocusedSession: { projectPath: '/p', sessionId: 's2' },
    })

    const switchToProjectMock = vi.fn().mockResolvedValue(undefined)
    const switchSessionMock = vi.fn().mockResolvedValue(undefined)
    useAppStore.setState({ switchToProject: switchToProjectMock })
    useChatStore.setState({ switchSession: switchSessionMock })

    render(<Harness />)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    act(() => { vi.advanceTimersByTime(220) })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true, cancelable: true }))
    })
    await act(async () => { await Promise.resolve() })

    expect(switchSessionMock).toHaveBeenCalledWith('s2')
    expect(switchToProjectMock).not.toHaveBeenCalled()
  })
})
