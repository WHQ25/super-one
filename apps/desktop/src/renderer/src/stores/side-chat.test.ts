/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

const mockLocalStorage = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}

vi.mock('./app', () => ({
  useAppStore: {
    getState: () => ({
      getWorktreeState: () => ({}),
      setActiveWorktree: vi.fn(),
      clearWorktree: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

const startSideChat = vi.fn()
const closeSideChatIpc = vi.fn().mockResolvedValue(true)

const mockWindowApp = {
  startSideChat,
  closeSideChat: closeSideChatIpc,
  loadSessionState: vi.fn().mockResolvedValue(null),
  saveSessionState: vi.fn().mockResolvedValue(undefined),
  listSessionsForFolder: vi.fn().mockResolvedValue([]),
  trace: vi.fn(),
}

const eventTarget = new EventTarget()
vi.stubGlobal('window', {
  app: mockWindowApp,
  agent: { parkSession: vi.fn().mockResolvedValue(undefined) },
  localStorage: mockLocalStorage,
  dispatchEvent: (e: Event) => eventTarget.dispatchEvent(e),
  addEventListener: (t: string, h: EventListenerOrEventListenerObject) => eventTarget.addEventListener(t, h),
  removeEventListener: (t: string, h: EventListenerOrEventListenerObject) => eventTarget.removeEventListener(t, h),
})
vi.stubGlobal('localStorage', mockLocalStorage)

const { useChatStore, createDefaultProjectState, createDefaultPerSessionState } = await import('./chat')
const { openSideChat, closeSideChat, useSideChatStore } = await import('./side-chat')

const PROJECT = '/repo'
const PARENT = 'parent-sid'
const SIDE = 'side-sid'

function seedProject(): void {
  const parent = createDefaultPerSessionState()
  parent.cwd = PROJECT
  parent.sessionProvider = 'codex'
  parent.preferredProvider = 'codex'
  useChatStore.setState({
    activeProject: PROJECT,
    projectSessions: {
      [PROJECT]: { ...createDefaultProjectState(), _activeSessionId: PARENT, _sessions: { [PARENT]: parent } },
    },
    mountedSessions: {},
  })
}

function project() {
  return useChatStore.getState().projectSessions[PROJECT]!
}

beforeEach(() => {
  vi.clearAllMocks()
  closeSideChatIpc.mockResolvedValue(true)
  startSideChat.mockResolvedValue({
    ok: true,
    sessionId: SIDE,
    projectPath: PROJECT,
    cwd: PROJECT,
    harnessId: 'claude',
    providerId: 'claude-base',
    apiProviderId: null,
    acpAgentId: null,
    selectedModel: 'claude-opus-5',
    selectedEffort: 'high',
    agentPreset: null,
  })
  startSideChat.mockClear()
  useSideChatStore.setState({ current: null, confirm: null })
  seedProject()
})

describe('opening a side chat', () => {
  it('leaves the parent as the project active session', async () => {
    await openSideChat(PROJECT, PARENT)

    expect(project()._activeSessionId).toBe(PARENT)
  })

  it('carries the parent harness and its model into the panel row', async () => {
    startSideChat.mockResolvedValue({
      ok: true,
      sessionId: SIDE,
      projectPath: PROJECT,
      cwd: PROJECT,
      harnessId: 'codex',
      providerId: 'codex-base',
      apiProviderId: null,
      acpAgentId: null,
      selectedModel: 'gpt-5-codex',
      selectedEffort: 'high',
    })

    await openSideChat(PROJECT, PARENT)

    const side = project()._sessions[SIDE]!
    expect(side.sessionProvider).toBe('codex')
    // Codex reads its own pair of fields — writing selectedModel alone would
    // leave the picker on the catalog default.
    expect(side.selectedCodexModel).toBe('gpt-5-codex')
    expect(side.selectedCodexReasoningEffort).toBe('high')
    expect(side._sideChatParentId).toBe(PARENT)
  })

  // Regression: `startSideChat` reports the model the MAIN process knows, and
  // that is null until the renderer has pushed one. A conversation left on the
  // catalog default therefore opened a side chat with a blank model, which the
  // composer's "fill in the default" effect then turned into a real, different
  // selection.
  it('falls back to the model the parent shows when the main process reports none', async () => {
    useChatStore.setState((st) => ({
      projectSessions: {
        ...st.projectSessions,
        [PROJECT]: {
          ...st.projectSessions[PROJECT]!,
          _sessions: {
            [PARENT]: {
              ...st.projectSessions[PROJECT]!._sessions[PARENT]!,
              selectedCodexModel: 'gpt-5-codex-high',
              selectedCodexReasoningEffort: 'high',
            },
          },
        },
      },
    }))
    startSideChat.mockResolvedValue({
      ok: true,
      sessionId: SIDE,
      projectPath: PROJECT,
      cwd: PROJECT,
      harnessId: 'codex',
      providerId: 'codex-base',
      apiProviderId: null,
      acpAgentId: null,
      selectedModel: null,
      selectedEffort: null,
    })

    await openSideChat(PROJECT, PARENT)

    const side = project()._sessions[SIDE]!
    expect(side.selectedCodexModel).toBe('gpt-5-codex-high')
    expect(side.selectedCodexReasoningEffort).toBe('high')
  })

  // Regression: `openSideChat` cannot record anything in `current` until the fork
  // round-trip returns, so two calls that start while it is still null both fork
  // and both register. The loser of the race becomes an orphan: its runtime,
  // `_sessions` row and mount survive with no reachable close path, because the
  // tab-removal handler is guarded on an id that no longer matches.
  it('serialises concurrent opens so a double-click cannot strand a second runtime', async () => {
    let n = 0
    startSideChat.mockImplementation(async () => {
      const id = `side-${++n}`
      await new Promise((resolve) => setTimeout(resolve, 0))
      return {
        ok: true,
        sessionId: id,
        projectPath: PROJECT,
        cwd: PROJECT,
        harnessId: 'claude',
        providerId: 'claude-base',
        apiProviderId: null,
        acpAgentId: null,
        selectedModel: 'claude-opus-5',
        selectedEffort: 'high',
        agentPreset: null,
      }
    })

    const [first, second] = await Promise.all([
      openSideChat(PROJECT, PARENT),
      openSideChat(PROJECT, PARENT),
    ])

    expect(first.ok && second.ok).toBe(true)
    // The second open must have torn the first one down on its way in.
    expect(closeSideChatIpc).toHaveBeenCalledWith('side-1')
    const live = useSideChatStore.getState().current!.sessionId
    expect(Object.keys(project()._sessions).filter((id) => id.startsWith('side-'))).toEqual([live])
  })

  it('seeds the dsh preset the fork inherited so the picker does not fall back to the roster head', async () => {
    startSideChat.mockResolvedValue({
      ok: true,
      sessionId: SIDE,
      projectPath: PROJECT,
      cwd: PROJECT,
      harnessId: 'dsh',
      providerId: 'dsh-base',
      apiProviderId: null,
      acpAgentId: null,
      selectedModel: null,
      selectedEffort: null,
      agentPreset: 'research',
    })

    await openSideChat(PROJECT, PARENT)

    expect(project()._sessions[SIDE]!.dshPreset).toBe('research')
  })

  it('is the exemption that matters: an ordinary non-active session is evicted on idle', async () => {
    useChatStore.setState((st) => ({
      projectSessions: {
        ...st.projectSessions,
        [PROJECT]: {
          ...st.projectSessions[PROJECT]!,
          _sessions: { ...st.projectSessions[PROJECT]!._sessions, plain: createDefaultPerSessionState() },
        },
      },
    }))
    const idle: AgentEvent = { type: 'status_change', status: 'idle', sessionId: 'plain', projectPath: PROJECT } as unknown as AgentEvent
    useChatStore.getState().handleAgentEvent(idle)
    expect(project()._sessions.plain).toBeUndefined()
  })

  it('survives an idle event, which evicts ordinary non-active sessions', async () => {
    await openSideChat(PROJECT, PARENT)

    const idle: AgentEvent = { type: 'status_change', status: 'idle', sessionId: SIDE, projectPath: PROJECT } as unknown as AgentEvent
    useChatStore.getState().handleAgentEvent(idle)

    // Without the mounted-session exemption the row is dropped here, and the
    // panel falls back to a default session view — a blank new-session surface.
    expect(project()._sessions[SIDE]).toBeDefined()
  })
})

describe('closing a side chat', () => {
  it('drops the row and its mount', async () => {
    await openSideChat(PROJECT, PARENT)

    await closeSideChat()

    expect(project()._sessions[SIDE]).toBeUndefined()
    expect(useChatStore.getState().mountedSessions[PROJECT] ?? []).not.toContain(SIDE)
    expect(useSideChatStore.getState().current).toBeNull()
  })
})
