/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import type { AccountInfo, ClaudeResources } from '@superone/shared/agent-types'

const localStorageState = new Map<string, string>()
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageState.set(key, value) }),
  removeItem: vi.fn((key: string) => { localStorageState.delete(key) }),
  clear: vi.fn(() => { localStorageState.clear() }),
}

vi.mock('@/stores/app', () => ({
  useAppStore: {
    getState: () => ({
      getWorktreeState: () => ({}),
      setActiveWorktree: vi.fn(),
      clearWorktree: vi.fn().mockResolvedValue(undefined),
      sandboxCapability: { supportLevel: 'always', platform: 'darwin', defaultMode: 'on' },
      sandboxProbe: null,
      probeSandbox: vi.fn(async () => ({ ok: true as const })),
    }),
  },
}))

vi.mock('@/stores/activity-view-state', () => ({
  useActivityViewStateStore: { getState: () => ({ clearForSession: vi.fn(), seedFromCurrent: vi.fn() }) },
}))

vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: {
    trace: vi.fn(),
    getAppSettings: vi.fn().mockResolvedValue({
      analyticsEnabled: true,
      agentPreference: {
        claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
        codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '' },
      },
    }),
  },
  localStorage: mockLocalStorage,
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
})
vi.stubGlobal('localStorage', mockLocalStorage)

// Load the entry first to avoid cyclic TDZ on defaults / types — see agent-defaults.test.ts.
const chatStore = await import('./index')
const { useChatStore } = chatStore
const {
  useActiveSession,
  useIsRemoteLocked,
  useBashOutput,
  selectActiveCodexSkills,
  selectClaudeAccount,
  selectClaudeAgents,
  selectClaudeCommands,
  selectClaudeModels,
  selectClaudeOutputStyles,
  selectClaudeResources,
  selectClaudeSkills,
  selectClaudeSlashCommands,
  selectCodexModels,
  selectCodexPrompts,
  selectCodexResources,
} = await import('./selectors')
const { selectOpenCodeAgents, selectOpenCodeCommands } = await import('./opencode-selectors')
const { createDefaultPerSessionState, createDefaultProjectState } = await import('./defaults')
const { SessionScopeProvider } = await import('./session-scope')

const PATH = '/test-project'

function setupActiveProject(): string {
  const proj = createDefaultProjectState()
  const sid = 'sid-1'
  const sess = createDefaultPerSessionState()
  sess.cwd = PATH
  proj._activeSessionId = sid
  proj._sessions = { [sid]: sess }
  useChatStore.setState({
    projectSessions: { [PATH]: proj },
    activeProject: PATH,
  })
  return sid
}

function setClaude(partial: Partial<ClaudeResources>) {
  useChatStore.getState().setHarnessResources('claude', {
    models: [],
    account: {} as AccountInfo,
    slashCommands: [],
    skills: [],
    commands: [],
    agents: [],
    outputStyles: [],
    ...partial,
  })
}

beforeEach(() => {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    remoteSessions: {},
    _previousFocusedSession: null,
    harnessResources: { claude: null, codex: null, acp: null, opencode: null },
    initializedHarnesses: new Set(),
    _bashOutputs: {},
  })
  mockLocalStorage.clear()
})

describe('useActiveSession', () => {
  it('returns the merged view of the active project + active session', () => {
    const sid = setupActiveProject()
    act(() => {
      useChatStore.setState((s) => ({
        projectSessions: {
          ...s.projectSessions,
          [PATH]: {
            ...s.projectSessions[PATH],
            _sessions: {
              ...s.projectSessions[PATH]._sessions,
              [sid]: { ...s.projectSessions[PATH]._sessions[sid], selectedModel: 'opus-4-8', draftText: 'hi' },
            },
            showDirManager: true,
          },
        },
      }))
    })

    const cwd = renderHook(() => useActiveSession((view) => view.cwd)).result.current
    const draftText = renderHook(() => useActiveSession((view) => view.draftText)).result.current
    const selectedModel = renderHook(() => useActiveSession((view) => view.selectedModel)).result.current
    const showDirManager = renderHook(() => useActiveSession((view) => view.showDirManager)).result.current

    expect(cwd).toBe(PATH)
    expect(draftText).toBe('hi')
    expect(selectedModel).toBe('opus-4-8')
    expect(showDirManager).toBe(true)
  })

  it('returns the defaults when no project is active', () => {
    const cwd = renderHook(() => useActiveSession((view) => view.cwd)).result.current
    const draftText = renderHook(() => useActiveSession((view) => view.draftText)).result.current
    expect(cwd).toBe('')
    expect(draftText).toBe('')
  })

  it('memoizes the merged view across reads when project/session refs stay stable', () => {
    setupActiveProject()
    const refs: unknown[] = []
    renderHook(() => useActiveSession((view) => { refs.push(view); return view.cwd }))
    renderHook(() => useActiveSession((view) => { refs.push(view); return view.cwd }))
    expect(refs[0]).toBe(refs[1])
  })

  it('reads the scoped session over the active one when a SessionScopeProvider wraps the consumer', () => {
    const proj = createDefaultProjectState()
    const activeSess = createDefaultPerSessionState()
    activeSess.draftText = 'active-draft'
    const scopedSess = createDefaultPerSessionState()
    scopedSess.draftText = 'scoped-draft'
    proj._activeSessionId = 'sid-active'
    proj._sessions = { 'sid-active': activeSess, 'sid-scoped': scopedSess }
    useChatStore.setState({ projectSessions: { [PATH]: proj }, activeProject: PATH })

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(SessionScopeProvider, { value: { projectPath: PATH, sessionId: 'sid-scoped' } }, children)

    const scoped = renderHook(() => useActiveSession((view) => view.draftText), { wrapper }).result.current
    const active = renderHook(() => useActiveSession((view) => view.draftText)).result.current

    expect(scoped).toBe('scoped-draft')
    expect(active).toBe('active-draft')
  })

  it('rebuilds the merged view when the per-session reference changes', () => {
    const sid = setupActiveProject()
    const refs: unknown[] = []
    renderHook(() => useActiveSession((view) => { refs.push(view) }))
    act(() => {
      useChatStore.setState((s) => ({
        projectSessions: {
          ...s.projectSessions,
          [PATH]: {
            ...s.projectSessions[PATH],
            _sessions: {
              ...s.projectSessions[PATH]._sessions,
              [sid]: { ...s.projectSessions[PATH]._sessions[sid], draftText: 'updated' },
            },
          },
        },
      }))
    })
    renderHook(() => useActiveSession((view) => { refs.push(view) }))
    expect(refs[refs.length - 1]).not.toBe(refs[0])
    expect((refs[refs.length - 1] as { draftText: string }).draftText).toBe('updated')
  })
})

describe('useIsRemoteLocked', () => {
  it('returns false when no project is active', () => {
    expect(renderHook(() => useIsRemoteLocked()).result.current).toBe(false)
  })

  it('returns false when the active project has no remote sessions', () => {
    setupActiveProject()
    expect(renderHook(() => useIsRemoteLocked()).result.current).toBe(false)
  })

  it('returns true when the active session id is registered as remote', () => {
    const sid = setupActiveProject()
    act(() => {
      useChatStore.setState({ remoteSessions: { [PATH]: [sid] } })
    })
    expect(renderHook(() => useIsRemoteLocked()).result.current).toBe(true)
  })
})

describe('useBashOutput', () => {
  it('returns undefined for an unknown tool use id', () => {
    expect(renderHook(() => useBashOutput('ghost')).result.current).toBeUndefined()
  })

  it('returns the recorded bash output entry', () => {
    act(() => {
      useChatStore.setState({
        _bashOutputs: { 'tool-1': { content: 'hello\n', finished: false, outputPath: '/tmp/x' } },
      })
    })
    expect(renderHook(() => useBashOutput('tool-1')).result.current).toEqual({ content: 'hello\n', finished: false, outputPath: '/tmp/x' })
  })
})

describe('Claude resource selectors', () => {
  it('return null / empty defaults when claude resources are not loaded', () => {
    const state = useChatStore.getState()
    expect(selectClaudeResources(state)).toBeNull()
    expect(selectClaudeModels(state)).toEqual([])
    expect(selectClaudeAccount(state)).toEqual({})
    expect(selectClaudeSlashCommands(state)).toEqual([])
    expect(selectClaudeSkills(state)).toEqual([])
    expect(selectClaudeCommands(state)).toEqual([])
    expect(selectClaudeAgents(state)).toEqual([])
    expect(selectClaudeOutputStyles(state)).toEqual([])
  })

  it('return the live claude resources once loaded', () => {
    setClaude({
      models: [{ id: 'opus-4-8', name: 'Opus', description: '' }],
      account: { subscriptionType: 'Claude Max' } as AccountInfo,
      slashCommands: [{ name: 'reset' } as never],
      skills: [{ name: 's1' } as never],
      commands: [{ name: 'c1' } as never],
      agents: [{ name: 'a1' } as never],
      outputStyles: ['styleA'],
    })
    const state = useChatStore.getState()
    expect(selectClaudeModels(state).map((m) => m.id)).toEqual(['opus-4-8'])
    expect(selectClaudeAccount(state).subscriptionType).toBe('Claude Max')
    expect(selectClaudeSlashCommands(state)[0]?.name).toBe('reset')
    expect(selectClaudeSkills(state)[0]?.name).toBe('s1')
    expect(selectClaudeCommands(state)[0]?.name).toBe('c1')
    expect(selectClaudeAgents(state)[0]?.name).toBe('a1')
    expect(selectClaudeOutputStyles(state)).toEqual(['styleA'])
  })

  it('returns the same empty-array reference across calls so selector equality stays stable', () => {
    const state = useChatStore.getState()
    expect(selectClaudeModels(state)).toBe(selectClaudeModels(state))
    expect(selectClaudeAgents(state)).toBe(selectClaudeAgents(state))
  })

  it('uses project.claudeModels for remote projects and ignores desktop harness cache', () => {
    setClaude({
      models: [{ id: 'local-only', name: 'Local', description: '' }],
      account: {},
      slashCommands: [],
      skills: [],
      commands: [],
      agents: [],
      outputStyles: [],
    })
    const remotePath = 'remote:lab-1:/workspace/app'
    act(() => {
      useChatStore.setState({
        activeProject: remotePath,
        projectSessions: {
          [remotePath]: {
            ...createDefaultProjectState(),
            claudeModels: [{ id: 'node-sonnet', name: 'Node Sonnet', description: '' }],
          },
        },
      })
    })
    const state = useChatStore.getState()
    expect(selectClaudeModels(state).map((m) => m.id)).toEqual(['node-sonnet'])
    expect(state.harnessResources.claude?.models.map((m) => m.id)).toEqual(['local-only'])
  })
})

describe('Codex resource selectors', () => {
  it('return null / empty defaults when codex resources are not loaded', () => {
    const state = useChatStore.getState()
    expect(selectCodexResources(state)).toBeNull()
    expect(selectCodexModels(state)).toEqual([])
    expect(selectCodexPrompts(state)).toEqual([])
  })

  it('return live codex resources once loaded', () => {
    useChatStore.getState().setHarnessResources('codex', {
      models: [{ id: 'gpt-5-high', name: 'GPT-5', description: '' }],
      prompts: [{ name: 'p1' } as never],
    })
    const state = useChatStore.getState()
    expect(selectCodexModels(state)[0]?.id).toBe('gpt-5-high')
    expect(selectCodexPrompts(state)[0]?.name).toBe('p1')
  })

  it('uses project.codexModels for remote projects and ignores desktop harness cache', () => {
    useChatStore.getState().setHarnessResources('codex', {
      models: [{ id: 'local-gpt', name: 'Local', description: '' }],
      prompts: [],
    })
    const remotePath = 'remote:lab-1:/workspace/app'
    act(() => {
      useChatStore.setState({
        activeProject: remotePath,
        projectSessions: {
          [remotePath]: {
            ...createDefaultProjectState(),
            codexModels: [{ id: 'node-gpt', name: 'Node GPT', description: '' }],
          },
        },
      })
    })
    const state = useChatStore.getState()
    expect(selectCodexModels(state).map((m) => m.id)).toEqual(['node-gpt'])
  })

  it('selectActiveCodexSkills returns [] when no project is active', () => {
    expect(selectActiveCodexSkills(useChatStore.getState())).toEqual([])
  })

  it('selectActiveCodexSkills returns the project-scoped codex skills when a project is active', () => {
    setupActiveProject()
    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        [PATH]: { ...s.projectSessions[PATH], _codexSkills: [{ name: 'codex-skill-1' } as never] },
      },
    }))
    expect(selectActiveCodexSkills(useChatStore.getState())[0]?.name).toBe('codex-skill-1')
  })
})

describe('OpenCode resource selectors', () => {
  it('return stable empty defaults when OpenCode resources are not loaded', () => {
    const state = useChatStore.getState()

    expect(renderHook(() => useChatStore(selectOpenCodeCommands)).result.current).toEqual([])
    expect(renderHook(() => useChatStore(selectOpenCodeAgents)).result.current).toEqual([])
    expect(selectOpenCodeCommands(state)).toEqual([])
    expect(selectOpenCodeAgents(state)).toEqual([])
    expect(selectOpenCodeCommands(state)).toBe(selectOpenCodeCommands(state))
    expect(selectOpenCodeAgents(state)).toBe(selectOpenCodeAgents(state))
  })

  it('return live OpenCode resources once loaded', () => {
    useChatStore.getState().setHarnessResources('opencode', {
      models: [],
      commands: [{ name: 'help' } as never],
      agents: [{ id: 'build', name: 'Build' }],
    })
    const state = useChatStore.getState()

    expect(selectOpenCodeCommands(state)[0]?.name).toBe('help')
    expect(selectOpenCodeAgents(state)[0]?.id).toBe('build')
  })
})
