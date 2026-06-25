/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChatMessage, ClaudeResources, CodexResources, ModelOption } from '@superone/shared/agent-types'

const mockSetActiveWorktree = vi.fn()
const mockClearWorktree = vi.fn().mockResolvedValue(undefined)
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
      getWorktreeState: () => ({ pendingBaseBranch: null }),
      setActiveWorktree: mockSetActiveWorktree,
      clearWorktree: mockClearWorktree,
      sandboxCapability: { supportLevel: 'always', platform: 'darwin', defaultMode: 'on' },
      sandboxProbe: null,
      probeSandbox: vi.fn(async () => ({ ok: true as const })),
    }),
  },
}))

const mockSeedFromCurrent = vi.fn()
const mockClearForSession = vi.fn()
vi.mock('@/stores/activity-view-state', () => ({
  useActivityViewStateStore: { getState: () => ({ seedFromCurrent: mockSeedFromCurrent, clearForSession: mockClearForSession }) },
}))

const mockMiniAppStore: { openApps: Record<string, unknown>; apps: Array<{ id: string }> } = {
  openApps: {},
  apps: [],
}
vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: { getState: () => mockMiniAppStore, setState: vi.fn() },
}))

const mockWindowAgent = {
  prewarm: vi.fn().mockResolvedValue(undefined),
  resetSession: vi.fn().mockResolvedValue({ permissionMode: 'default', sandboxInfo: { enabled: false, autoAllowBash: false } }),
  parkSession: vi.fn().mockResolvedValue({ permissionMode: 'default', sandboxInfo: { enabled: false, autoAllowBash: false } }),
  disconnectRemoteSession: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
  interrupt: vi.fn().mockResolvedValue(true),
  setSessionSettings: vi.fn().mockResolvedValue(undefined),
}

const mockWindowApp = {
  trace: vi.fn(),
  unwatchBashOutput: vi.fn(),
  loadSessionState: vi.fn().mockResolvedValue(null),
  resumeSession: vi.fn().mockResolvedValue(null),
  listSessionsForFolderPage: vi.fn().mockResolvedValue([]),
  getAppSettings: vi.fn().mockResolvedValue({
    analyticsEnabled: true,
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultModel: '', defaultReasoningEffort: '' },
    },
  }),
  connectClaude: vi.fn().mockResolvedValue({
    models: [], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [],
  }),
  connectCodex: vi.fn().mockResolvedValue({ models: [], prompts: [] }),
}

const mockMiniApp = { authorize: vi.fn().mockResolvedValue(undefined) }

const eventTarget = new EventTarget()
vi.stubGlobal('window', {
  agent: mockWindowAgent,
  app: mockWindowApp,
  miniapp: mockMiniApp,
  localStorage: mockLocalStorage,
  dispatchEvent: (e: Event) => eventTarget.dispatchEvent(e),
  addEventListener: (t: string, h: EventListenerOrEventListenerObject) => eventTarget.addEventListener(t, h),
  removeEventListener: (t: string, h: EventListenerOrEventListenerObject) => eventTarget.removeEventListener(t, h),
})
vi.stubGlobal('localStorage', mockLocalStorage)

const { useChatStore } = await import('../index')
const { defaultPrefsCache } = await import('./prefs-cache')

const PATH = '/p-test'

function resetStore() {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    remoteSessions: {},
    _previousFocusedSession: null,
    harnessResources: { claude: null, codex: null },
    initializedHarnesses: new Set(),
    _bashOutputs: {},
  })
}

function setCodexResources(partial: Partial<CodexResources>) {
  useChatStore.getState().setHarnessResources('codex', { models: [], prompts: [], ...partial })
}

function setClaudeResources(partial: Partial<ClaudeResources>) {
  useChatStore.getState().setHarnessResources('claude', {
    models: [], account: {} as never, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [],
    ...partial,
  })
}

function setupProject(path: string = PATH) {
  useChatStore.getState().ensureSession(path)
  useChatStore.setState({ activeProject: path })
}

function patchSession(patch: Record<string, unknown>, path: string = PATH) {
  const state = useChatStore.getState()
  const proj = state.projectSessions[path]
  const sid = proj._activeSessionId!
  useChatStore.setState({
    projectSessions: {
      ...state.projectSessions,
      [path]: {
        ...proj,
        _sessions: { ...proj._sessions, [sid]: { ...proj._sessions[sid], ...patch } },
      },
    },
  })
}

function activeProjectState(path: string = PATH) {
  return useChatStore.getState().projectSessions[path]
}

function activeSession(path: string = PATH) {
  const proj = activeProjectState(path)
  return proj._sessions[proj._activeSessionId!]
}

function userMsg(id: string, providerId: 'claude' | 'codex' = 'claude'): ChatMessage {
  return { id, role: 'user', status: 'complete', content: [], createdAt: '', providerId }
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  mockLocalStorage.clear()
  defaultPrefsCache.permissionMode = null
  defaultPrefsCache.sandboxMode = null
  defaultPrefsCache.claudeSelection = null
  defaultPrefsCache.codexSelection = null
})

describe('resetSessionImpl', () => {
  it('is a no-op on a pristine idle session (no messages, no worktree, not remote)', async () => {
    setupProject()
    const beforeSid = activeProjectState()._activeSessionId

    await useChatStore.getState().resetSession()

    expect(activeProjectState()._activeSessionId).toBe(beforeSid)
    expect(mockWindowAgent.resetSession).not.toHaveBeenCalled()
    expect(mockWindowAgent.parkSession).not.toHaveBeenCalled()
    expect(mockClearWorktree).not.toHaveBeenCalled()
  })

  it('mints a codex_local_ prefixed sid when the session provider is codex', async () => {
    setupProject()
    patchSession({
      sessionProvider: 'codex',
      preferredProvider: 'codex',
      messages: [userMsg('u1', 'codex')],
    })
    const oldSid = activeProjectState()._activeSessionId

    await useChatStore.getState().resetSession()

    const newSid = activeProjectState()._activeSessionId
    expect(newSid).not.toBe(oldSid)
    expect(newSid?.startsWith('codex_local_')).toBe(true)
    expect(activeSession().sessionProvider).toBe('codex')
  })

  it('mints a uuid-style sid for claude provider sessions', async () => {
    setupProject()
    patchSession({
      sessionProvider: 'claude',
      preferredProvider: 'claude',
      messages: [userMsg('u1', 'claude')],
    })
    const oldSid = activeProjectState()._activeSessionId

    await useChatStore.getState().resetSession()

    const newSid = activeProjectState()._activeSessionId!
    expect(newSid).not.toBe(oldSid)
    expect(newSid.startsWith('codex_local_')).toBe(false)
    expect(newSid).toMatch(/^[0-9a-f-]{36}$/)
    expect(mockWindowAgent.resetSession).toHaveBeenCalledWith(oldSid, newSid)
    expect(mockClearWorktree).toHaveBeenCalledWith(PATH)
  })
})

describe('resetSessionForWorktreeSwitchImpl', () => {
  it('creates a fresh session bound to the supplied wtPath + gitBranch', () => {
    setupProject()
    useChatStore.getState().resetSessionForWorktreeSwitch(PATH, { wtPath: '/wt', gitBranch: 'feat' })

    const sess = activeSession()
    expect(sess.cwd).toBe('/wt')
    expect(sess._worktreePath).toBe('/wt')
    expect(sess._gitBranch).toBe('feat')
    expect(mockSeedFromCurrent).toHaveBeenCalledTimes(1)
  })

  it('applies defaultPrefsCache.permissionMode when set', () => {
    setupProject()
    defaultPrefsCache.permissionMode = 'plan'

    useChatStore.getState().resetSessionForWorktreeSwitch(PATH, { wtPath: '/wt2', gitBranch: null })

    expect(activeSession().permissionMode).toBe('plan')
    expect(activeSession()._worktreePath).toBe('/wt2')
    expect(activeSession()._gitBranch).toBeNull()
  })

  it('inherits the codex provider from the current session instead of defaulting to claude', () => {
    setupProject()
    patchSession({ sessionProvider: 'codex', preferredProvider: 'codex', messages: [userMsg('u1', 'codex')] })

    useChatStore.getState().resetSessionForWorktreeSwitch(PATH, { wtPath: '/wt', gitBranch: 'feat' })

    const sess = activeSession()
    expect(sess.preferredProvider).toBe('codex')
    expect(sess.sessionProvider).toBe('codex')
    expect(activeProjectState()._activeSessionId?.startsWith('codex_local_')).toBe(true)
  })

  it('keeps claude for a claude-provider session', () => {
    setupProject()
    patchSession({ sessionProvider: 'claude', preferredProvider: 'claude', messages: [userMsg('u1', 'claude')] })

    useChatStore.getState().resetSessionForWorktreeSwitch(PATH, { wtPath: '/wt', gitBranch: null })

    const sess = activeSession()
    expect(sess.preferredProvider).toBe('claude')
    expect(activeProjectState()._activeSessionId?.startsWith('codex_local_')).toBe(false)
  })
})

describe('setPreferredProviderImpl', () => {
  it('is a no-op when sessionProvider already matches the requested provider', () => {
    setupProject()
    patchSession({ sessionProvider: 'claude', preferredProvider: 'claude' })
    const beforeSid = activeProjectState()._activeSessionId

    useChatStore.getState().setPreferredProvider('claude')

    expect(activeProjectState()._activeSessionId).toBe(beforeSid)
    expect(mockSeedFromCurrent).not.toHaveBeenCalled()
  })

  it('switches to codex by rotating to a fresh codex_local_ sid on an empty draft', () => {
    setupProject()
    setCodexResources({
      models: [{ id: 'gpt-5-high', name: 'GPT-5', description: '', isDefault: true } as ModelOption],
    })
    const oldSid = activeProjectState()._activeSessionId

    useChatStore.getState().setPreferredProvider('codex')

    const newSid = activeProjectState()._activeSessionId
    expect(newSid).not.toBe(oldSid)
    expect(newSid?.startsWith('codex_local_')).toBe(true)
    expect(activeSession().sessionProvider).toBe('codex')
    expect(activeSession().preferredProvider).toBe('codex')
    expect(mockSeedFromCurrent).toHaveBeenCalledWith(newSid)
  })
})

describe('clearMessagesImpl', () => {
  it('resets per-session state, frees subagent colors, and unwatches only this session\'s bash outputs', () => {
    setupProject()
    setupProject('/p-other')
    // make /p-test the active project
    useChatStore.setState({ activeProject: PATH })

    patchSession({
      messages: [{
        id: 'm1', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude',
        content: [
          { type: 'tool_use', toolUseId: 't-bash-1', toolName: 'BashOutput', input: '' } as never,
          { type: 'tool_use', toolUseId: 't-bash-2', toolName: 'BashOutput', input: '' } as never,
        ],
      }],
      totalCostUsd: 4.2,
      contextTokens: 1234,
      todos: { 1: { id: 1, content: 'x', status: 'pending' } as never },
      subagentColors: { agent1: 0 },
      _subagentColorsFree: [1, 2, 3],
    })
    useChatStore.setState({
      _bashOutputs: {
        't-bash-1': { content: 'hello', finished: false, outputPath: '/o1' },
        't-bash-2': { content: 'world', finished: true },
        't-other-session': { content: 'keep me', finished: false },
      },
    })

    useChatStore.getState().clearMessages()

    const sess = activeSession()
    expect(sess.messages).toEqual([])
    expect(sess.totalCostUsd).toBe(0)
    expect(sess.contextTokens).toBe(0)
    expect(sess.todos).toEqual({})
    expect(sess.subagentColors).toEqual({})
    expect(sess._subagentColorsFree.length).toBeGreaterThan(0)

    expect(mockWindowApp.unwatchBashOutput).toHaveBeenCalledWith('t-bash-1')
    expect(mockWindowApp.unwatchBashOutput).toHaveBeenCalledWith('t-bash-2')
    expect(mockWindowApp.unwatchBashOutput).toHaveBeenCalledTimes(2)

    const remaining = useChatStore.getState()._bashOutputs
    expect(remaining['t-bash-1']).toBeUndefined()
    expect(remaining['t-bash-2']).toBeUndefined()
    expect(remaining['t-other-session']).toBeDefined()
  })

  it('is a no-op when there is no active project', () => {
    useChatStore.getState().clearMessages()
    expect(mockWindowApp.unwatchBashOutput).not.toHaveBeenCalled()
  })
})

describe('disconnectRemoteSessionImpl', () => {
  it('clears the active remote session id from remoteSessions and dispatches IPC', () => {
    setupProject()
    const sid = activeProjectState()._activeSessionId!
    useChatStore.setState({ remoteSessions: { [PATH]: [sid] } })

    useChatStore.getState().disconnectRemoteSession()

    expect(mockWindowAgent.disconnectRemoteSession).toHaveBeenCalledWith(sid)
    expect(useChatStore.getState().remoteSessions).toEqual({})
  })
})
