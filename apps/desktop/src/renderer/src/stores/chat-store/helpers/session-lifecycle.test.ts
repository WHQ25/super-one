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
  setSessionForeground: vi.fn().mockResolvedValue(undefined),
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
      codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '' },
      acp: { selectedAgentId: null },
    },
  }),
  saveAppSettings: vi.fn().mockResolvedValue(undefined),
  connectClaude: vi.fn().mockResolvedValue({
    models: [], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [],
  }),
  connectCodex: vi.fn().mockResolvedValue({ models: [], prompts: [] }),
  listAcpAgents: vi.fn().mockResolvedValue({ agents: [], selectedAgentId: null, modelsByAgentId: {} }),
  refreshAcpModels: vi.fn().mockResolvedValue({ agents: [], selectedAgentId: null, modelsByAgentId: {} }),
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
    harnessResources: { claude: null, codex: null, acp: null },
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

/** Seed harness ACP cache with Grok models + effort modes (configByAgentId path). */
function seedGrokAcpCache(opts?: { selectedAgentId?: string | null }) {
  useChatStore.setState((s) => ({
    harnessResources: {
      ...s.harnessResources,
      acp: {
        agents: [
          { id: 'grok-build', name: 'Grok Build', installed: true, commandPreview: 'grok agent stdio' },
        ],
        selectedAgentId: opts?.selectedAgentId ?? 'grok-build',
        modelsByAgentId: {},
        configByAgentId: {
          'grok-build': {
            configOptions: [],
            extraModels: [
              { id: 'grok-4.5', name: 'Grok 4.5', description: '' },
              { id: 'grok-4.20', name: 'Grok 4.20', description: '' },
            ],
            selectedModelId: 'grok-4.5',
            modelConfigId: null,
            extraModes: [
              { id: 'low', name: 'Low', description: '' },
              { id: 'high', name: 'High', description: '' },
            ],
            selectedModeId: 'high',
            modeConfigId: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    },
  }))
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

describe('focusProjectImpl', () => {
  it('does not resume a remote node session through the local SessionManager', async () => {
    const remotePath = 'remote:env-1:/work/project'
    useChatStore.getState().ensureSession(remotePath)

    await useChatStore.getState().focusProject(remotePath)

    expect(useChatStore.getState().activeProject).toBe(remotePath)
    expect(mockWindowApp.resumeSession).not.toHaveBeenCalled()
  })

  it('mints a UI draft session for remote projects so model/provider prefs stick', () => {
    const remotePath = 'remote:env-1:/work/project'
    useChatStore.getState().ensureSession(remotePath)

    const proj = useChatStore.getState().projectSessions[remotePath]
    expect(proj).toBeTruthy()
    // UI draft is required so model/provider prefs stick; first send materializes
    // a real node session via resolveNodeSessionId (does not session.send the draft id).
    expect(proj._activeSessionId).toBeTruthy()
    expect(Object.keys(proj._sessions)).toHaveLength(1)
  })

  it('continues resuming local sessions when focusing a local project', async () => {
    useChatStore.getState().ensureSession(PATH)
    const sessionId = activeProjectState()._activeSessionId

    await useChatStore.getState().focusProject(PATH)

    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith(PATH, sessionId, PATH)
  })
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

  it('mints a uuid-style sid when the session provider is codex', async () => {
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
    expect(newSid).toMatch(/^[0-9a-f-]{36}$/)
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
    expect(newSid).toMatch(/^[0-9a-f-]{36}$/)
    expect(mockWindowAgent.resetSession).toHaveBeenCalledWith(oldSid, newSid)
    expect(mockClearWorktree).toHaveBeenCalledWith(PATH)
    // Do not fork activity dock layout (shared terminal/browser panel ids).
    expect(mockSeedFromCurrent).not.toHaveBeenCalled()
  })

  it('hydrates Grok models from ACP cache when creating a new session from an old Grok session', async () => {
    setupProject()
    seedGrokAcpCache()
    // Claude catalog is usually warm; ensure it cannot overwrite the Grok selection.
    setClaudeResources({
      models: [
        { id: 'claude-sonnet-4', name: 'Sonnet', description: '', isDefault: true } as ModelOption,
      ],
    })
    patchSession({
      sessionProvider: 'acp',
      preferredProvider: 'acp',
      acpAgentId: 'grok-build',
      selectedModel: 'grok-4.5',
      acpModels: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
      acpModelsStatus: 'ready',
      acpModes: [
        { id: 'low', name: 'Low', description: '' },
        { id: 'high', name: 'High', description: '' },
      ],
      acpModeConfigId: null,
      selectedAcpModeId: 'high',
      acpModesStatus: 'ready',
      messages: [userMsg('u1', 'claude')],
    })
    const oldSid = activeProjectState()._activeSessionId

    await useChatStore.getState().resetSession()

    const newSid = activeProjectState()._activeSessionId
    expect(newSid).not.toBe(oldSid)
    const sess = activeSession()
    expect(sess.sessionProvider).toBe('acp')
    expect(sess.preferredProvider).toBe('acp')
    expect(sess.acpAgentId).toBe('grok-build')
    expect(sess.acpModels.map((m) => m.id)).toEqual(['grok-4.5', 'grok-4.20'])
    expect(sess.selectedModel).toBe('grok-4.5')
    expect(sess.selectedModel).not.toBe('claude-sonnet-4')
    expect(sess.acpModelsStatus).toBe('ready')
    expect(sess.acpModes.map((m) => m.id)).toEqual(['low', 'high'])
    expect(sess.acpModeConfigId).toBeNull()
    expect(sess.selectedAcpModeId).toBe('high')
    expect(sess.acpModesStatus).toBe('ready')
    expect(sess.messages).toEqual([])
  })

  it('falls back to harness selectedAgentId when previous ACP session has no acpAgentId', async () => {
    setupProject()
    seedGrokAcpCache({ selectedAgentId: 'grok-build' })
    patchSession({
      sessionProvider: 'acp',
      preferredProvider: 'acp',
      acpAgentId: null,
      selectedModel: '',
      acpModels: [],
      acpModelsStatus: 'idle',
      messages: [userMsg('u1', 'claude')],
    })

    await useChatStore.getState().resetSession()

    const sess = activeSession()
    expect(sess.acpAgentId).toBe('grok-build')
    expect(sess.acpModels.map((m) => m.id)).toEqual(['grok-4.5', 'grok-4.20'])
    expect(sess.selectedModel).toBe('grok-4.5')
    expect(sess.acpModelsStatus).toBe('ready')
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
    // New sessions must not inherit activity dock layout (shared terminal ids).
    expect(mockSeedFromCurrent).not.toHaveBeenCalled()
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
    expect(activeProjectState()._activeSessionId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('keeps claude for a claude-provider session', () => {
    setupProject()
    patchSession({ sessionProvider: 'claude', preferredProvider: 'claude', messages: [userMsg('u1', 'claude')] })

    useChatStore.getState().resetSessionForWorktreeSwitch(PATH, { wtPath: '/wt', gitBranch: null })

    const sess = activeSession()
    expect(sess.preferredProvider).toBe('claude')
    expect(activeProjectState()._activeSessionId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('hydrates Grok models from ACP cache when switching worktree from a Grok session', () => {
    setupProject()
    seedGrokAcpCache()
    patchSession({
      sessionProvider: 'acp',
      preferredProvider: 'acp',
      acpAgentId: 'grok-build',
      selectedModel: 'grok-4.20',
      acpModels: [{ id: 'grok-4.20', name: 'Grok 4.20', description: '' }],
      acpModelsStatus: 'ready',
      messages: [userMsg('u1', 'claude')],
    })

    useChatStore.getState().resetSessionForWorktreeSwitch(PATH, { wtPath: '/wt', gitBranch: 'feat' })

    const sess = activeSession()
    expect(sess.sessionProvider).toBe('acp')
    expect(sess.acpAgentId).toBe('grok-build')
    expect(sess.acpModels.map((m) => m.id)).toEqual(['grok-4.5', 'grok-4.20'])
    expect(sess.selectedModel).toBe('grok-4.20')
    expect(sess.acpModelsStatus).toBe('ready')
    expect(sess._worktreePath).toBe('/wt')
  })
})

describe('ensureSessionImpl slashCommands', () => {
  it('seeds project slashCommands from cached Claude harness resources', () => {
    setClaudeResources({
      slashCommands: [
        { name: 'compact', description: 'Compact context', argumentHint: '', isSkill: false },
      ],
      skills: [
        { name: 'tdd', description: 'TDD skill', argumentHint: '', isSkill: true },
      ],
    })

    setupProject()

    const names = activeProjectState().slashCommands.map((c) => c.name)
    expect(names).toContain('compact')
    expect(names).toContain('tdd')
    expect(names).toContain('clear')
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

  it('keeps the same session id when switching harness on an empty draft', () => {
    setupProject()
    setCodexResources({
      models: [{ id: 'gpt-5-high', name: 'GPT-5', description: '', isDefault: true } as ModelOption],
    })
    const oldSid = activeProjectState()._activeSessionId

    useChatStore.getState().setPreferredProvider('codex')

    const newSid = activeProjectState()._activeSessionId
    expect(newSid).toBe(oldSid)
    expect(activeSession().sessionProvider).toBe('codex')
    expect(activeSession().preferredProvider).toBe('codex')
    expect(mockSeedFromCurrent).not.toHaveBeenCalled()
    // Eager dispose of any prior main runtime under the shared sid.
    expect(mockWindowAgent.resetSession).toHaveBeenCalledWith(oldSid)
  })

  it('clears providerSessionId and disposes main when switching empty draft harness', () => {
    setupProject()
    patchSession({
      sessionProvider: 'acp',
      preferredProvider: 'acp',
      _providerSessionId: '019fa-stale',
      status: 'idle',
    })
    const sid = activeProjectState()._activeSessionId
    mockWindowAgent.resetSession.mockClear()

    useChatStore.getState().setPreferredProvider('claude')

    expect(activeProjectState()._activeSessionId).toBe(sid)
    expect(activeSession()._providerSessionId).toBeNull()
    expect(activeSession().sessionProvider).toBe('claude')
    expect(mockWindowAgent.resetSession).toHaveBeenCalledWith(sid)
  })

  it('clears ACP selectedModel when switching back to claude', () => {
    setupProject()
    useChatStore.setState((s) => ({
      harnessResources: {
        ...s.harnessResources,
        claude: {
          models: [
            { id: 'claude-sonnet-4', name: 'Sonnet', description: '', isDefault: true } as ModelOption,
          ],
          account: {} as never,
          slashCommands: [],
          skills: [],
          commands: [],
          agents: [],
          outputStyles: [],
        },
      },
    }))
    patchSession({
      sessionProvider: 'acp',
      preferredProvider: 'acp',
      selectedModel: 'grok-4.5',
      modelUserChosen: true,
      acpModels: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
      acpModelsStatus: 'ready',
    })

    useChatStore.getState().setPreferredProvider('claude')

    const sess = activeSession()
    expect(sess.sessionProvider).toBe('claude')
    expect(sess.selectedModel).toBe('claude-sonnet-4')
    expect(sess.modelUserChosen).toBe(false)
    expect(sess.acpModels).toEqual([])
    expect(sess.acpModelsStatus).toBe('idle')
  })

  it('rebuilds Claude slashCommands when switching back from ACP', () => {
    setClaudeResources({
      models: [
        { id: 'claude-sonnet-4', name: 'Sonnet', description: '', isDefault: true } as ModelOption,
      ],
      slashCommands: [
        { name: 'compact', description: 'Compact context', argumentHint: '', isSkill: false },
        { name: 'help', description: 'Help', argumentHint: '', isSkill: false },
      ],
      skills: [
        { name: 'tdd', description: 'TDD skill', argumentHint: '', isSkill: true },
      ],
      commands: [
        { name: 'release', description: 'Release cmd', argumentHint: '', isSkill: false },
      ],
    })
    useChatStore.setState({ initializedHarnesses: new Set(['claude']) })
    setupProject()
    useChatStore.setState((s) => {
      const proj = s.projectSessions[PATH]
      return {
        projectSessions: {
          ...s.projectSessions,
          [PATH]: { ...proj, slashCommands: [] },
        },
      }
    })
    expect(activeProjectState().slashCommands).toEqual([])
    patchSession({
      sessionProvider: 'acp',
      preferredProvider: 'acp',
      acpAgentId: 'opencode',
      acpSlashCommands: [{ name: 'web', description: 'ACP web', argumentHint: '', isSkill: false }],
      acpSlashCommandsStatus: 'ready',
    })

    useChatStore.getState().setPreferredProvider('claude')

    const names = activeProjectState().slashCommands.map((c) => c.name)
    expect(names).toContain('compact')
    expect(names).toContain('help')
    expect(names).toContain('tdd')
    expect(names).toContain('release')
    expect(names).toContain('clear')
    expect(names).not.toContain('web')
    expect(activeSession().sessionProvider).toBe('claude')
    expect(activeSession().acpSlashCommands).toEqual([])
  })

  it('hydrates OpenCode models from cache when switching ACP agent', () => {
    setupProject()
    useChatStore.setState((s) => ({
      harnessResources: {
        ...s.harnessResources,
        acp: {
          agents: [
            { id: 'grok-build', name: 'Grok Build', installed: true, commandPreview: 'grok agent stdio' },
            { id: 'opencode', name: 'OpenCode', installed: true, commandPreview: 'opencode acp' },
          ],
          selectedAgentId: 'grok-build',
          modelsByAgentId: {
            'grok-build': {
              models: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
              selectedModelId: 'grok-4.5',
              configId: null,
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            opencode: {
              models: [
                { id: 'openai/gpt-5.4', name: 'OpenAI/GPT-5.4', description: '' },
                { id: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle', description: '' },
              ],
              selectedModelId: 'opencode/big-pickle',
              configId: 'model',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        },
      },
    }))
    patchSession({
      sessionProvider: 'acp',
      preferredProvider: 'acp',
      acpAgentId: 'grok-build',
      selectedModel: 'grok-4.5',
      acpModels: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
      acpModelsStatus: 'ready',
    })

    useChatStore.getState().setAcpAgentId('opencode')

    const sess = activeSession()
    expect(sess.acpAgentId).toBe('opencode')
    expect(sess.acpModels.map((m) => m.id)).toEqual(['openai/gpt-5.4', 'opencode/big-pickle'])
    expect(sess.selectedModel).toBe('opencode/big-pickle')
    expect(sess.acpModelsStatus).toBe('ready')
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
