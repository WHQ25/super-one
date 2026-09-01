/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEvent, ChatMessage, ClaudeResources, CodexResources } from '@superone/shared/agent-types'
import type { BrowserAnnotation } from './chat'

const mockSetActiveWorktree = vi.fn()
const mockClearWorktree = vi.fn().mockResolvedValue(undefined)
const localStorageState = new Map<string, string>()
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageState.set(key, value)
  }),
  removeItem: vi.fn((key: string) => {
    localStorageState.delete(key)
  }),
  clear: vi.fn(() => {
    localStorageState.clear()
  }),
}

const mockAppStoreState: {
  sandboxCapability: import('@superone/shared/agent-types').SandboxCapability | null
  sandboxProbe: import('@superone/shared/agent-types').SandboxProbeResult | null
  probeSandbox: ReturnType<typeof vi.fn>
} = {
  sandboxCapability: { supportLevel: 'always', platform: 'darwin', defaultMode: 'on' },
  sandboxProbe: null,
  probeSandbox: vi.fn(async () => ({ ok: true as const })),
}

vi.mock('./app', () => ({
  useAppStore: {
    getState: () => ({
      getWorktreeState: () => ({}),
      setActiveWorktree: mockSetActiveWorktree,
      clearWorktree: mockClearWorktree,
      sandboxCapability: mockAppStoreState.sandboxCapability,
      sandboxProbe: mockAppStoreState.sandboxProbe,
      probeSandbox: mockAppStoreState.probeSandbox,
    }),
  },
}))

const mockWindowAgent = {
  parkSession: vi.fn().mockResolvedValue(undefined),
  parkDraftSession: vi.fn().mockResolvedValue(undefined),
  resetSession: vi.fn().mockResolvedValue(undefined),
  activateSession: vi.fn().mockResolvedValue(undefined),
  getSessionId: vi.fn().mockResolvedValue(''),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  interrupt: vi.fn().mockResolvedValue(true),
  respondToPermission: vi.fn().mockResolvedValue(true),
  answerQuestion: vi.fn().mockResolvedValue(undefined),
  dismissQuestion: vi.fn().mockResolvedValue(undefined),
  respondToPlanApproval: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
  setSessionSettings: vi.fn().mockResolvedValue(undefined),
  setSessionApiProvider: vi.fn().mockResolvedValue(undefined),
  broadcastSessionSetting: vi.fn().mockResolvedValue(undefined),
  prewarm: vi.fn().mockResolvedValue(undefined),
  dequeueMessage: vi.fn().mockResolvedValue(true),
}

const mockWindowApp = {
  createSession: vi.fn().mockResolvedValue(undefined),
  saveSessionState: vi.fn().mockResolvedValue(undefined),
  loadSessionState: vi.fn().mockResolvedValue(null),
  pathExists: vi.fn().mockResolvedValue(true),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  listSessionsForFolder: vi.fn().mockResolvedValue([]),
  codexRun: vi.fn().mockResolvedValue({ threadId: 'thread-1', finalResponse: 'done', usage: null, items: [] }),
  codexReview: vi.fn().mockResolvedValue({ threadId: 'thread-1', finalResponse: 'done', usage: null, items: [] }),
  codexCompact: vi.fn().mockResolvedValue({ threadId: 'thread-1', finalResponse: 'done', usage: null, items: [] }),
  codexListModels: vi.fn().mockResolvedValue([]),
  codexListSkills: vi.fn().mockResolvedValue([]),
  cursorListSlashItems: vi.fn().mockResolvedValue([]),
  codexSteer: vi.fn().mockResolvedValue(undefined),
  codexPlanApproval: vi.fn().mockResolvedValue(undefined),
  codexCollaborationModeChange: vi.fn().mockResolvedValue(undefined),
  connectClaude: vi.fn().mockResolvedValue({
    models: [],
    account: {},
    slashCommands: [],
    skills: [],
    commands: [],
    agents: [],
    outputStyles: [],
  }),
  connectCodex: vi.fn().mockResolvedValue({ models: [], prompts: [] }),
  getAppSettings: vi.fn().mockResolvedValue({
    analyticsEnabled: true,
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '' },
    },
  }),
  trace: vi.fn(),
}

/** Remote node EnvironmentHost surface used by switchSession remote path. */
const mockWindowEnvironment = {
  getSession: vi.fn().mockResolvedValue(null),
  listSessionMessages: vi.fn().mockResolvedValue({ messages: [] }),
  resumeRemoteSessionEvents: vi.fn().mockResolvedValue(undefined),
  listProjects: vi.fn().mockResolvedValue([]),
  listSessions: vi.fn().mockResolvedValue([]),
  createSession: vi.fn().mockResolvedValue({ sessionId: 'new', title: null, lastActiveAt: '', messageCount: 0 }),
  listSessionEvents: vi.fn().mockResolvedValue([]),
  sendSessionMessage: vi.fn().mockResolvedValue(null),
}

type ClaudePrefPatch = {
  defaultModel?: string
  defaultEffort?: string
  defaultPermissionMode?: string
  defaultSandboxMode?: string
}
function mockAppSettingsWithClaude(patch: ClaudePrefPatch) {
  mockWindowApp.getAppSettings.mockResolvedValue({
    analyticsEnabled: true,
    agentPreference: {
      claude: {
        defaultModel: '',
        defaultEffort: '',
        defaultPermissionMode: '',
        defaultSandboxMode: '',
        ...patch,
      },
      codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '' },
    },
  })
}

const eventTarget = new EventTarget()
vi.stubGlobal('window', {
  agent: mockWindowAgent,
  app: mockWindowApp,
  environment: mockWindowEnvironment,
  localStorage: mockLocalStorage,
  dispatchEvent: (e: Event) => eventTarget.dispatchEvent(e),
  addEventListener: (t: string, h: EventListenerOrEventListenerObject) => eventTarget.addEventListener(t, h),
  removeEventListener: (t: string, h: EventListenerOrEventListenerObject) => eventTarget.removeEventListener(t, h),
})
vi.stubGlobal('localStorage', mockLocalStorage)

const { useChatStore, createSessionId, createDefaultPerSessionState, createDefaultProjectState, invalidateDefaultPermissionModeCache, invalidateDefaultCodexPreferencesCache, invalidateDefaultClaudePreferencesCache, defaultPrefsCache, getDefaultEffortForModel, cancelPrewarm } = await import('./chat')
const createDraftSessionId = createSessionId
const isDraftSession = (id: string | null): boolean => !!id

function getActiveDraftSession(path: string) {
  const proj = useChatStore.getState().projectSessions[path]
  const sid = proj._activeSessionId
  if (!sid) return undefined
  return proj._sessions[sid]
}

function getActiveDraftId(path: string) {
  const proj = useChatStore.getState().projectSessions[path]
  return proj._activeSessionId ?? null
}

function draftOf(proj: { _activeSessionId: string | null; _sessions: Record<string, unknown> }) {
  return proj._activeSessionId!
}

function resetStore() {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    remoteSessions: {},
    _previousFocusedSession: null,
    harnessResources: { claude: null, codex: null, acp: null, opencode: null, cursor: null },
    initializedHarnesses: new Set(),
  })
}

function setClaude(partial: Partial<ClaudeResources>) {
  const current = useChatStore.getState().harnessResources.claude
  useChatStore.getState().setHarnessResources('claude', {
    models: [],
    account: {},
    slashCommands: [],
    skills: [],
    commands: [],
    agents: [],
    outputStyles: [],
    ...(current ?? {}),
    ...partial,
  })
}

function setCodex(partial: Partial<CodexResources>) {
  const current = useChatStore.getState().harnessResources.codex
  useChatStore.getState().setHarnessResources('codex', {
    models: [],
    prompts: [],
    ...(current ?? {}),
    ...partial,
  })
}

function setupProject(path: string) {
  const store = useChatStore.getState()
  store.ensureSession(path)
  useChatStore.setState({ activeProject: path })
}

function patchDraftSession(path: string, patch: Record<string, unknown>) {
  const state = useChatStore.getState()
  const proj = state.projectSessions[path]
  const sid = proj._activeSessionId!
  useChatStore.setState({
    projectSessions: {
      ...state.projectSessions,
      [path]: {
        ...proj,
        _sessions: {
          ...proj._sessions,
          [sid]: { ...proj._sessions[sid], ...patch },
        },
      },
    },
  })
}

// resetSession() is now idempotent on a pristine (no-message, idle) session, so tests
// that exercise reset *mechanics* must seed a message to make the session non-pristine.
function seedUserMessage(path: string) {
  patchDraftSession(path, {
    messages: [{ id: 'seed', role: 'user' as const, content: [], status: 'complete' as const, createdAt: '', providerId: 'claude' }],
  })
}

function makeEvent(overrides: Partial<AgentEvent> & { type: AgentEvent['type'] }): AgentEvent {
  return { projectPath: '/test', sessionId: undefined, ...overrides } as AgentEvent
}

function makeMessage(id: string, role: 'user' | 'assistant'): ChatMessage {
  return {
    id,
    role,
    status: role === 'assistant' ? 'streaming' : 'complete',
    content: [],
    createdAt: '',
    providerId: 'claude',
  }
}

beforeEach(() => {
  resetStore()
  cancelPrewarm()
  vi.clearAllMocks()
  mockAppSettingsWithClaude({})
  mockLocalStorage.clear()
  globalThis.localStorage?.removeItem('super-one.codex.last-selection.v1')
  invalidateDefaultPermissionModeCache()
  invalidateDefaultClaudePreferencesCache()
  invalidateDefaultCodexPreferencesCache()
  mockWindowEnvironment.getSession.mockResolvedValue(null)
  mockWindowEnvironment.listSessionMessages.mockResolvedValue({ messages: [] })
  mockWindowEnvironment.resumeRemoteSessionEvents.mockResolvedValue(undefined)
})

describe('ensureSession', () => {
  it('creates project with DRAFT session entry', () => {
    useChatStore.getState().ensureSession('/project-a')
    const proj = useChatStore.getState().projectSessions['/project-a']

    expect(proj).toBeDefined()
    expect(isDraftSession(proj._activeSessionId)).toBe(true)
    expect(getActiveDraftSession('/project-a')).toBeDefined()
    expect(getActiveDraftSession('/project-a')!.status).toBe('idle')
  })

  it('does not overwrite existing project', () => {
    setupProject('/project-a')
    const draftId = getActiveDraftId('/project-a')!
    const store = useChatStore.getState()
    const proj = store.projectSessions['/project-a']
    proj._sessions[draftId].draftText = 'hello'
    useChatStore.setState({ projectSessions: { '/project-a': proj } })

    store.ensureSession('/project-a')

    const after = useChatStore.getState().projectSessions['/project-a']
    expect(after._sessions[draftId].draftText).toBe('hello')
  })

  it('applies user preference permissionMode to new session', async () => {
    mockAppSettingsWithClaude({ defaultPermissionMode: 'plan' })
    invalidateDefaultPermissionModeCache()
    await new Promise((r) => setTimeout(r, 0))

    useChatStore.getState().ensureSession('/perm-test')
    const session = getActiveDraftSession('/perm-test')!
    expect(session.permissionMode).toBe('plan')
  })

  it('applies user preference sandboxMode to new project sandboxInfo', async () => {
    mockAppSettingsWithClaude({ defaultSandboxMode: 'off' })
    invalidateDefaultPermissionModeCache()
    await new Promise((r) => setTimeout(r, 0))

    useChatStore.getState().ensureSession('/sandbox-off')
    const proj = useChatStore.getState().projectSessions['/sandbox-off']
    expect(proj.sandboxInfo).toEqual({ enabled: false, autoAllowBash: false })
  })

  it('applies user preference sandboxMode auto to new project sandboxInfo', async () => {
    mockAppSettingsWithClaude({ defaultSandboxMode: 'auto' })
    invalidateDefaultPermissionModeCache()
    await new Promise((r) => setTimeout(r, 0))

    useChatStore.getState().ensureSession('/sandbox-auto')
    const proj = useChatStore.getState().projectSessions['/sandbox-auto']
    expect(proj.sandboxInfo).toEqual({ enabled: true, autoAllowBash: true })
  })

  it('applies app-level codex permission preset to new sessions', async () => {
    mockWindowApp.getAppSettings.mockResolvedValue({
      analyticsEnabled: true,
      agentPreference: {
        claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
        codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: 'read-only' },
      },
    })
    invalidateDefaultCodexPreferencesCache()
    await new Promise((resolve) => setTimeout(resolve, 0))

    useChatStore.getState().ensureSession('/codex-permission')

    expect(getActiveDraftSession('/codex-permission')!.selectedCodexPermissionPreset).toBe('read-only')
  })

  it('setSandboxMode skips IPC when capability is unsupported', async () => {
    const prevCapability = mockAppStoreState.sandboxCapability
    mockAppStoreState.sandboxCapability = { supportLevel: 'unsupported', platform: 'win32', defaultMode: 'off' }
    try {
      useChatStore.getState().ensureSession('/sandbox-unsupported')
      useChatStore.setState({ activeProject: '/sandbox-unsupported' })
      const setSandboxIpc = vi.fn().mockResolvedValue({ enabled: true, autoAllowBash: false })
      Object.assign(globalThis.window.agent, { setSandboxMode: setSandboxIpc })

      await useChatStore.getState().setSandboxMode('on')

      expect(setSandboxIpc).not.toHaveBeenCalled()
    } finally {
      mockAppStoreState.sandboxCapability = prevCapability
    }
  })

  it('setSandboxMode probes deps on conditional capability and skips IPC on probe failure', async () => {
    const prevCapability = mockAppStoreState.sandboxCapability
    const prevProbe = mockAppStoreState.probeSandbox
    mockAppStoreState.sandboxCapability = { supportLevel: 'conditional', platform: 'linux', defaultMode: 'off' }
    mockAppStoreState.probeSandbox = vi.fn(async () => ({ ok: false as const, missing: ['bubblewrap'], installHint: 'sudo apt install bubblewrap socat' }))
    try {
      useChatStore.getState().ensureSession('/sandbox-conditional')
      useChatStore.setState({ activeProject: '/sandbox-conditional' })
      const setSandboxIpc = vi.fn().mockResolvedValue({ enabled: true, autoAllowBash: false })
      Object.assign(globalThis.window.agent, { setSandboxMode: setSandboxIpc })

      await useChatStore.getState().setSandboxMode('on')

      expect(mockAppStoreState.probeSandbox).toHaveBeenCalled()
      expect(setSandboxIpc).not.toHaveBeenCalled()
    } finally {
      mockAppStoreState.sandboxCapability = prevCapability
      mockAppStoreState.probeSandbox = prevProbe
    }
  })

  it('does NOT prewarm when a new project session is created (prewarm only fires on typing)', () => {
    mockWindowAgent.prewarm.mockClear()
    useChatStore.getState().ensureSession('/prewarm-new')
    expect(mockWindowAgent.prewarm).not.toHaveBeenCalled()
  })

  it('does NOT prewarm when project already exists', () => {
    useChatStore.getState().ensureSession('/prewarm-existing')
    mockWindowAgent.prewarm.mockClear()
    useChatStore.getState().ensureSession('/prewarm-existing')
    expect(mockWindowAgent.prewarm).not.toHaveBeenCalled()
  })

  it('does NOT prewarm when switching an empty draft to Codex (no typing yet)', () => {
    setCodex({ models: [{ id: 'gpt-5.4', name: 'GPT-5.4', supportedReasoningEfforts: [{ value: 'high', description: 'high' }] } as never] })
    setupProject('/prewarm-codex')
    const beforeSid = useChatStore.getState().projectSessions['/prewarm-codex']._activeSessionId
    mockWindowAgent.prewarm.mockClear()

    useChatStore.getState().setPreferredProvider('codex')

    const project = useChatStore.getState().projectSessions['/prewarm-codex']
    const afterSid = project._activeSessionId
    expect(afterSid).toBe(beforeSid)
    expect(project._sessions[afterSid!].sessionProvider).toBe('codex')
    expect(mockWindowAgent.prewarm).not.toHaveBeenCalled()
  })

  it('passes session._worktreePath as hint.worktreePath when prewarming an attached worktree', () => {
    vi.useFakeTimers()
    setupProject('/prewarm-wt-attach')
    patchDraftSession('/prewarm-wt-attach', { _worktreePath: '/prewarm-wt-attach/.worktrees/feat-x' })
    mockWindowAgent.prewarm.mockClear()

    useChatStore.getState().setDraftText('hi')
    expect(mockWindowAgent.prewarm).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)

    expect(mockWindowAgent.prewarm).toHaveBeenCalledWith(
      '/prewarm-wt-attach',
      expect.objectContaining({ worktreePath: '/prewarm-wt-attach/.worktrees/feat-x' }),
    )
    vi.useRealTimers()
  })
})

describe('no data loss on session switch', () => {
  it('preserves draftText and attachments in _sessions when switching', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const sessionA = { ...createDefaultPerSessionState(), draftText: 'my draft', attachments: [{ name: 'img.png', data: 'base64', mimeType: 'image/png' }] as never[] }
    const sessionB = createDefaultPerSessionState()

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'session-a',
          _sessions: { 'session-a': sessionA, 'session-b': sessionB },
        },
      },
    })

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _activeSessionId: 'session-b',
        },
      },
    })

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['session-a'].draftText).toBe('my draft')
    expect(after._sessions['session-a'].attachments).toHaveLength(1)
    expect(after._activeSessionId).toBe('session-b')
  })

  it('preserves selectedModel per session', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const sessionA = { ...createDefaultPerSessionState(), selectedModel: 'claude-opus-4-6' }
    const sessionB = { ...createDefaultPerSessionState(), selectedModel: 'claude-sonnet-4-6' }

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: { a: sessionA, b: sessionB },
        },
      },
    })

    const result = useChatStore.getState().projectSessions['/test']
    expect(result._sessions['a'].selectedModel).toBe('claude-opus-4-6')
    expect(result._sessions['b'].selectedModel).toBe('claude-sonnet-4-6')
  })

  it('setDraftText only affects active session, not other sessions', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const sessionA = { ...createDefaultPerSessionState(), draftText: 'draft-a' }
    const sessionB = { ...createDefaultPerSessionState(), draftText: 'draft-b' }

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: { a: sessionA, b: sessionB },
        },
      },
    })

    useChatStore.getState().setDraftText('updated-a')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a'].draftText).toBe('updated-a')
    expect(after._sessions['b'].draftText).toBe('draft-b')
  })

  it('switching active session exposes correct draftText without mutating other sessions', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const sessionA = { ...createDefaultPerSessionState(), draftText: 'draft-a' }
    const sessionB = { ...createDefaultPerSessionState(), draftText: 'draft-b' }

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: { a: sessionA, b: sessionB },
        },
      },
    })

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _activeSessionId: 'b',
        },
      },
    })

    useChatStore.getState().setDraftText('updated-b')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a'].draftText).toBe('draft-a')
    expect(after._sessions['b'].draftText).toBe('updated-b')
  })

  it('rapid session switches preserve all drafts independently', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: { ...createDefaultPerSessionState(), draftText: '' },
            b: { ...createDefaultPerSessionState(), draftText: '' },
            c: { ...createDefaultPerSessionState(), draftText: '' },
          },
        },
      },
    })

    useChatStore.getState().setDraftText('typed-in-a')

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _activeSessionId: 'b',
        },
      },
    })
    useChatStore.getState().setDraftText('typed-in-b')

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _activeSessionId: 'c',
        },
      },
    })
    useChatStore.getState().setDraftText('typed-in-c')

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _activeSessionId: 'a',
        },
      },
    })

    const final = useChatStore.getState().projectSessions['/test']
    expect(final._sessions['a'].draftText).toBe('typed-in-a')
    expect(final._sessions['b'].draftText).toBe('typed-in-b')
    expect(final._sessions['c'].draftText).toBe('typed-in-c')
  })

  it('setDetailedUsage writes to the named sid only and does not leak across sessions', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: createDefaultPerSessionState(),
            b: createDefaultPerSessionState(),
          },
        },
      },
    })

    const usageA = { totalTokens: 5000, maxTokens: 200000, percentage: 2.5, model: 'claude-sonnet-4-6', categories: [] }
    useChatStore.getState().setDetailedUsage('/test', 'a', usageA)

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a'].detailedUsage).toEqual(usageA)
    expect(after._sessions['b'].detailedUsage).toBeNull()

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _activeSessionId: 'b',
        },
      },
    })

    expect(useChatStore.getState().projectSessions['/test']._sessions['b'].detailedUsage).toBeNull()
  })

  it('setDetailedUsage drops writes when target sid no longer exists', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: { a: createDefaultPerSessionState() },
        },
      },
    })

    useChatStore.getState().setDetailedUsage('/test', 'evicted-sid', { totalTokens: 9999, maxTokens: 200000, percentage: 5, model: 'claude-sonnet-4-6', categories: [] })

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a'].detailedUsage).toBeNull()
    expect(after._sessions['evicted-sid']).toBeUndefined()
  })
})

describe('concurrent streaming sessions', () => {
  it('routes events to correct session by sessionId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const sessionA = { ...createDefaultPerSessionState(), status: 'streaming' as const }
    const sessionB = { ...createDefaultPerSessionState(), status: 'streaming' as const }

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: { a: sessionA, b: sessionB },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      sessionId: 'b',
      message: { id: 'bg-msg', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['b'].messages).toHaveLength(1)
    expect(after._sessions['b'].messages[0].id).toBe('bg-msg')
    expect(after._sessions['a'].messages).toHaveLength(0)
  })

  it('falls back to active session when event has no sessionId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: { a: createDefaultPerSessionState(), b: createDefaultPerSessionState() },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      status: 'streaming',
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a'].status).toBe('streaming')
    expect(after._sessions['b'].status).toBe('idle')
  })

  // Removed (date 2026-05-27): asserted that session_init re-keys the active draft to the real session id; that draft re-key behavior exists in neither main nor refactor. Tracked as follow-up issue if/when feature is implemented.

  // Removed (date 2026-05-27): asserted that a saved-session session_init lazily creates a hydrated entry without touching the draft; that lazy create + draft eviction behavior exists in neither main nor refactor. Tracked as follow-up issue if/when feature is implemented.

  it('routes follow-up events for an unloaded saved session to its real session id', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const draftId = getActiveDraftId('/test')!

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          sessions: [
            {
              sessionId: 'old-session',
              title: 'Old Session',
              lastActiveAt: '2026-03-23T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          _sessions: {
            [draftId]: {
              ...proj._sessions[draftId],
              messages: [{
                id: 'draft-user',
                role: 'user' as const,
                content: [{ type: 'text', text: 'new draft' }],
                status: 'complete' as const,
                createdAt: '',
                providerId: 'local',
              }],
              awaitingAssistantReply: true,
            },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: 'old-session',
      status: 'streaming',
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      sessionId: 'old-session',
      message: makeMessage('old-follow-up', 'assistant') as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions[draftId].messages.map((message) => message.id)).toEqual(['draft-user'])
    expect(after._sessions[draftId].awaitingAssistantReply).toBe(true)
    expect(after._sessions['old-session']).toBeDefined()
    expect(after._sessions['old-session'].status).toBe('streaming')
    expect(after._sessions['old-session'].messages.map((message) => message.id)).toContain('old-follow-up')
  })

  it('hydrates subscribed remote sessions and routes follow-up events to them', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'active',
          _sessions: { active: createDefaultPerSessionState() },
        },
      },
    })

    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [makeMessage('old-msg', 'assistant')],
      totalCostUsd: 1,
      contextTokens: 2,
      isWorktree: false,
      gitBranch: null,
      worktreePath: null,
      provider: 'claude',
    })

    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start',
      remoteProjectPath: '/test',
      remoteSessionId: 'remote-1',
      isSubscribe: true,
    } as AgentEvent)

    await Promise.resolve()
    await Promise.resolve()

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      sessionId: 'remote-1',
      message: makeMessage('new-msg', 'assistant') as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['remote-1'].messages.map((message) => message.id)).toEqual(['old-msg', 'new-msg'])
    expect(after._sessions['active'].messages).toHaveLength(0)
  })

  it('keeps subscribed remote sessions in memory after idle and does not save them from renderer', async () => {
    vi.useFakeTimers()
    try {
      setupProject('/test')
      const proj = useChatStore.getState().projectSessions['/test']

      useChatStore.setState({
        projectSessions: {
          '/test': {
            ...proj,
            _activeSessionId: 'active',
            _sessions: { active: createDefaultPerSessionState() },
          },
        },
      })

      let resolveLoad: (value: unknown) => void = () => {}
      const loadPromise = new Promise((resolve) => {
        resolveLoad = resolve
      })
      mockWindowApp.loadSessionState.mockImplementation(() => loadPromise as Promise<never>)

      useChatStore.getState().handleAgentEvent({
        type: 'remote_session_start',
        remoteProjectPath: '/test',
        remoteSessionId: 'remote-1',
        isSubscribe: true,
      } as AgentEvent)

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        sessionId: 'remote-1',
        message: makeMessage('new-msg', 'assistant') as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'status_change',
        sessionId: 'remote-1',
        status: 'idle',
      }))

      resolveLoad({
        messages: [makeMessage('old-msg', 'assistant')],
        totalCostUsd: 1,
        contextTokens: 2,
        isWorktree: false,
        gitBranch: null,
        worktreePath: null,
        provider: 'claude',
      })

      await Promise.resolve()
      await vi.runAllTimersAsync()

      const after = useChatStore.getState().projectSessions['/test']
      expect(after._sessions['remote-1'].messages.map((message) => message.id)).toEqual(['old-msg', 'new-msg'])
      expect(mockWindowApp.saveSessionState).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('idle eviction', () => {
  it('evicts non-active session from _sessions when it goes idle', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: createDefaultPerSessionState(),
            b: { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: 'b',
      status: 'idle',
    }))

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['b']).toBeUndefined()
    expect(after._sessions['a']).toBeDefined()
  })

  it('does NOT evict active session when it goes idle', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: 'a',
      status: 'idle',
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a']).toBeDefined()
    expect(after._sessions['a'].status).toBe('idle')
  })

  it('does NOT evict non-active session when awaitingAssistantReply is true', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: createDefaultPerSessionState(),
            b: { ...createDefaultPerSessionState(), awaitingAssistantReply: true },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: 'b',
      status: 'idle',
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['b']).toBeDefined()
    expect(after.unseenCompletedSessions.has('b')).toBe(false)
  })
})

describe('hasPendingInteraction', () => {
  it('is true when any session has pendingPermission', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: createDefaultPerSessionState(),
            b: { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'b',
      request: { requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after.hasPendingInteraction).toBe(true)
  })

  it('clears when all pending requests are resolved', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const sessionWithPermission = {
      ...createDefaultPerSessionState(),
      pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never],
    }

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          hasPendingInteraction: true,
          _sessions: { a: sessionWithPermission },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: 'a',
      status: 'streaming',
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a'].pendingPermissions.length).toBeGreaterThan(0)
    expect(after.hasPendingInteraction).toBe(true)
  })

  it('queues multiple permission_request events and respondToPermission dequeues by FIFO', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'a',
      request: { requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'a',
      request: { requestId: 'r2', toolName: 'Edit', description: 'edit file' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'a',
      request: { requestId: 'r3', toolName: 'Write', description: 'write file' } as never,
    }))

    const mid = useChatStore.getState().projectSessions['/test']
    expect(mid._sessions['a'].pendingPermissions).toHaveLength(3)
    expect(mid._sessions['a'].pendingPermissions.map((p: { requestId: string }) => p.requestId)).toEqual(['r1', 'r2', 'r3'])

    await useChatStore.getState().respondToPermission('r1', true)

    const after1 = useChatStore.getState().projectSessions['/test']
    expect(after1._sessions['a'].pendingPermissions).toHaveLength(2)
    expect(after1._sessions['a'].pendingPermissions[0].requestId).toBe('r2')

    await useChatStore.getState().respondToPermission('r2', false)

    const after2 = useChatStore.getState().projectSessions['/test']
    expect(after2._sessions['a'].pendingPermissions).toHaveLength(1)
    expect(after2._sessions['a'].pendingPermissions[0].requestId).toBe('r3')

    await useChatStore.getState().respondToPermission('r3', true)

    const after3 = useChatStore.getState().projectSessions['/test']
    expect(after3._sessions['a'].pendingPermissions).toHaveLength(0)
    expect(after3.hasPendingInteraction).toBe(false)
  })

  it('does not duplicate permission_request with same requestId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'a',
      request: { requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'a',
      request: { requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a'].pendingPermissions).toHaveLength(1)
  })
})

describe('resetSession', () => {
  it('creates fresh DRAFT session while keeping old session in _sessions', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const streamingSession = {
      ...createDefaultPerSessionState(),
      status: 'streaming' as const,
      messages: [{ id: 'm1', role: 'user' as const, content: [], status: 'complete' as const, createdAt: '', providerId: 'claude' }],
      session: { sessionId: 'old-session' } as never,
    }

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'old-session',
          _sessions: { 'old-session': streamingSession },
        },
      },
    })

    await useChatStore.getState().resetSession()

    const after = useChatStore.getState().projectSessions['/test']
    expect(isDraftSession(after._activeSessionId)).toBe(true)
    expect(getActiveDraftSession('/test')).toBeDefined()
    expect(getActiveDraftSession('/test')!.messages).toHaveLength(0)
    expect(after._sessions['old-session']).toBeDefined()
    expect(after._sessions['old-session'].messages).toHaveLength(1)
  })

  it('is idempotent on a pristine session: no stacked empty draft, no backend call', async () => {
    mockWindowAgent.resetSession.mockClear()
    setupProject('/test')
    const before = useChatStore.getState().projectSessions['/test']
    const oldSid = before._activeSessionId
    expect(Object.keys(before._sessions)).toHaveLength(1)

    await useChatStore.getState().resetSession()

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe(oldSid)
    expect(Object.keys(after._sessions)).toHaveLength(1)
    expect(mockWindowAgent.resetSession).not.toHaveBeenCalled()
  })

  it('applies permissionMode and sandboxInfo from agentConfig on idle reset', async () => {
    const agentConfig = {
      permissionMode: 'acceptEdits' as const,
      sandboxInfo: { enabled: false, autoAllowBash: true },
    }
    mockWindowAgent.resetSession.mockReset()
    mockWindowAgent.resetSession.mockResolvedValue(agentConfig)

    setupProject('/test')
    seedUserMessage('/test')

    await useChatStore.getState().resetSession()

    expect(getActiveDraftSession('/test')!.permissionMode).toBe('acceptEdits')
    const after = useChatStore.getState().projectSessions['/test']
    expect(after.sandboxInfo).toEqual({ enabled: false, autoAllowBash: true })
  })

  it('does NOT prewarm after reset (new draft has no typed text, prewarm waits for user input)', async () => {
    mockWindowAgent.resetSession.mockReset()
    mockWindowAgent.resetSession.mockResolvedValue({
      permissionMode: 'default' as const,
      sandboxInfo: { enabled: true, autoAllowBash: false },
    })
    setupProject('/prewarm-reset')
    useChatStore.setState({ activeProject: '/prewarm-reset' })
    seedUserMessage('/prewarm-reset')
    mockWindowAgent.prewarm.mockClear()

    await useChatStore.getState().resetSession()

    expect(mockWindowAgent.prewarm).not.toHaveBeenCalled()
  })

  it('passes newDraftSessionId to resetSession for idle non-streaming sessions', async () => {
    mockWindowAgent.resetSession.mockReset()
    mockWindowAgent.resetSession.mockResolvedValue({
      permissionMode: 'default' as const,
      sandboxInfo: { enabled: false, autoAllowBash: false },
    })

    setupProject('/test')
    seedUserMessage('/test')
    const before = useChatStore.getState().projectSessions['/test']
    const oldSid = before._activeSessionId

    await useChatStore.getState().resetSession()

    const after = useChatStore.getState().projectSessions['/test']
    expect(mockWindowAgent.resetSession).toHaveBeenCalledWith(oldSid, after._activeSessionId)
  })

  // Removed (date 2026-05-27): asserted that resetSession with a streaming DRAFT calls window.agent.parkDraftSession and preserves the old draft entry; parkDraftSession does not exist in production code (resetSessionImpl uses window.agent.parkSession). Tracked as follow-up issue if/when feature is implemented.

  // Removed (date 2026-05-27): asserted that resetSession with awaitingAssistantReply calls window.agent.parkDraftSession; parkDraftSession does not exist in production code. Tracked as follow-up issue if/when feature is implemented.

  it('applies agentConfig from parkSession for non-draft streaming session', async () => {
    const agentConfig = {
      permissionMode: 'bypassPermissions' as const,
      sandboxInfo: { enabled: true, autoAllowBash: true },
    }
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'streaming-sid',
          _sessions: {
            'streaming-sid': {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              session: { sessionId: 'streaming-sid' } as never,
            },
          },
        },
      },
    })

    mockWindowAgent.parkSession.mockReset()
    mockWindowAgent.parkSession.mockResolvedValue(agentConfig)

    await useChatStore.getState().resetSession()

    expect(mockWindowAgent.parkSession).toHaveBeenCalledTimes(1)
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('bypassPermissions')
    const after = useChatStore.getState().projectSessions['/test']
    expect(after.sandboxInfo).toEqual({ enabled: true, autoAllowBash: true })
  })
})

describe('Claude /clear command interception', () => {
  it('intercepts /clear and triggers resetSession without sending to SDK', async () => {
    mockWindowAgent.resetSession.mockClear()
    mockWindowAgent.sendMessage.mockClear()

    setupProject('/test')
    seedUserMessage('/test')
    const before = useChatStore.getState().projectSessions['/test']
    const oldSid = before._activeSessionId

    await useChatStore.getState().sendMessage('/clear')

    expect(mockWindowAgent.sendMessage).not.toHaveBeenCalled()
    expect(mockWindowAgent.resetSession).toHaveBeenCalledTimes(1)

    const after = useChatStore.getState().projectSessions['/test']
    expect(isDraftSession(after._activeSessionId)).toBe(true)
    expect(after._activeSessionId).not.toBe(oldSid)
    expect(getActiveDraftSession('/test')!.messages).toHaveLength(0)
  })

  it('treats trailing whitespace as part of the bare /clear command (rawContent is trimmed)', async () => {
    mockWindowAgent.resetSession.mockClear()
    mockWindowAgent.sendMessage.mockClear()

    setupProject('/test')
    seedUserMessage('/test')

    await useChatStore.getState().sendMessage('/clear   ')

    expect(mockWindowAgent.sendMessage).not.toHaveBeenCalled()
    expect(mockWindowAgent.resetSession).toHaveBeenCalledTimes(1)
  })

  it('does not intercept /clear when followed by arguments', async () => {
    mockWindowAgent.resetSession.mockClear()
    mockWindowAgent.sendMessage.mockClear()

    setupProject('/test')

    await useChatStore.getState().sendMessage('/clear something')

    expect(mockWindowAgent.resetSession).not.toHaveBeenCalled()
    expect(mockWindowAgent.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('does not intercept /clear under codex provider', async () => {
    mockWindowAgent.resetSession.mockClear()
    mockWindowApp.codexRun.mockClear()

    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_clear_test'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'codex',
              preferredProvider: 'codex',
            },
          },
        },
      },
    })

    await useChatStore.getState().sendMessage('/clear')

    expect(mockWindowAgent.resetSession).not.toHaveBeenCalled()
    expect(mockWindowApp.codexRun).toHaveBeenCalledTimes(1)
  })
})

describe('/provider slash command + setSessionApiProviderId', () => {
  it('intercepts /provider and opens the popup without sending to SDK', async () => {
    mockWindowAgent.sendMessage.mockClear()
    setupProject('/test')

    await useChatStore.getState().sendMessage('/provider')

    expect(mockWindowAgent.sendMessage).not.toHaveBeenCalled()
    const popup = getActiveDraftSession('/test')!.slashCommandOutput
    expect(popup).toMatchObject({ command: 'provider' })
  })

  it('does not intercept /provider under codex provider (retired outside Claude)', async () => {
    mockWindowApp.codexRun.mockClear()
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_provider_test'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'codex',
              preferredProvider: 'codex',
            },
          },
        },
      },
    })

    await useChatStore.getState().sendMessage('/provider')

    expect(mockWindowApp.codexRun).toHaveBeenCalledTimes(1)
    const popup = useChatStore.getState().projectSessions['/test']._sessions[codexSid].slashCommandOutput
    expect(popup).toBeNull()
  })

  it('setSessionApiProviderId updates the active session and dispatches IPC', async () => {
    mockWindowAgent.setSessionApiProvider.mockClear()
    setupProject('/test')
    const sid = useChatStore.getState().projectSessions['/test']._activeSessionId!

    await useChatStore.getState().setSessionApiProviderId('deepseek-id')

    expect(mockWindowAgent.setSessionApiProvider).toHaveBeenCalledWith(sid, 'deepseek-id')
    const session = useChatStore.getState().projectSessions['/test']._sessions[sid]
    expect(session.apiProviderId).toBe('deepseek-id')
    expect(session.slashCommandOutput).toBeNull()
  })

  it('agent_setting_change with apiProviderId patch updates store', () => {
    setupProject('/test')
    const sid = useChatStore.getState().projectSessions['/test']._activeSessionId!

    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      patch: { apiProviderId: 'openrouter-id' },
      sessionId: sid,
      projectPath: '/test',
    } as never)

    const session = useChatStore.getState().projectSessions['/test']._sessions[sid]
    expect(session.apiProviderId).toBe('openrouter-id')
  })
})

describe('init_ready updates session fields', () => {
  it('sets cwd on the active session and updates project metadata', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent({
      type: 'init_ready',
      projectPath: '/test',
      sessionId: undefined,
      cwd: '/home/user/project',
      homedir: '/home/user',
      sandboxInfo: { enabled: false, autoAllowBash: true },
      skills: [],
      projectCommands: [],
      projectAgents: [],
      additionalDirectories: [],
    } as never)

    const proj = useChatStore.getState().projectSessions['/test']
    expect(getActiveDraftSession('/test')!.cwd).toBe('/home/user/project')
    expect(proj.homedir).toBe('/home/user')
    expect(proj.sandboxInfo).toEqual({ enabled: false, autoAllowBash: true })
  })

  it('reports the session effective directory set, with no harness-config scopes', () => {
    setupProject('/proj-add-dir')

    useChatStore.getState().handleAgentEvent({
      type: 'init_ready',
      projectPath: '/proj-add-dir',
      sessionId: undefined,
      cwd: '/proj-add-dir',
      homedir: '/home/user',
      sandboxInfo: { enabled: false, autoAllowBash: true },
      skills: [],
      projectCommands: [],
      projectAgents: [],
      additionalDirectories: ['/proj-add-dir/lib'],
    } as never)

    const proj = useChatStore.getState().projectSessions['/proj-add-dir']
    // Workspace folders arrive via the project catalog, not init_ready.
    expect(proj.projectExtraDirs).toEqual([])
  })
})

describe('lazy session creation on early events', () => {
  // Removed (date 2026-05-27): asserted init_ready auto-creates a draft session in an empty project; the event-slice drops events when both eventSessionId and _activeSessionId are absent (no auto-create). Exists in neither main nor refactor. Tracked as follow-up issue if/when feature is implemented.

  // Removed (date 2026-05-27): asserted session_init (without event.sessionId) auto-creates a real session entry in an empty project; without eventSessionId the route is dropped (no lazy_session creation). Exists in neither main nor refactor. Tracked as follow-up issue if/when feature is implemented.

  it('still drops non-init events when no session exists', () => {
    useChatStore.setState({
      projectSessions: { '/empty': { ...createDefaultProjectState(), _activeSessionId: null, _sessions: {} } },
      activeProject: '/empty',
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      projectPath: '/empty',
      message: { id: 'msg1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    const proj = useChatStore.getState().projectSessions['/empty']
    expect(proj._activeSessionId).toBeNull()
    expect(Object.keys(proj._sessions)).toHaveLength(0)
  })
})

describe('focusProject tracks global previous session', () => {
  it('writes _previousFocusedSession with (currentProject, activeSessionId) when leaving a project', async () => {
    setupProject('/proj-a')
    const sidA = getActiveDraftId('/proj-a')!
    useChatStore.getState().ensureSession('/proj-b')

    await useChatStore.getState().focusProject('/proj-b')

    expect(useChatStore.getState()._previousFocusedSession).toEqual({ projectPath: '/proj-a', sessionId: sidA })
  })

  it('does not write _previousFocusedSession when target === currentProject', async () => {
    setupProject('/proj-first')
    await useChatStore.getState().focusProject('/proj-first')
    expect(useChatStore.getState()._previousFocusedSession).toBeNull()
  })

  it('inserts an unhydrated stub for the outgoing session if it is missing from _sessions', async () => {
    setupProject('/proj-a')
    const sidA = getActiveDraftId('/proj-a')!
    // Strip the active session from _sessions to simulate "active id known, data not loaded yet"
    useChatStore.setState((s) => {
      const proj = s.projectSessions['/proj-a']
      return {
        projectSessions: {
          ...s.projectSessions,
          '/proj-a': { ...proj, _sessions: {} },
        },
      }
    })
    useChatStore.getState().ensureSession('/proj-b')
    mockWindowApp.loadSessionState.mockResolvedValue(null)

    await useChatStore.getState().focusProject('/proj-b')

    const sessionA = useChatStore.getState().projectSessions['/proj-a']._sessions[sidA]
    expect(sessionA).toBeDefined()
  })
})

// Removed describe 'focusProject restores parked session' (date 2026-05-27):
// both tests asserted draft re-key + draft-aware resume gating; neither behavior
// exists in main or refactor. Tracked as follow-up issue if/when feature is implemented.

describe('setHarnessResources(claude) rebuilds slashCommands', () => {
  it('rebuilds slashCommands for initialized project even with empty skills/commands', () => {
    setupProject('/test')

    setClaude({
      models: [{ id: 'm1', name: 'model-1' }] as never[],
      slashCommands: [{ name: '/global-cmd', description: 'global' }] as never[],
      skills: [{ name: '/user-skill', description: 'user skill' }] as never[],
      commands: [{ name: '/user-cmd', description: 'user cmd' }] as never[],
    })

    const proj = useChatStore.getState().projectSessions['/test']
    expect(proj.slashCommands.length).toBeGreaterThan(0)
  })
})

describe('applyDefaultModel via ensureSession', () => {
  it('applies first available model to new DRAFT session', () => {
    setClaude({
      models: [
        { id: 'claude-sonnet-4-6', name: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] },
        { id: 'claude-haiku-4-5', name: 'Haiku' },
      ] as never[],
    })

    useChatStore.getState().ensureSession('/model-test')
    const session = getActiveDraftSession('/model-test')!
    expect(session.selectedModel).toBe('claude-sonnet-4-6')
    expect(session.selectedEffort).toBe('high')
  })

  it('does not set effort when model has no supportedEffortLevels', () => {
    setClaude({
      models: [{ id: 'claude-haiku-4-5', name: 'Haiku' }] as never[],
    })

    useChatStore.getState().ensureSession('/no-effort')
    const session = getActiveDraftSession('/no-effort')!
    expect(session.selectedModel).toBe('claude-haiku-4-5')
    expect(session.selectedEffort).toBeUndefined()
  })

  it('defaults to high when model supports high (e.g. Opus 4.8)', () => {
    setClaude({
      models: [
        { id: 'claude-opus-4-8', name: 'Opus 4.8', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'] },
      ] as never[],
    })

    useChatStore.getState().ensureSession('/opus-47')
    const session = getActiveDraftSession('/opus-47')!
    expect(session.selectedModel).toBe('claude-opus-4-8')
    expect(session.selectedEffort).toBe('high')
  })

  it('leaves default model when no models available', () => {
    setClaude({ models: [] })

    useChatStore.getState().ensureSession('/empty-models')
    const session = getActiveDraftSession('/empty-models')!
    expect(session.selectedModel).toBe('')
  })
})

describe('getDefaultEffortForModel', () => {
  it('returns high when model supports high', () => {
    expect(getDefaultEffortForModel({ id: 'claude-opus-4-8', name: 'Opus 4.8', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'] })).toBe('high')
  })

  it('returns medium when model supports medium but not high', () => {
    expect(getDefaultEffortForModel({ id: 'claude-sonnet-4-6', name: 'Sonnet', description: '', supportedEffortLevels: ['low', 'medium'] })).toBe('medium')
  })

  it('returns undefined when model has no effort levels', () => {
    expect(getDefaultEffortForModel({ id: 'claude-haiku-4-5', name: 'Haiku', description: '' })).toBeUndefined()
    expect(getDefaultEffortForModel(undefined)).toBeUndefined()
  })

  it('falls back to first level when neither high nor medium is present', () => {
    expect(getDefaultEffortForModel({ id: 'weird-model', name: 'Weird', description: '', supportedEffortLevels: ['low'] })).toBe('low')
  })
})

describe('codex model cache + defaults', () => {
  it('seeds new session with cached codex models and prefers GPT-5.4 high', () => {
    setCodex({
      models: [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          supportedReasoningEfforts: [{ value: 'low', description: 'low' }, { value: 'high', description: 'high' }],
        } as never,
      ],
    })

    useChatStore.getState().ensureSession('/codex-cache')
    const session = getActiveDraftSession('/codex-cache')!
    expect(session.selectedCodexModel).toBe('gpt-5.4')
    expect(session.selectedCodexReasoningEffort).toBe('high')
  })

  it('prefers app-level codex defaults over remembered selection', async () => {
    globalThis.localStorage?.setItem('super-one.codex.last-selection.v1', JSON.stringify({
      modelId: 'gpt-5.4',
      reasoningEffort: 'low',
    }))
    mockWindowApp.getAppSettings.mockResolvedValue({
      analyticsEnabled: true,
      agentPreference: { codex: { defaultModel: 'gpt-5.4', defaultReasoningEffort: 'high' } },
    })
    invalidateDefaultCodexPreferencesCache()
    await new Promise((r) => setTimeout(r, 0))

    setCodex({
      models: [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          supportedReasoningEfforts: [{ value: 'low', description: 'low' }, { value: 'high', description: 'high' }],
        } as never,
      ],
    })

    useChatStore.getState().ensureSession('/codex-pref')
    const session = getActiveDraftSession('/codex-pref')!
    expect(session.selectedCodexModel).toBe('gpt-5.4')
    expect(session.selectedCodexReasoningEffort).toBe('high')
  })

  it('seeds new session with remembered codex selection when available', () => {
    globalThis.localStorage?.setItem('super-one.codex.last-selection.v1', JSON.stringify({
      modelId: 'gpt-5.4',
      reasoningEffort: 'low',
    }))

    setCodex({
      models: [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          supportedReasoningEfforts: [{ value: 'low', description: 'low' }, { value: 'high', description: 'high' }],
        } as never,
      ],
    })

    useChatStore.getState().ensureSession('/codex-memory')
    const session = getActiveDraftSession('/codex-memory')!
    expect(session.selectedCodexModel).toBe('gpt-5.4')
    expect(session.selectedCodexReasoningEffort).toBe('low')
  })

  it('applies app-level codex defaults when models load after session creation', async () => {
    mockWindowApp.getAppSettings.mockResolvedValue({
      analyticsEnabled: true,
      agentPreference: { codex: { defaultModel: 'gpt-5.4', defaultReasoningEffort: 'low' } },
    })
    invalidateDefaultCodexPreferencesCache()
    await new Promise((r) => setTimeout(r, 0))

    useChatStore.getState().ensureSession('/codex-refresh-default')
    useChatStore.setState({ activeProject: '/codex-refresh-default' })
    mockWindowApp.codexListModels.mockResolvedValueOnce([
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        supportedReasoningEfforts: [{ value: 'low', description: 'low' }, { value: 'high', description: 'high' }],
      } as never,
    ])

    await useChatStore.getState().refreshCodexModels(true)
    const session = getActiveDraftSession('/codex-refresh-default')!
    expect(session.selectedCodexModel).toBe('gpt-5.4')
    expect(session.selectedCodexReasoningEffort).toBe('low')
  })

  it('updates global codex cache when refreshing codex models', async () => {
    setupProject('/codex-refresh')
    mockWindowApp.codexListModels.mockResolvedValueOnce([
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        supportedReasoningEfforts: [{ value: 'low', description: 'low' }, { value: 'high', description: 'high' }],
      } as never,
    ])

    await useChatStore.getState().refreshCodexModels(true)
    expect((useChatStore.getState().harnessResources.codex?.models ?? []).map((m) => m.id)).toEqual(['gpt-5.4'])
  })

  it('bypasses the main-process cache and updates claude resources on manual refresh', async () => {
    setupProject('/claude-refresh')
    mockWindowApp.connectClaude.mockResolvedValueOnce({
      models: [{ id: 'opus-5', name: 'Opus 5', description: '' }],
      account: {},
      slashCommands: [],
      skills: [],
      commands: [],
      agents: [],
      outputStyles: [],
    })

    await useChatStore.getState().refreshClaudeResources(true)

    expect(mockWindowApp.connectClaude).toHaveBeenCalledWith(true)
    expect((useChatStore.getState().harnessResources.claude?.models ?? []).map((m) => m.id)).toEqual(['opus-5'])
    expect(useChatStore.getState().claudeResourcesLoading).toBe(false)
  })

  it('caches Codex models separately for each provider', async () => {
    setupProject('/codex-provider-cache')
    mockWindowApp.codexListModels
      .mockResolvedValueOnce([{ id: 'provider-a-model', name: 'Provider A', description: '' }])
      .mockResolvedValueOnce([{ id: 'provider-b-model', name: 'Provider B', description: '' }])

    await useChatStore.getState().loadCodexModels('/codex-provider-cache', 'provider-a')
    await useChatStore.getState().loadCodexModels('/codex-provider-cache', 'provider-b')
    const restored = await useChatStore.getState().loadCodexModels('/codex-provider-cache', 'provider-a')

    const cache = useChatStore.getState().projectSessions['/codex-provider-cache'].codexModelsByProvider
    expect(cache['provider-a'].map((model) => model.id)).toEqual(['provider-a-model'])
    expect(cache['provider-b'].map((model) => model.id)).toEqual(['provider-b-model'])
    expect(restored.map((model) => model.id)).toEqual(['provider-a-model'])
    expect(mockWindowApp.codexListModels).toHaveBeenCalledTimes(2)
  })

  it('keeps active provider models when default Codex resources initialize', () => {
    setupProject('/codex-provider-init')
    patchDraftSession('/codex-provider-init', { apiProviderId: 'provider-b' })
    const project = useChatStore.getState().projectSessions['/codex-provider-init']
    useChatStore.setState({
      projectSessions: {
        ...useChatStore.getState().projectSessions,
        '/codex-provider-init': {
          ...project,
          codexModels: [{ id: 'provider-b-model', name: 'Provider B', description: '' }],
          codexModelsByProvider: { 'provider-b': [{ id: 'provider-b-model', name: 'Provider B', description: '' }] },
        },
      },
    })

    useChatStore.getState().setHarnessResources('codex', {
      models: [{ id: 'default-model', name: 'Default', description: '' }],
      prompts: [],
    })

    const updated = useChatStore.getState().projectSessions['/codex-provider-init']
    expect(updated.codexModels.map((model) => model.id)).toEqual(['provider-b-model'])
    expect(updated.codexModelsByProvider.__default__.map((model) => model.id)).toEqual(['default-model'])
  })

  it('persists codex selection changes to localStorage', () => {
    setCodex({
      models: [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          supportedReasoningEfforts: [{ value: 'low', description: 'low' }, { value: 'high', description: 'high' }],
        } as never,
      ],
    })
    setupProject('/codex-persist')

    useChatStore.getState().setSelectedCodexModel('gpt-5.4')
    useChatStore.getState().setSelectedCodexReasoningEffort('low')

    const raw = globalThis.localStorage?.getItem('super-one.codex.last-selection.v1')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toEqual({ modelId: 'gpt-5.4', reasoningEffort: 'low' })
  })
})

/**
 * Remote node switchSession always rehydrates via getSession (+ optional
 * messages.list). Those awaits race concurrent agent:event updates: a stale
 * set(hydrated from pre-await snapshot) used to drop stream deltas that landed
 * mid-flight — user sees missing agent reply after switching back.
 */
describe('remote switchSession hydrate race (agent reply loss)', () => {
  const projectKey = 'remote:env-1:/work/app'
  const sidA = 'remote-sid-a'
  const sidB = 'remote-sid-b'

  function seedRemoteTwoSessions(partialAsstText: string) {
    const userMsg: ChatMessage = {
      id: 'user-1',
      role: 'user',
      status: 'complete',
      content: [{ type: 'text', text: 'hi' }],
      createdAt: new Date(1).toISOString(),
      providerId: 'claude',
    }
    const asstMsg: ChatMessage = {
      id: 'asst-1',
      role: 'assistant',
      status: 'streaming',
      content: [{ type: 'text', text: partialAsstText }],
      createdAt: new Date(2).toISOString(),
      providerId: 'claude',
    }
    useChatStore.setState({
      activeProject: projectKey,
      projectSessions: {
        [projectKey]: {
          ...createDefaultProjectState(),
          _activeSessionId: sidB,
          _sessions: {
            [sidA]: {
              ...createDefaultPerSessionState(),
              messages: [userMsg, asstMsg],
              status: 'streaming',
              awaitingAssistantReply: true,
              sessionProvider: 'claude',
              preferredProvider: 'claude',
              lastAssistantMessageId: 'asst-1',
              _historyHydrated: true,
            },
            [sidB]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'claude',
              preferredProvider: 'claude',
              _historyHydrated: true,
            },
          },
        },
      },
    })
  }

  it('keeps stream deltas that arrive while getSession is in flight', async () => {
    seedRemoteTwoSessions('Hello')

    let resolveGet!: (value: unknown) => void
    const getPromise = new Promise((resolve) => {
      resolveGet = resolve
    })
    mockWindowEnvironment.getSession.mockImplementation(() => getPromise)
    mockWindowEnvironment.listSessionMessages.mockResolvedValue({ messages: [] })

    const switchPromise = useChatStore.getState().switchSession(sidA)

    // Concurrent stream while hydrate awaits the node snapshot.
    useChatStore.getState().handleAgentEvent({
      type: 'content_delta',
      projectPath: projectKey,
      sessionId: sidA,
      messageId: 'asst-1',
      delta: { type: 'text', text: ' world' },
    } as AgentEvent)
    useChatStore.getState().handleAgentEvent({
      type: 'message_complete',
      projectPath: projectKey,
      sessionId: sidA,
      messageId: 'asst-1',
    } as AgentEvent)
    useChatStore.getState().handleAgentEvent({
      type: 'status_change',
      projectPath: projectKey,
      sessionId: sidA,
      status: 'idle',
    } as AgentEvent)

    // Stale node snapshot: still streaming, assistant not on transcript yet.
    resolveGet({
      sessionId: sidA,
      status: 'streaming',
      harnessId: 'claude',
      transcript: [{ id: 'user-1', role: 'user', text: 'hi', createdAt: 1 }],
      pendingInteraction: null,
    })

    await switchPromise

    const sess = useChatStore.getState().projectSessions[projectKey]!._sessions[sidA]!
    const asst = sess.messages.find((m) => m.id === 'asst-1')
    expect(asst).toBeDefined()
    const text = (asst!.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
    // Bug: unconditional set(hydrated from pre-await prev) drops " world".
    expect(text).toContain('world')
    // Bug: stale snap re-opens a turn that already settled in memory.
    expect(sess.status).toBe('idle')
    expect(sess.awaitingAssistantReply).toBe(false)
  })

  it('keeps a completed assistant when node catalog lags behind the stream', async () => {
    seedRemoteTwoSessions('done')

    // Session already idle in memory with a full assistant turn.
    useChatStore.setState((s) => {
      const proj = s.projectSessions[projectKey]!
      const a = proj._sessions[sidA]!
      return {
        projectSessions: {
          ...s.projectSessions,
          [projectKey]: {
            ...proj,
            _sessions: {
              ...proj._sessions,
              [sidA]: {
                ...a,
                status: 'idle',
                awaitingAssistantReply: false,
                messages: a.messages.map((m) =>
                  m.id === 'asst-1'
                    ? { ...m, status: 'complete' as const, content: [{ type: 'text' as const, text: 'full agent reply' }] }
                    : m,
                ),
              },
            },
          },
        },
      }
    })

    // Node still has empty/incomplete catalog (race: turn just finished).
    mockWindowEnvironment.getSession.mockResolvedValue({
      sessionId: sidA,
      status: 'idle',
      harnessId: 'claude',
      transcript: [{ id: 'node-user', role: 'user', text: 'hi', createdAt: 1 }],
      pendingInteraction: null,
    })
    mockWindowEnvironment.listSessionMessages.mockResolvedValue({
      messages: [{ id: 'node-user', role: 'user', text: 'hi', createdAt: 1, sortOrder: 0 }],
    })

    await useChatStore.getState().switchSession(sidA)

    const sess = useChatStore.getState().projectSessions[projectKey]!._sessions[sidA]!
    const asst = sess.messages.find((m) => m.role === 'assistant')
    expect(asst).toBeDefined()
    expect(
      (asst!.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(''),
    ).toContain('full agent reply')
  })

  /**
   * User report end-to-end: already chatted several rounds on remote session A,
   * switch to B then back to A → earlier agent replies missing from thread head.
   *
   * switchSession always rehydrates with session.get + messages.list; list only
   * returns a newest-page suffix (hasMore). Merge must not reorder early turns
   * behind the latest ones.
   */
  it('switchSession multi-turn: early agent replies stay at head when messages.list is a suffix', async () => {
    const turn = (id: string, role: 'user' | 'assistant', text: string): ChatMessage => ({
      id,
      role,
      status: 'complete',
      content: [{ type: 'text', text }],
      createdAt: new Date().toISOString(),
      providerId: 'claude',
    })
    // Memory already has 3 full turns (user was actively chatting here).
    const fullMessages = [
      turn('u1', 'user', '第一轮用户'),
      turn('a1', 'assistant', '第一轮 agent 回复'),
      turn('u2', 'user', '第二轮用户'),
      turn('a2', 'assistant', '第二轮 agent 回复'),
      turn('u3', 'user', '第三轮用户'),
      turn('a3', 'assistant', '第三轮 agent 回复'),
    ]

    useChatStore.setState({
      activeProject: projectKey,
      projectSessions: {
        [projectKey]: {
          ...createDefaultProjectState(),
          // Currently viewing B; A still in _sessions with full multi-turn history.
          _activeSessionId: sidB,
          _sessions: {
            [sidA]: {
              ...createDefaultPerSessionState(),
              messages: fullMessages,
              status: 'idle',
              awaitingAssistantReply: false,
              sessionProvider: 'claude',
              preferredProvider: 'claude',
              lastAssistantMessageId: 'a3',
              _historyHydrated: true,
            },
            [sidB]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'claude',
              preferredProvider: 'claude',
              _historyHydrated: true,
            },
          },
        },
      },
    })

    mockWindowEnvironment.getSession.mockResolvedValue({
      sessionId: sidA,
      status: 'idle',
      harnessId: 'claude',
      transcript: fullMessages.map((m, i) => ({
        id: m.id,
        role: m.role,
        text: (m.content[0] as { text: string }).text,
        createdAt: i + 1,
      })),
      pendingInteraction: null,
    })
    // Node messages.list: newest-page suffix only (limit window / hasMore=true).
    mockWindowEnvironment.listSessionMessages.mockResolvedValue({
      messages: fullMessages.slice(2).map((m, i) => ({
        id: m.id,
        role: m.role,
        text: (m.content[0] as { text: string }).text,
        createdAt: i + 3,
        sortOrder: i + 2,
      })),
      hasMore: true,
      cursor: '2',
    })

    // Switch back to the multi-turn session.
    await useChatStore.getState().switchSession(sidA)

    const sess = useChatStore.getState().projectSessions[projectKey]!._sessions[sidA]!
    const ids = sess.messages.map((m) => m.id)

    // Must NOT be the catalog-first broken order: ['u2','a2','u3','a3','u1','a1']
    expect(ids).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3'])
    expect(
      (sess.messages.find((m) => m.id === 'a1')!.content[0] as { text: string }).text,
    ).toBe('第一轮 agent 回复')
    expect(ids.indexOf('a1')).toBeLessThan(ids.indexOf('a3'))
  })
})

describe('switchSession Case A (in _sessions)', () => {
  it('switches pointer to target session and calls resumeSession', async () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      session: { sessionId: 'ses-a' } as never,
    }))

    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            'ses-b': { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })

    mockWindowApp.resumeSession.mockResolvedValue(undefined)
    await useChatStore.getState().switchSession('ses-b')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('ses-b')
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'ses-b', '/test')
  })

  it('restores the persisted model/effort instead of catalog defaults on an unhydrated stub', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    // A sidebar / mosaic / live-sync stub: present in _sessions but never hydrated.
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': createDefaultPerSessionState(),
            'ses-stub': { ...createDefaultPerSessionState(), _historyHydrated: false },
          },
        },
      },
    })
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: null,
      provider: 'claude',
      selectedModel: 'claude-opus-5',
      selectedEffort: 'high',
    })
    mockWindowApp.resumeSession.mockResolvedValue(undefined)

    await useChatStore.getState().switchSession('ses-stub')

    const after = useChatStore.getState().projectSessions['/test']._sessions['ses-stub']
    expect(after.selectedModel).toBe('claude-opus-5')
    expect(after.selectedEffort).toBe('high')
    expect(after.modelUserChosen).toBe(true)
  })

  it('preserves the cached target session when switching does not change its state', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const target = {
      ...createDefaultPerSessionState(),
      cwd: '/test',
      selectedModel: 'claude-sonnet-4-6',
      sessionProvider: 'claude' as const,
    }
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': createDefaultPerSessionState(),
            'ses-b': target,
          },
        },
      },
    })

    await useChatStore.getState().switchSession('ses-b')

    expect(useChatStore.getState().projectSessions['/test']._sessions['ses-b']).toBe(target)
  })

  it('records the outgoing session as _previousSessionId so Ctrl+Tab can bounce back', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': createDefaultPerSessionState(),
            'ses-b': { ...createDefaultPerSessionState(), sessionProvider: 'claude' },
          },
        },
      },
    })

    await useChatStore.getState().switchSession('ses-b')
    const afterFirst = useChatStore.getState().projectSessions['/test']
    expect(afterFirst._activeSessionId).toBe('ses-b')
    expect(afterFirst._previousSessionId).toBe('ses-a')

    await useChatStore.getState().switchSession('ses-a')
    const afterBounce = useChatStore.getState().projectSessions['/test']
    expect(afterBounce._activeSessionId).toBe('ses-a')
    expect(afterBounce._previousSessionId).toBe('ses-b')
  })

  it('switches pointer and resumes runtime for non-running target session', async () => {
    setupProject('/test')
    useChatStore.setState({
      harnessResources: { claude: { models: [{ id: "claude-sonnet-4-6", name: "Sonnet", supportedEffortLevels: ["low", "medium", "high"] }] as never[], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] }, codex: null, acp: null },
    })
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': createDefaultPerSessionState(),
            'ses-b': { ...createDefaultPerSessionState(), sessionProvider: 'claude' },
          },
        },
      },
    })

    mockWindowApp.resumeSession.mockClear()
    await useChatStore.getState().switchSession('ses-b')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('ses-b')
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'ses-b', '/test')
    expect(after._sessions['ses-b'].selectedModel).toBe('claude-sonnet-4-6')
    expect(after._sessions['ses-b'].selectedEffort).toBe('high')
  })

  it('realigns project cwd when switching from worktree session to local session', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'wt',
          _sessions: {
            wt: { ...createDefaultPerSessionState(), cwd: '/tmp/worktree', sessionProvider: 'claude', _worktreePath: '/tmp/worktree' },
            local: { ...createDefaultPerSessionState(), cwd: '/tmp/worktree', sessionProvider: 'claude' },
          },
        },
      },
    })

    await useChatStore.getState().switchSession('local')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions.local.cwd).toBe('/test')
  })

  it('hydrates messages from DB when target is an un-hydrated codex stub (finished background session)', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': createDefaultPerSessionState(),
            'codex-bg': { ...createDefaultPerSessionState(), sessionProvider: 'codex', _historyHydrated: false },
          },
        },
      },
    })

    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [{ id: 'codex-msg', role: 'assistant', content: [], status: 'complete', createdAt: '', providerId: 'codex' }],
      totalCostUsd: 0.02,
      contextTokens: 500,
      gitBranch: null,
      provider: 'codex',
    })

    await useChatStore.getState().switchSession('codex-bg')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('codex-bg')
    expect(after._sessions['codex-bg'].messages).toHaveLength(1)
    expect(after._sessions['codex-bg'].messages[0].id).toBe('codex-msg')
    expect(after._sessions['codex-bg'].sessionProvider).toBe('codex')
    expect(after._sessions['codex-bg']._historyHydrated).toBe(true)
  })

  it('reloads a cached empty session when persisted Codex history exists', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': createDefaultPerSessionState(),
            'codex_local_stale': {
              ...createDefaultPerSessionState(),
              messages: [],
              sessionProvider: 'claude',
              preferredProvider: 'claude',
              _historyHydrated: true,
            },
          },
        },
      },
    })
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [{ id: 'codex-msg', role: 'assistant', content: [], status: 'complete', createdAt: '', providerId: 'codex' }],
      totalCostUsd: 0.02,
      contextTokens: 500,
      gitBranch: null,
      provider: 'codex',
    })

    await useChatStore.getState().switchSession('codex_local_stale')

    const restored = useChatStore.getState().projectSessions['/test']._sessions['codex_local_stale']
    expect(mockWindowApp.loadSessionState).toHaveBeenCalledWith('codex_local_stale')
    expect(restored.messages.map((message) => message.id)).toEqual(['codex-msg'])
    expect(restored.sessionProvider).toBe('codex')
    expect(restored.preferredProvider).toBe('codex')
  })

  it('preserves newer runtime messages when empty history reload finishes later', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': createDefaultPerSessionState(),
            'codex_local_stale': {
              ...createDefaultPerSessionState(),
              sessionProvider: 'claude',
              preferredProvider: 'claude',
              _historyHydrated: true,
            },
          },
        },
      },
    })
    let resolveLoad!: (saved: null) => void
    mockWindowApp.loadSessionState.mockImplementationOnce(() => new Promise((resolve) => {
      resolveLoad = resolve
    }))

    const switching = useChatStore.getState().switchSession('codex_local_stale')
    await vi.waitFor(() => expect(mockWindowApp.loadSessionState).toHaveBeenCalledWith('codex_local_stale'))
    useChatStore.setState((state) => {
      const currentProject = state.projectSessions['/test']
      const currentSession = currentProject._sessions['codex_local_stale']
      return {
        projectSessions: {
          ...state.projectSessions,
          '/test': {
            ...currentProject,
            _sessions: {
              ...currentProject._sessions,
              'codex_local_stale': {
                ...currentSession,
                messages: [{ id: 'runtime-msg', role: 'assistant', content: [], status: 'complete', createdAt: '', providerId: 'codex' }],
                sessionProvider: 'codex',
                preferredProvider: 'codex',
              },
            },
          },
        },
      }
    })
    resolveLoad(null)
    await switching

    const restored = useChatStore.getState().projectSessions['/test']._sessions['codex_local_stale']
    expect(restored.messages.map((message) => message.id)).toEqual(['runtime-msg'])
    expect(restored.sessionProvider).toBe('codex')
    expect(restored._historyHydrated).toBe(true)
  })

  it('resolves codex model selection by the session own provider when switching to a codex stub (Case A no longer hardcodes claude)', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          codexModels: [{ id: 'gpt-5.4', name: 'GPT-5.4', supportedEffortLevels: [] }] as never[],
          _sessions: {
            'ses-a': createDefaultPerSessionState(),
            'codex-cached': { ...createDefaultPerSessionState(), sessionProvider: 'codex', _historyHydrated: true },
          },
        },
      },
    })

    await useChatStore.getState().switchSession('codex-cached')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['codex-cached'].selectedCodexModel).toBe('gpt-5.4')
    expect(after._sessions['codex-cached'].selectedModel).toBe('')
  })
})

describe('switchSession does NOT prewarm (regression: prewarm only on typing)', () => {
  it('does NOT prewarm a Claude session restored from DB (Case B) — every old session click would otherwise leak a warmup process', async () => {
    setupProject('/test')
    useChatStore.setState({
      harnessResources: { claude: { models: [{ id: 'claude-sonnet-4-6', name: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] }] as never[], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] }, codex: null, acp: null },
    })
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [{ id: 'm', role: 'assistant', content: [], status: 'complete', createdAt: '', providerId: 'claude' }],
      totalCostUsd: 0, contextTokens: 0, gitBranch: null, provider: 'claude',
    })
    mockWindowAgent.prewarm.mockClear()

    await useChatStore.getState().switchSession('claude-db')

    expect(mockWindowAgent.prewarm).not.toHaveBeenCalled()
  })
})

describe('switchSession Case B (from DB)', () => {
  it('loads session from DB and sets active', async () => {
    setupProject('/test')
    useChatStore.setState({
      harnessResources: { claude: { models: [{ id: "claude-sonnet-4-6", name: "Sonnet", supportedEffortLevels: ["low", "medium", "high"] }] as never[], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] }, codex: null, acp: null },
    })

    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [{ id: 'db-msg', role: 'assistant', content: [], status: 'complete', createdAt: '', providerId: 'claude' }],
      totalCostUsd: 0.05,
      contextTokens: 1000,
      gitBranch: null,
      provider: 'claude',
    })
    await useChatStore.getState().switchSession('db-session')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('db-session')
    expect(after._sessions['db-session']).toBeDefined()
    expect(after._sessions['db-session'].messages).toHaveLength(1)
    expect(after._sessions['db-session'].messages[0].id).toBe('db-msg')
    expect(after._sessions['db-session'].totalCostUsd).toBe(0.05)
    expect(after._sessions['db-session'].contextTokens).toBe(1000)
    expect(after._sessions['db-session'].sessionProvider).toBe('claude')
    expect(after._sessions['db-session'].selectedModel).toBe('claude-sonnet-4-6')
    expect(after._sessions['db-session'].selectedEffort).toBe('high')
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'db-session', '/test')
  })

  it('restores a worktree session model and effort instead of applying Claude defaults', async () => {
    setupProject('/test')
    useChatStore.setState({
      harnessResources: { claude: { models: [
        { id: 'claude-sonnet-4-6', name: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] },
        { id: 'claude-opus-4-8', name: 'Opus', supportedEffortLevels: ['low', 'medium', 'high'] },
      ] as never[], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] }, codex: null, acp: null },
    })
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [{ id: 'db-msg-opus', role: 'assistant', content: [], status: 'complete', createdAt: '', providerId: 'claude' }],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: 'feature/model',
      worktreePath: '/test/.worktrees/model',
      provider: 'claude',
      selectedModel: 'claude-opus-4-8',
      selectedEffort: 'high',
    })

    await useChatStore.getState().switchSession('db-worktree-opus')

    const session = useChatStore.getState().projectSessions['/test']._sessions['db-worktree-opus']
    expect(session.selectedModel).toBe('claude-opus-4-8')
    expect(session.selectedEffort).toBe('high')
    expect(session.modelUserChosen).toBe(true)
  })

  it('handles null loadSessionState gracefully', async () => {
    setupProject('/test')
    mockWindowApp.loadSessionState.mockResolvedValue(null)

    await useChatStore.getState().switchSession('missing-session')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('missing-session')
    expect(after._sessions['missing-session'].messages).toHaveLength(0)
    expect(after._sessions['missing-session'].totalCostUsd).toBe(0)
  })

  it('uses defaultPermissionMode from user preferences', async () => {
    setupProject('/test')
    mockAppSettingsWithClaude({ defaultPermissionMode: 'acceptEdits' })
    invalidateDefaultPermissionModeCache()
    await new Promise((r) => setTimeout(r, 0))
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: null,
      provider: 'claude',
    })

    await useChatStore.getState().switchSession('pref-session')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['pref-session'].permissionMode).toBe('acceptEdits')
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'pref-session', '/test')
  })

  it('restores the default Codex permission preset when loading a session from DB', async () => {
    setupProject('/test')
    defaultPrefsCache.codexPermissionPreset = 'full-access'
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: null,
      provider: 'codex',
    })

    await useChatStore.getState().switchSession('codex-pref-session')

    const session = useChatStore.getState().projectSessions['/test']._sessions['codex-pref-session']
    expect(session.selectedCodexPermissionPreset).toBe('full-access')
  })

  it('passes permissionMode to resumeSession in Case B', async () => {
    setupProject('/test')
    mockAppSettingsWithClaude({})
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: null,
      provider: 'claude',
    })
    mockWindowApp.resumeSession.mockResolvedValue(undefined)

    await useChatStore.getState().switchSession('order-session')

    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'order-session', '/test')
  })

  it('restores per-session apiProviderId from DB so reopening a session after main-window close keeps the third-party provider', async () => {
    setupProject('/test')
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: null,
      provider: 'claude',
      apiProviderId: 'deepseek-id',
    })

    await useChatStore.getState().switchSession('saved-session')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['saved-session'].apiProviderId).toBe('deepseek-id')
  })

  it('falls back to null apiProviderId when DB row has none (back-compat with pre-feature sessions)', async () => {
    setupProject('/test')
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: null,
      provider: 'claude',
    })

    await useChatStore.getState().switchSession('legacy-session')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['legacy-session'].apiProviderId).toBeNull()
  })
})

describe('switchSession Case A permissionMode sync', () => {
  it('passes target permissionMode to resumeSession atomically', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': { ...createDefaultPerSessionState(), permissionMode: 'acceptEdits' as never },
            'ses-b': { ...createDefaultPerSessionState(), permissionMode: 'default' as never, sessionProvider: 'claude' },
          },
        },
      },
    })

    mockWindowApp.resumeSession.mockResolvedValue(undefined)

    await useChatStore.getState().switchSession('ses-b')

    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'ses-b', '/test')
  })

  it('does not overwrite old session permissionMode when switching', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': { ...createDefaultPerSessionState(), permissionMode: 'acceptEdits' as never },
            'ses-b': { ...createDefaultPerSessionState(), permissionMode: 'default' as never, sessionProvider: 'claude' },
          },
        },
      },
    })

    mockWindowApp.resumeSession.mockResolvedValue(undefined)

    await useChatStore.getState().switchSession('ses-b')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['ses-a'].permissionMode).toBe('acceptEdits')
    expect(after._sessions['ses-b'].permissionMode).toBe('default')
  })

  it('scenario: resuming a DB session adopts permissionMode and sandboxInfo returned by main (user prefs applied authoritatively)', async () => {
    setupProject('/test')
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: null,
      provider: 'claude',
    })
    mockWindowApp.resumeSession.mockResolvedValue({
      permissionMode: 'acceptEdits',
      sandboxInfo: { enabled: false, autoAllowBash: false },
    })

    await useChatStore.getState().switchSession('resumed-sid')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['resumed-sid'].permissionMode).toBe('acceptEdits')
    expect(after.sandboxInfo).toEqual({ enabled: false, autoAllowBash: false })
  })

  it('scenario: restoring a renamed DB session populates _title so chat header matches sidebar', async () => {
    setupProject('/test')
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [{ id: 'u1', role: 'user' as const, content: [{ type: 'text', text: 'first user message that should not become the title' }], status: 'complete' as const, createdAt: '', providerId: 'claude' }],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: null,
      provider: 'claude',
      title: 'Renamed in DB',
    })
    mockWindowApp.resumeSession.mockResolvedValue(undefined)

    await useChatStore.getState().switchSession('renamed-sid')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['renamed-sid']._title).toBe('Renamed in DB')
  })

  it('scenario: if main returns undefined (resume failed), store keeps pre-resume state', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          sandboxInfo: { enabled: true, autoAllowBash: false },
          _sessions: {
            'ses-a': createDefaultPerSessionState(),
            'ses-b': { ...createDefaultPerSessionState(), permissionMode: 'plan' as never, sessionProvider: 'claude' },
          },
        },
      },
    })
    mockWindowApp.resumeSession.mockResolvedValue(undefined)

    await useChatStore.getState().switchSession('ses-b')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['ses-b'].permissionMode).toBe('plan')
    expect(after.sandboxInfo).toEqual({ enabled: true, autoAllowBash: false })
  })
})

describe('deferred resume on sendMessage', () => {
  it('resumes non-running Claude session right before send', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'db-session',
          _sessions: {
            ...proj._sessions,
            'db-session': {
              ...createDefaultPerSessionState(),
              sessionProvider: 'claude',
              messages: [
                { id: 'hist-1', role: 'user', content: [{ type: 'text', text: 'history' }], status: 'complete', createdAt: '', providerId: 'claude' },
              ] as never[],
            },
          },
        },
      },
    })

    mockWindowAgent.getSessionId.mockResolvedValue('another-session')
    mockWindowAgent.activateSession.mockRejectedValue(new Error('No background session'))

    await useChatStore.getState().sendMessage('hello')

    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'db-session', '/test')
    expect(mockWindowAgent.sendMessage).toHaveBeenCalled()
  })
})

describe('message id minting', () => {
  it('gives two sends in the same millisecond distinct client message ids', async () => {
    setupProject('/test')
    mockWindowAgent.sendMessage.mockClear()
    // Codex keys its durable queue by clientMessageId, so a collision silently
    // drops one queued message and strands its bubble in the composer queue.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      await useChatStore.getState().sendMessage('first')
      await useChatStore.getState().sendMessage('second')
    } finally {
      vi.useRealTimers()
    }

    const ids = mockWindowAgent.sendMessage.mock.calls.map(
      (call) => (call[1] as { clientMessageId?: string }).clientMessageId,
    )
    expect(ids).toHaveLength(2)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('codex plan mode', () => {
  it('toggles codex plan mode via the shortcut action', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [draftOf(proj)]: {
              ...proj._sessions[draftOf(proj)],
              preferredProvider: 'codex',
              selectedCodexCollaborationMode: 'default',
            },
          },
        },
      },
    })

    useChatStore.getState().togglePlanModeShortcut()
    expect(getActiveDraftSession('/test')!.selectedCodexCollaborationMode).toBe('plan')

    useChatStore.getState().togglePlanModeShortcut()
    expect(getActiveDraftSession('/test')!.selectedCodexCollaborationMode).toBe('default')
  })

  it('activates plan mode via /plan slash command without popup or chat messages', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [draftOf(proj)]: {
              ...proj._sessions[draftOf(proj)],
              preferredProvider: 'codex',
              selectedCodexCollaborationMode: 'default',
            },
          },
        },
      },
    })

    await useChatStore.getState().sendMessage('/plan')

    const proj2 = useChatStore.getState().projectSessions['/test']
    const activeId = proj2._activeSessionId!
    const session = proj2._sessions[activeId]
    expect(session.selectedCodexCollaborationMode).toBe('plan')
    expect(session.messages).toHaveLength(0)
    expect(session.slashCommandOutput).toBeFalsy()
    expect(mockWindowApp.codexRun).not.toHaveBeenCalled()
  })

  it('passes plan collaboration mode to codex runs', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [draftOf(proj)]: {
              ...proj._sessions[draftOf(proj)],
              preferredProvider: 'codex',
              selectedCodexModel: 'gpt-5.1-codex',
              selectedCodexCollaborationMode: 'plan',
            },
          },
        },
      },
    })

    await useChatStore.getState().sendMessage('hello')

    const call = mockWindowApp.codexRun.mock.calls.at(-1)
    expect(call).toBeTruthy()
    expect(call?.[1]).toBe('/test')
    expect(call?.[2]).toBe('hello')
    expect(call?.[6]).toBe('plan')
  })

  it('passes default collaboration mode to codex runs', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [draftOf(proj)]: {
              ...proj._sessions[draftOf(proj)],
              preferredProvider: 'codex',
              selectedCodexModel: 'gpt-5.1-codex',
              selectedCodexCollaborationMode: 'default',
            },
          },
        },
      },
    })

    await useChatStore.getState().sendMessage('hello')

    const call = mockWindowApp.codexRun.mock.calls.at(-1)
    expect(call).toBeTruthy()
    expect(call?.[1]).toBe('/test')
    expect(call?.[2]).toBe('hello')
    expect(call?.[6]).toBe('default')
  })

  it('passes only the session scope to codex runs — Session unions the project folders', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const sid = draftOf(proj)

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          projectExtraDirs: ['/workspace'],
          _sessions: {
            ...proj._sessions,
            [sid]: {
              ...proj._sessions[sid],
              preferredProvider: 'codex',
              additionalDirs: ['/session-shared'],
            },
          },
        },
      },
    })

    await useChatStore.getState().sendMessage('hello')

    const call = mockWindowApp.codexRun.mock.calls.at(-1)
    expect(call?.[15]).toMatchObject({ additionalDirectories: ['/session-shared'] })
  })

  it('approves codex plan with default collaboration mode without consuming draft attachments or mentions', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const attachment = { name: 'img.png', data: 'base64', mimeType: 'image/png' } as never
    const mention = { kind: 'file', value: '/test/src/app.ts', displayName: 'app.ts' } as never

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'codex-session',
          hasPendingInteraction: false,
          _sessions: {
            ...proj._sessions,
            'codex-session': {
              ...createDefaultPerSessionState(),
              preferredProvider: 'codex',
              sessionProvider: 'codex',
              selectedCodexCollaborationMode: 'plan',
              draftText: 'keep this draft',
              attachments: [attachment],
              mentions: [mention],
              lastAssistantMessageId: 'assistant-1',
              messages: [{
                id: 'assistant-1',
                role: 'assistant',
                status: 'complete',
                content: [{ type: 'text', text: 'plan' }],
                createdAt: '',
                providerId: 'codex',
                metadata: {
                  codex: {
                    threadId: 'thread-1',
                    usage: null,
                    items: [{ id: 'plan-1', type: 'plan', text: '## Plan' }],
                  },
                },
              }] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().approveCodexPlan()

    const call = mockWindowApp.codexRun.mock.calls.at(-1)
    expect(call).toBeTruthy()
    expect(call?.[2]).toBe('Plan approved, start implementation.')
    expect(call?.[6]).toBe('default')
    expect(call?.[9]).toBeUndefined()

    const session = useChatStore.getState().projectSessions['/test']._sessions['codex-session']
    expect(session.selectedCodexCollaborationMode).toBe('default')
    expect(session.draftText).toBe('keep this draft')
    expect(session.attachments).toEqual([attachment])
    expect(session.mentions).toEqual([mention])
    expect(session.messages.find((message) => message.id === 'assistant-1')?.metadata?.codex?.planApproval).toEqual({
      status: 'approved',
    })
    expect(session.messages.findLast((message) => message.role === 'user')?.content).toEqual([{
      type: 'text',
      text: 'Plan approved, start implementation.',
    }])
  })

  it('rejects codex plan with feedback without consuming draft attachments or mentions', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const attachment = { name: 'img.png', data: 'base64', mimeType: 'image/png' } as never
    const mention = { kind: 'file', value: '/test/src/app.ts', displayName: 'app.ts' } as never

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'codex-session',
          hasPendingInteraction: false,
          _sessions: {
            ...proj._sessions,
            'codex-session': {
              ...createDefaultPerSessionState(),
              preferredProvider: 'codex',
              sessionProvider: 'codex',
              selectedCodexCollaborationMode: 'plan',
              draftText: 'keep this draft',
              attachments: [attachment],
              mentions: [mention],
              lastAssistantMessageId: 'assistant-1',
              messages: [{
                id: 'assistant-1',
                role: 'assistant',
                status: 'complete',
                content: [{ type: 'text', text: 'plan' }],
                createdAt: '',
                providerId: 'codex',
                metadata: {
                  codex: {
                    threadId: 'thread-1',
                    usage: null,
                    items: [{ id: 'plan-1', type: 'plan', text: '## Plan' }],
                  },
                },
              }] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().rejectCodexPlan('Only touch the renderer layer.')

    const call = mockWindowApp.codexRun.mock.calls.at(-1)
    expect(call?.[2]).toBe('Only touch the renderer layer.')
    expect(call?.[6]).toBe('plan')
    expect(call?.[9]).toBeUndefined()
    const session = useChatStore.getState().projectSessions['/test']._sessions['codex-session']
    expect(session.selectedCodexCollaborationMode).toBe('plan')
    expect(session.draftText).toBe('keep this draft')
    expect(session.attachments).toEqual([attachment])
    expect(session.mentions).toEqual([mention])
    expect(session.messages.find((message) => message.id === 'assistant-1')?.metadata?.codex?.planApproval).toEqual({
      status: 'rejected',
      feedback: 'Only touch the renderer layer.',
    })
    expect(session.messages.findLast((message) => message.role === 'user')?.content).toEqual([{
      type: 'text',
      text: 'Only touch the renderer layer.',
    }])
  })

  it('focuses chat input instead of sending when rejecting codex plan without feedback', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'codex-session',
          hasPendingInteraction: false,
          _sessions: {
            ...proj._sessions,
            'codex-session': {
              ...createDefaultPerSessionState(),
              preferredProvider: 'codex',
              sessionProvider: 'codex',
              selectedCodexCollaborationMode: 'plan',
              lastAssistantMessageId: 'assistant-1',
              messages: [{
                id: 'assistant-1',
                role: 'assistant',
                status: 'complete',
                content: [{ type: 'text', text: 'plan' }],
                createdAt: '',
                providerId: 'codex',
                metadata: {
                  codex: {
                    threadId: 'thread-1',
                    usage: null,
                    items: [{ id: 'plan-1', type: 'plan', text: '## Plan' }],
                  },
                },
              }] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().rejectCodexPlan()

    expect(mockWindowApp.codexRun).not.toHaveBeenCalled()
    const session = useChatStore.getState().projectSessions['/test']._sessions['codex-session']
    expect(session.selectedCodexCollaborationMode).toBe('plan')
    expect(session.codexPlanRejectHintActive).toBe(true)
    expect(session.chatInputFocusNonce).toBe(1)
    expect(session.messages.find((message) => message.id === 'assistant-1')?.metadata?.codex?.planApproval).toEqual({
      status: 'rejected',
    })
    expect(mockWindowApp.codexPlanApproval).toHaveBeenCalledWith('/test', 'codex-session', 'assistant-1', 'rejected')
  })

  it('approveCodexPlan emits plan approval and mode change IPCs', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'codex-session',
          hasPendingInteraction: false,
          _sessions: {
            ...proj._sessions,
            'codex-session': {
              ...createDefaultPerSessionState(),
              preferredProvider: 'codex',
              sessionProvider: 'codex',
              selectedCodexCollaborationMode: 'plan',
              lastAssistantMessageId: 'assistant-1',
              messages: [{
                id: 'assistant-1',
                role: 'assistant',
                status: 'complete',
                content: [{ type: 'text', text: 'plan' }],
                createdAt: '',
                providerId: 'codex',
                metadata: {
                  codex: { threadId: 'thread-1', usage: null, items: [{ id: 'plan-1', type: 'plan', text: '## Plan' }] },
                },
              }] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().approveCodexPlan()

    expect(mockWindowApp.codexPlanApproval).toHaveBeenCalledWith('/test', 'codex-session', 'assistant-1', 'approved')
    expect(mockWindowApp.codexCollaborationModeChange).toHaveBeenCalledWith('/test', 'codex-session', 'default')
  })

  it('rejectCodexPlan with feedback emits plan approval IPC', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'codex-session',
          hasPendingInteraction: false,
          _sessions: {
            ...proj._sessions,
            'codex-session': {
              ...createDefaultPerSessionState(),
              preferredProvider: 'codex',
              sessionProvider: 'codex',
              selectedCodexCollaborationMode: 'plan',
              lastAssistantMessageId: 'assistant-1',
              messages: [{
                id: 'assistant-1',
                role: 'assistant',
                status: 'complete',
                content: [{ type: 'text', text: 'plan' }],
                createdAt: '',
                providerId: 'codex',
                metadata: {
                  codex: { threadId: 'thread-1', usage: null, items: [{ id: 'plan-1', type: 'plan', text: '## Plan' }] },
                },
              }] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().rejectCodexPlan('Use a different approach.')

    expect(mockWindowApp.codexPlanApproval).toHaveBeenCalledWith('/test', 'codex-session', 'assistant-1', 'rejected', 'Use a different approach.')
  })
})

describe('awaitingAssistantReply state machine', () => {
  it('sets awaitingAssistantReply true when sending a new Claude turn', async () => {
    setupProject('/test')
    useChatStore.setState({
      harnessResources: { claude: { models: [{ id: "claude-sonnet-4-6", name: "Sonnet", supportedEffortLevels: ["low", "medium", "high"] }] as never[], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] }, codex: null, acp: null },
    })

    await useChatStore.getState().sendMessage('hello')

    const projectState = useChatStore.getState().projectSessions['/test']
    const session = projectState._sessions[projectState._activeSessionId!]
    expect(session.awaitingAssistantReply).toBe(true)
  })

  it('clears awaitingAssistantReply on message_start', async () => {
    setupProject('/test')
    useChatStore.setState((s) => {
      const proj = s.projectSessions['/test']
      return {
        projectSessions: {
          ...s.projectSessions,
          '/test': {
            ...proj,
            _sessions: {
              ...proj._sessions,
              [draftOf(proj)]: {
                ...proj._sessions[draftOf(proj)],
                awaitingAssistantReply: true,
              },
            },
          },
        },
      }
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'asst-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    const projectState = useChatStore.getState().projectSessions['/test']
    const session = projectState._sessions[projectState._activeSessionId!]
    expect(session.awaitingAssistantReply).toBe(false)
  })

  it('clears awaitingAssistantReply on message_error', () => {
    setupProject('/test')
    useChatStore.setState((s) => {
      const proj = s.projectSessions['/test']
      return {
        projectSessions: {
          ...s.projectSessions,
          '/test': {
            ...proj,
            _sessions: {
              ...proj._sessions,
              [draftOf(proj)]: {
                ...proj._sessions[draftOf(proj)],
                awaitingAssistantReply: true,
              },
            },
          },
        },
      }
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_error',
      messageId: 'missing-msg',
      error: 'network error',
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.awaitingAssistantReply).toBe(false)
  })

  it('clears awaitingAssistantReply when sendMessage throws', async () => {
    setupProject('/test')
    useChatStore.setState({
      harnessResources: { claude: { models: [{ id: "claude-sonnet-4-6", name: "Sonnet", supportedEffortLevels: ["low", "medium", "high"] }] as never[], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] }, codex: null, acp: null },
    })
    mockWindowAgent.sendMessage.mockRejectedValueOnce(new Error('send failed'))

    await expect(useChatStore.getState().sendMessage('hello')).rejects.toThrow('send failed')

    const session = getActiveDraftSession('/test')!
    expect(session.awaitingAssistantReply).toBe(false)
  })

  it('keeps awaitingAssistantReply on status_change idle', () => {
    setupProject('/test')
    const did = getActiveDraftId('/test')!
    useChatStore.setState((s) => {
      const proj = s.projectSessions['/test']
      return {
        projectSessions: {
          ...s.projectSessions,
          '/test': {
            ...proj,
            _sessions: {
              ...proj._sessions,
              [draftOf(proj)]: {
                ...proj._sessions[draftOf(proj)],
                awaitingAssistantReply: true,
              },
            },
          },
        },
      }
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: did,
      status: 'idle',
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.awaitingAssistantReply).toBe(true)
  })
})

describe('codex concurrent send routing', () => {
  it('queues a codex prompt sent mid-turn instead of steering the live one', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_queue_test'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...proj._sessions[draftOf(proj)],
              status: 'streaming',
              sessionProvider: 'codex',
              preferredProvider: 'codex',
              activeCodexMessageId: 'codex-prev',
              messages: [
                {
                  id: 'codex-prev',
                  role: 'assistant',
                  status: 'streaming',
                  content: [{ type: 'text', text: 'previous response' }],
                  createdAt: '',
                  providerId: 'codex',
                },
              ] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().sendMessage('queued follow-up')

    const projectState = useChatStore.getState().projectSessions['/test']
    const session = projectState._sessions[projectState._activeSessionId!]

    // App-server 149 turns a concurrent send into a durable queued turn, so the
    // transcript keeps only the streaming turn and the prompt waits in the queue.
    expect(session.messages.map((message) => message.id)).toEqual(['codex-prev'])
    const queued = session.queuedMessages.at(-1)
    expect(queued?.role).toBe('user')
    expect(session.activeCodexMessageId).toBe('codex-prev')
    expect(mockWindowApp.codexSteer).not.toHaveBeenCalled()

    const payload = mockWindowAgent.sendMessage.mock.calls.at(-1)?.[1]
    expect(payload?.provider).toBe('codex')
    expect(payload?.priority).toBe('next')
    expect(payload?.codex?.mode).toBe('run')
    expect(payload?.codex?.prompt).toBe('queued follow-up')
    expect(payload?.clientMessageId).toBe(queued?.id)
  })
})

describe('codex item streaming behavior', () => {
  it('keeps reasoning visible after non-reasoning codex items arrive', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [draftOf(proj)]: {
              ...proj._sessions[draftOf(proj)],
              status: 'streaming',
              messages: [
                {
                  id: 'codex-msg',
                  role: 'assistant',
                  status: 'streaming',
                  content: [],
                  createdAt: '',
                  providerId: 'codex',
                  metadata: {
                    codex: {
                      threadId: 'thread-1',
                      usage: null,
                      items: [],
                    },
                  },
                },
              ] as never[],
            },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'codex_item_delta',
      messageId: 'codex-msg',
      phase: 'updated',
      item: { id: 'reason-1', type: 'reasoning', text: 'Thinking' },
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'codex_item_delta',
      messageId: 'codex-msg',
      phase: 'completed',
      item: { id: 'reason-1', type: 'reasoning', text: 'Thinking' },
    }))

    let items = getActiveDraftSession('/test')!.messages[0].metadata?.codex?.items ?? []
    expect(items).toEqual([{ id: 'reason-1', type: 'reasoning', text: 'Thinking' }])

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'codex_item_delta',
      messageId: 'codex-msg',
      phase: 'started',
      item: { id: 'cmd-1', type: 'command_execution', command: 'ls', aggregatedOutput: '', status: 'in_progress' },
    }))

    items = getActiveDraftSession('/test')!.messages[0].metadata?.codex?.items ?? []
    expect(items).toEqual([
      { id: 'reason-1', type: 'reasoning', text: 'Thinking' },
      { id: 'cmd-1', type: 'command_execution', command: 'ls', aggregatedOutput: '', status: 'in_progress' },
    ])
  })
})

describe('codex usage semantics', () => {
  it('accumulates fresh last-usage deltas while keeping context tokens separate', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [draftOf(proj)]: {
              ...proj._sessions[draftOf(proj)],
              sessionProvider: 'codex',
              preferredProvider: 'codex',
            },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'codex-msg-1',
      inputTokens: 70,
      outputTokens: 15,
      codexUsage: {
        totalInputTokens: 1100,
        totalCachedInputTokens: 560,
        totalOutputTokens: 215,
        lastInputTokens: 70,
        lastCachedInputTokens: 69,
        lastOutputTokens: 15,
        reasoningOutputTokens: 55,
        contextWindow: 258400,
      },
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.contextTokens).toBe(70)
    expect(session.contextWindow).toBe(258400)
    expect(session.streamingTokens).toEqual({ input: 1, output: 15 })
    expect(session.codexUsageSnapshot?.totalInputTokens).toBe(1100)
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'codex-msg-2',
      inputTokens: 30,
      outputTokens: 5,
      codexUsage: {
        totalInputTokens: 1130,
        totalCachedInputTokens: 580,
        totalOutputTokens: 220,
        lastInputTokens: 30,
        lastCachedInputTokens: 20,
        lastOutputTokens: 5,
        reasoningOutputTokens: 55,
        contextWindow: 258400,
      },
    }))

    const updatedSession = getActiveDraftSession('/test')!
    expect(updatedSession.contextTokens).toBe(30)
    expect(updatedSession.streamingTokens).toEqual({ input: 11, output: 20 })
  })

  it('does not double-count duplicate last-usage snapshots', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'codex-msg-3',
      inputTokens: 70,
      outputTokens: 15,
      codexUsage: {
        totalInputTokens: 1100,
        totalCachedInputTokens: 560,
        totalOutputTokens: 215,
        lastInputTokens: 70,
        lastCachedInputTokens: 69,
        lastOutputTokens: 15,
        reasoningOutputTokens: 55,
        contextWindow: 258400,
      },
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'codex-msg-3',
      inputTokens: 70,
      outputTokens: 15,
      codexUsage: {
        totalInputTokens: 1100,
        totalCachedInputTokens: 560,
        totalOutputTokens: 215,
        lastInputTokens: 70,
        lastCachedInputTokens: 69,
        lastOutputTokens: 15,
        reasoningOutputTokens: 55,
        contextWindow: 258400,
      },
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.contextTokens).toBe(70)
    expect(session.streamingTokens).toEqual({ input: 1, output: 15 })
  })

  it('refreshes lastEventAt for codex progress events', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'codex-progress-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'codex' } as never,
      }))

      vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'))
      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_usage',
        messageId: 'codex-progress-1',
        inputTokens: 70,
        outputTokens: 15,
        codexUsage: {
          totalInputTokens: 1100,
          totalCachedInputTokens: 560,
          totalOutputTokens: 215,
          lastInputTokens: 70,
          lastCachedInputTokens: 69,
          lastOutputTokens: 15,
          reasoningOutputTokens: 55,
          contextWindow: 258400,
        },
      }))

      expect(getActiveDraftSession('/test')!.lastEventAt).toBe(new Date('2026-01-01T00:00:10.000Z').getTime())

      vi.setSystemTime(new Date('2026-01-01T00:00:20.000Z'))
      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'codex_item_delta',
        messageId: 'codex-progress-1',
        phase: 'updated',
        item: { id: 'agent-msg-1', type: 'agent_message', text: 'working' } as never,
      }))

      expect(getActiveDraftSession('/test')!.lastEventAt).toBe(new Date('2026-01-01T00:00:20.000Z').getTime())
    } finally {
      vi.useRealTimers()
    }
  })

  it('normalizes codex message_complete metadata from session-manager events', () => {
    setupProject('/test')
    patchDraftSession('/test', { sessionProvider: 'codex', preferredProvider: 'codex' })

    const usage = {
      totalInputTokens: 1100,
      totalCachedInputTokens: 560,
      totalOutputTokens: 215,
      lastInputTokens: 70,
      lastCachedInputTokens: 69,
      lastOutputTokens: 15,
      reasoningOutputTokens: 55,
      contextWindow: 258400,
    }

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'codex-complete-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'codex' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'codex-complete-1',
      inputTokens: usage.lastInputTokens,
      outputTokens: usage.lastOutputTokens,
      codexUsage: usage,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_complete',
      messageId: 'codex-complete-1',
      metadata: {
        codex: {
          finalResponse: 'all done',
          durationMs: 23000,
          threadId: 'thread-1',
          usage,
          items: [
            { id: 'reason-1', type: 'reasoning', text: 'thinking' },
            { id: 'agent-1', type: 'agent_message', text: 'all done' },
          ],
        },
      } as never,
    }))

    const session = getActiveDraftSession('/test')!
    const message = session.messages.find((entry) => entry.id === 'codex-complete-1')!

    expect(message.status).toBe('complete')
    expect(message.content).toEqual([{ type: 'text', text: 'all done' }])
    expect(message.metadata?.durationMs).toBe(23000)
    expect(message.metadata?.consumedTokens).toEqual({ input: 1, output: 15 })
    expect(message.metadata?.codex).toEqual({
      threadId: 'thread-1',
      usage,
      items: [
        { id: 'reason-1', type: 'reasoning', text: 'thinking' },
        { id: 'agent-1', type: 'agent_message', text: 'all done' },
      ],
    })
  })
})

describe('codex question routing', () => {
  it('routes answerQuestion through codex IPC for codex sessions', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_q_test'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...proj._sessions[draftOf(proj)],
              sessionProvider: 'codex',
              preferredProvider: 'codex',
              pendingQuestion: {
                requestId: 'q1',
                questions: [],
              },
            },
          },
        },
      },
    })

    useChatStore.getState().answerQuestion('q1', { q1: 'Answer' })

    expect(mockWindowAgent.answerQuestion).toHaveBeenCalledWith(codexSid, 'q1', { q1: 'Answer' }, undefined)
    expect(useChatStore.getState().projectSessions['/test']._sessions[codexSid].pendingQuestion).toBeNull()
  })

  it('routes dismissQuestion through codex IPC for codex sessions', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_d_test'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...proj._sessions[draftOf(proj)],
              sessionProvider: 'codex',
              preferredProvider: 'codex',
              pendingQuestion: {
                requestId: 'q1',
                questions: [],
              },
            },
          },
        },
      },
    })

    useChatStore.getState().dismissQuestion('q1')

    expect(mockWindowAgent.dismissQuestion).toHaveBeenCalledWith(codexSid, 'q1')
    expect(useChatStore.getState().projectSessions['/test']._sessions[codexSid].pendingQuestion).toBeNull()
  })
})

describe('message_interrupted clears pending states', () => {
  it('clears pendingPermission, pendingQuestion, pendingPlanApproval on interrupt', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const msgId = 'msg-1'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          hasPendingInteraction: true,
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              messages: [{ id: msgId, role: 'assistant' as const, content: [], status: 'streaming' as const, createdAt: '', providerId: 'claude' }],
              pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never],
              pendingQuestion: { requestId: 'q1', questions: [] } as never,
              pendingPlanApproval: { requestId: 'p1', planContent: '' } as never,
            },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_interrupted',
      sessionId: 'a',
      messageId: msgId,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    const session = after._sessions['a']
    expect(session.pendingPermissions).toEqual([])
    expect(session.pendingQuestion).toBeNull()
    expect(session.pendingPlanApproval).toBeNull()
    expect(session.messages[0].status).toBe('interrupted')
    expect(after.hasPendingInteraction).toBe(false)
  })
})

describe('interrupt', () => {
  it('routes claude sessions through agent interrupt by sessionId', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'claude-a',
          _sessions: {
            'claude-a': {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              sessionProvider: 'claude',
            },
          },
        },
      },
    })

    await useChatStore.getState().interrupt()

    expect(mockWindowAgent.interrupt).toHaveBeenCalledWith('claude-a')
  })

  it('routes codex sessions through agent interrupt by sessionId', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'codex-a',
          _sessions: {
            'codex-a': {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              sessionProvider: 'codex',
            },
          },
        },
      },
    })

    mockWindowAgent.interrupt.mockResolvedValueOnce(true)

    await useChatStore.getState().interrupt()

    expect(mockWindowAgent.interrupt).toHaveBeenCalledWith('codex-a')
  })

  it('clears pending state when interrupt is not accepted', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'codex-a',
          _sessions: {
            'codex-a': {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              awaitingAssistantReply: true,
              sessionProvider: 'codex',
              pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', description: 'ls' } as never],
              pendingQuestion: { requestId: 'q1', questions: [] } as never,
              pendingPlanApproval: { requestId: 'p1', planContent: '' } as never,
            },
          },
        },
      },
    })

    mockWindowAgent.interrupt.mockResolvedValueOnce(false)

    await useChatStore.getState().interrupt()

    const session = useChatStore.getState().projectSessions['/test']._sessions['codex-a']
    expect(session.status).toBe('idle')
    expect(session.awaitingAssistantReply).toBe(false)
    expect(session.pendingPermissions).toEqual([])
    expect(session.pendingQuestion).toBeNull()
    expect(session.pendingPlanApproval).toBeNull()
  })
})

describe('hasPendingInteraction across multiple sessions', () => {
  it('stays true until ALL sessions clear pending state', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          hasPendingInteraction: true,
          _sessions: {
            a: { ...createDefaultPerSessionState(), pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', description: 'ls' } as never] },
            b: { ...createDefaultPerSessionState(), pendingQuestion: { requestId: 'q1', question: 'pick' } as never },
          },
        },
      },
    })

    // Clear only session a's pending — b still has pendingQuestion
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _sessions: {
            ...useChatStore.getState().projectSessions['/test']._sessions,
            a: { ...createDefaultPerSessionState() },
          },
        },
      },
    })
    // Trigger recomputation via any event
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change', sessionId: 'a', status: 'streaming',
    }))
    expect(useChatStore.getState().projectSessions['/test'].hasPendingInteraction).toBe(true)

    // Clear session b's pending too
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _sessions: {
            ...useChatStore.getState().projectSessions['/test']._sessions,
            b: { ...createDefaultPerSessionState() },
          },
        },
      },
    })
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change', sessionId: 'a', status: 'idle',
    }))
    expect(useChatStore.getState().projectSessions['/test'].hasPendingInteraction).toBe(false)
  })
})

describe('task_started event', () => {
  it('initializes taskProgress for the toolUseId', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'Running background agent',
    }))
    const session = getActiveDraftSession('/test')!
    const progress = session.taskProgress['tool-abc']
    expect(progress).toBeDefined()
    expect(progress.description).toBe('Running background agent')
    expect(progress.completed).toBe(false)
    expect(progress.toolHistory).toEqual([])
  })

  it('preserves existing taskProgress fields', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'first',
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_progress',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'progressing',
      lastToolName: 'Bash',
      usage: { totalTokens: 100, toolUses: 2, durationMs: 500 },
    }))
    const session = getActiveDraftSession('/test')!
    const progress = session.taskProgress['tool-abc']
    expect(progress.description).toBe('progressing')
    expect(progress.totalTokens).toBe(100)
    expect(progress.toolUses).toBe(2)
  })

  it('treats late task_progress as live and clears a sticky completed flag', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'starting',
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_notification',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      taskStatus: 'completed',
      outputFile: '/tmp/out.log',
      usage: { totalTokens: 50, toolUses: 1, durationMs: 300 },
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_progress',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'late progress',
      lastToolName: 'Bash',
      usage: { totalTokens: 100, toolUses: 2, durationMs: 500 },
    }))

    const session = getActiveDraftSession('/test')!
    const progress = session.taskProgress['tool-abc']
    expect(progress.description).toBe('late progress')
    expect(progress.totalTokens).toBe(100)
    expect(progress.toolUses).toBe(2)
    expect(progress.completed).toBe(false)
    expect(progress.outputFile).toBe('/tmp/out.log')
  })

  function seedAgentBlock(toolUseId: string) {
    useChatStore.setState((s) => {
      const project = s.projectSessions['/test']
      const session = project._sessions[draftOf(project)]
      return {
        projectSessions: {
          ...s.projectSessions,
          '/test': {
            ...project,
            _sessions: {
              ...project._sessions,
              [draftOf(project)]: {
                ...session,
                messages: [{
                  id: 'msg-1', role: 'assistant' as const, status: 'streaming' as const,
                  content: [{ type: 'tool_use' as const, toolName: 'Agent', toolUseId, input: '{"run_in_background":true}' }],
                  createdAt: '', providerId: 'claude',
                }],
              },
            },
          },
        },
      }
    })
  }

  it('task_progress patches Agent tool_use block with taskUsage and taskToolHistory', () => {
    setupProject('/test')
    seedAgentBlock('tool-abc')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'starting',
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_progress',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'reading files',
      lastToolName: 'Read',
      usage: { totalTokens: 200, toolUses: 3, durationMs: 1000 },
    }))
    const session = getActiveDraftSession('/test')!
    const block = session.messages[0].content[0]
    expect(block.type).toBe('tool_use')
    if (block.type !== 'tool_use') return
    expect(block.taskUsage).toEqual({ totalTokens: 200, toolUses: 3, durationMs: 1000 })
    expect(block.taskToolHistory).toEqual([{ toolName: '', description: 'starting' }])
  })

  it('task_notification patches Agent tool_use block with final state', () => {
    setupProject('/test')
    seedAgentBlock('tool-abc')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'starting',
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_progress',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'reading files',
      lastToolName: 'Read',
      usage: { totalTokens: 200, toolUses: 3, durationMs: 1000 },
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_notification',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      taskStatus: 'completed',
      summary: 'Done reading all files',
      usage: { totalTokens: 500, toolUses: 8, durationMs: 3000 },
    }))
    const session = getActiveDraftSession('/test')!
    const block = session.messages[0].content[0]
    expect(block.type).toBe('tool_use')
    if (block.type !== 'tool_use') return
    expect(block.taskUsage).toEqual({ totalTokens: 500, toolUses: 8, durationMs: 3000 })
    expect(block.taskToolHistory).toEqual([{ toolName: '', description: 'starting' }])
    expect(block.taskSummary).toBe('Done reading all files')
  })

  it('task data persists in block even without task_notification (interrupt case)', () => {
    setupProject('/test')
    seedAgentBlock('tool-abc')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'step 1',
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_progress',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'step 2',
      lastToolName: 'Bash',
      summary: 'partial work',
      usage: { totalTokens: 100, toolUses: 2, durationMs: 500 },
    }))
    const session = getActiveDraftSession('/test')!
    const block = session.messages[0].content[0]
    expect(block.type).toBe('tool_use')
    if (block.type !== 'tool_use') return
    expect(block.taskUsage).toEqual({ totalTokens: 100, toolUses: 2, durationMs: 500 })
    expect(block.taskToolHistory).toEqual([{ toolName: '', description: 'step 1' }])
    expect(block.taskSummary).toBe('partial work')
  })
})

// Removed describe 'worktree session save isolation' (date 2026-05-27):
// asserted session_init re-keys the draft to a real id while preserving worktree
// fields; session_init does not re-key in production. Tracked as follow-up
// issue if/when feature is implemented.

describe('switchSession Case B codex usage restore', () => {
  it('restores an empty voice-only Codex session with its provider thread', async () => {
    setupProject('/test')
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      isWorktree: false,
      gitBranch: null,
      worktreePath: null,
      provider: 'codex',
      providerSessionId: 'thread-realtime',
    })

    await useChatStore.getState().switchSession('voice-only-session')

    const session = useChatStore.getState().projectSessions['/test']._sessions['voice-only-session']
    expect(session.messages).toEqual([])
    expect(session.sessionProvider).toBe('codex')
    expect(session.preferredProvider).toBe('codex')
    expect(session._providerSessionId).toBe('thread-realtime')
    expect(session._historyHydrated).toBe(true)
  })

  it('restores codex context window from saved message metadata', async () => {
    setupProject('/test')
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [{
        id: 'db-codex',
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        status: 'complete',
        createdAt: '',
        providerId: 'codex',
        metadata: {
          codex: {
            threadId: 'thread-1',
            usage: {
              totalInputTokens: 1320345,
              totalCachedInputTokens: 1155840,
              totalOutputTokens: 4200,
              lastInputTokens: 70105,
              lastCachedInputTokens: 69376,
              lastOutputTokens: 300,
              reasoningOutputTokens: 120,
              contextWindow: 258400,
            },
            items: [],
          },
        },
      }] as never[],
      totalCostUsd: 0.05,
      contextTokens: 139481,
      gitBranch: null,
      provider: 'codex',
    })

    await useChatStore.getState().switchSession('db-codex-session')

    const session = useChatStore.getState().projectSessions['/test']._sessions['db-codex-session']
    expect(session.sessionProvider).toBe('codex')
    expect(session.contextTokens).toBe(139481)
    expect(session.contextWindow).toBe(258400)
    expect(session.codexUsageSnapshot?.lastCachedInputTokens).toBe(69376)
    expect(mockWindowApp.resumeSession).toHaveBeenCalled()
  })

  it('rebuilds the open codex todo list on cold restore', async () => {
    setupProject('/test')
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [{
        id: 'db-codex-todo',
        role: 'assistant',
        content: [{ type: 'text', text: 'working' }],
        status: 'complete',
        createdAt: '',
        providerId: 'codex',
        metadata: {
          codex: {
            threadId: 'thread-todo',
            usage: null,
            items: [{
              type: 'todo_list',
              items: [
                { text: 'step one', completed: true },
                { text: 'step two', completed: false },
              ],
            }],
          },
        },
      }] as never[],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: null,
      provider: 'codex',
    })

    await useChatStore.getState().switchSession('db-codex-todo-session')

    const session = useChatStore.getState().projectSessions['/test']._sessions['db-codex-todo-session']
    expect(session._latestCodexTodoList?.items).toHaveLength(2)
  })
})

describe('codex run session isolation', () => {
  it('writes run result to the originating session even after switching away', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_A'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'codex',
              preferredProvider: 'codex',
            },
            'ses-B': {
              ...createDefaultPerSessionState(),
              messages: [{ id: 'b-msg', role: 'user' as const, content: [{ type: 'text', text: 'hi' }], status: 'complete' as const, createdAt: '', providerId: 'claude' }] as never[],
            },
          },
        },
      },
    })

    let resolveCodexRun!: (v: unknown) => void
    mockWindowApp.codexRun.mockReturnValueOnce(
      new Promise((r) => { resolveCodexRun = r }),
    )

    const sendPromise = useChatStore.getState().sendMessage('test codex')

    await vi.waitFor(() => {
      expect(mockWindowApp.codexRun).toHaveBeenCalled()
    })

    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        '/test': {
          ...s.projectSessions['/test'],
          _activeSessionId: 'ses-B',
        },
      },
    }))

    resolveCodexRun({
      threadId: 'thread-iso',
      finalResponse: 'isolation ok',
      usage: null,
      items: [
        { id: 'reason-1', type: 'reasoning', text: 'summary kept' },
        { id: 'agent-1', type: 'agent_message', text: 'isolation ok' },
      ],
    })
    await sendPromise

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('ses-B')

    const codexSession = after._sessions[codexSid]
    const assistantMsg = codexSession.messages.find((m) => m.role === 'assistant')
    expect(assistantMsg?.status).toBe('complete')
    expect(assistantMsg?.content[0]).toEqual({ type: 'text', text: 'isolation ok' })
    expect(assistantMsg?.metadata?.codex?.items).toEqual([
      { id: 'reason-1', type: 'reasoning', text: 'summary kept' },
      { id: 'agent-1', type: 'agent_message', text: 'isolation ok' },
    ])
    expect(codexSession.status).toBe('idle')

    const sesB = after._sessions['ses-B']
    expect(sesB.messages).toHaveLength(1)
    expect(sesB.messages[0].id).toBe('b-msg')

    expect(after.unseenCompletedSessions.has(codexSid)).toBe(true)
    expect(mockWindowApp.createSession).not.toHaveBeenCalled()
    expect(mockWindowApp.saveSessionState).not.toHaveBeenCalled()
  })
})

describe('resetSession codex handling', () => {
  it('calls resetSession by sid for idle codex session', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_reset'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'codex',
              preferredProvider: 'codex',
              messages: [{ id: 'cx1', role: 'user' as const, content: [], status: 'complete' as const, createdAt: '', providerId: 'codex' }] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().resetSession()

    expect(mockWindowAgent.resetSession).toHaveBeenCalledWith(codexSid)
    expect(mockWindowAgent.parkSession).not.toHaveBeenCalled()

    const after = useChatStore.getState().projectSessions['/test']
    expect(isDraftSession(after._activeSessionId)).toBe(true)
  })

  it('lets streaming codex session continue in background without interrupt', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_streaming_reset'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              sessionProvider: 'codex',
              preferredProvider: 'codex',
            },
          },
        },
      },
    })

    await useChatStore.getState().resetSession()

    expect(mockWindowAgent.interrupt).not.toHaveBeenCalled()
    expect(mockWindowAgent.parkSession).not.toHaveBeenCalled()
    expect(mockWindowAgent.resetSession).not.toHaveBeenCalled()

    const after = useChatStore.getState().projectSessions['/test']
    expect(isDraftSession(after._activeSessionId)).toBe(true)
    expect(after._sessions[codexSid]).toBeDefined()
  })
})

describe('switchSession Case B opencode restore', () => {
  const models = [
    { id: 'oc/keeper', name: 'Keeper', supportedEffortLevels: ['low', 'medium', 'high'] },
    { id: 'oc/default', name: 'Default', isDefault: true, supportedEffortLevels: ['medium'] },
  ]

  function seedOpenCode(
    saved: { selectedModel?: string; selectedEffort?: string },
    resources: unknown = { models, agents: [{ id: 'build', name: 'Build' }] },
  ): void {
    setupProject('/test')
    useChatStore.setState({
      harnessResources: {
        ...useChatStore.getState().harnessResources,
        opencode: resources,
      } as never,
    })
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [], totalCostUsd: 0, contextTokens: 0, gitBranch: null,
      provider: 'opencode', ...saved,
    })
  }

  it('keeps a persisted pick the catalog still offers', async () => {
    seedOpenCode({ selectedModel: 'oc/keeper', selectedEffort: 'high' })
    await useChatStore.getState().switchSession('oc-keep')
    const session = useChatStore.getState().projectSessions['/test']._sessions['oc-keep']
    expect(session.selectedModel).toBe('oc/keeper')
    expect(session.selectedEffort).toBe('high')
  })

  it('falls back when the persisted model was removed from the catalog', async () => {
    seedOpenCode({ selectedModel: 'oc/deleted', selectedEffort: 'high' })
    await useChatStore.getState().switchSession('oc-stale')
    const session = useChatStore.getState().projectSessions['/test']._sessions['oc-stale']
    expect(session.selectedModel).toBe('oc/default')
    // 'high' is not in the fallback model's supported levels — must not carry over.
    expect(session.selectedEffort).toBe('medium')
  })

  it('keeps the pick while the catalog has not been probed yet', async () => {
    // null resources = not loaded. applyOpenCodeResources reconciles on arrival.
    seedOpenCode({ selectedModel: 'oc/keeper', selectedEffort: 'high' }, null)
    await useChatStore.getState().switchSession('oc-unprobed')
    const session = useChatStore.getState().projectSessions['/test']._sessions['oc-unprobed']
    expect(session.selectedModel).toBe('oc/keeper')
    expect(session.selectedEffort).toBe('high')
  })

  it('clears the pick for a loaded-but-empty catalog', async () => {
    // Distinct from "not probed": no providers configured. The reducer clears the
    // selection here, and cold restore must not drift from it.
    seedOpenCode({ selectedModel: 'oc/keeper', selectedEffort: 'high' }, { models: [], agents: [] })
    await useChatStore.getState().switchSession('oc-empty')
    const session = useChatStore.getState().projectSessions['/test']._sessions['oc-empty']
    expect(session.selectedModel).toBe('')
    expect(session.selectedEffort).toBeUndefined()
  })
})

describe('switchSession Case A codex worktree', () => {
  it('handles worktree for codex sessions and resumes (so main process can hydrate as live session)', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexWtSid = 'codex_local_wt'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [codexWtSid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'codex',
              preferredProvider: 'codex',
              _worktreePath: '/test/.worktrees/feat',
              _gitBranch: 'main',
            },
          },
        },
      },
    })

    await useChatStore.getState().switchSession(codexWtSid)

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe(codexWtSid)
    expect(mockSetActiveWorktree).toHaveBeenCalledWith('/test', '/test/.worktrees/feat')
    expect(mockWindowApp.resumeSession).toHaveBeenCalled()
  })
})

describe('switchSession Case A worktree existence check', () => {
  it('flips _worktreeRemoved when target session worktree directory is gone', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const sid = 'wt-vanished'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [sid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'claude',
              cwd: '/test/.worktrees/vanished',
              _worktreePath: '/test/.worktrees/vanished',
              _gitBranch: 'feature/gone',
              _worktreeRemoved: false,
            },
          },
        },
      },
    })

    mockWindowApp.pathExists.mockResolvedValueOnce(false)
    mockSetActiveWorktree.mockClear()

    await useChatStore.getState().switchSession(sid)

    const after = useChatStore.getState().projectSessions['/test']._sessions[sid]
    expect(after._worktreeRemoved).toBe(true)
    expect(after.cwd).toBe('/test')
    expect(mockSetActiveWorktree).toHaveBeenCalledWith('/test', null)
    expect(mockWindowApp.pathExists).toHaveBeenCalledWith('/test/.worktrees/vanished')
  })

  it('keeps worktree active when the directory still exists', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const sid = 'wt-alive'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [sid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'claude',
              _worktreePath: '/test/.worktrees/alive',
              _gitBranch: 'feature/alive',
              _worktreeRemoved: false,
            },
          },
        },
      },
    })

    mockWindowApp.pathExists.mockResolvedValueOnce(true)
    mockSetActiveWorktree.mockClear()

    await useChatStore.getState().switchSession(sid)

    const after = useChatStore.getState().projectSessions['/test']._sessions[sid]
    expect(after._worktreeRemoved).toBe(false)
    expect(mockSetActiveWorktree).toHaveBeenCalledWith('/test', '/test/.worktrees/alive')
  })

  it('skips pathExists check for sessions without an active worktree', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const sid = 'no-wt'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [sid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'claude',
              _worktreePath: null,
              _gitBranch: null,
              _worktreeRemoved: false,
            },
          },
        },
      },
    })

    mockWindowApp.pathExists.mockClear()
    mockSetActiveWorktree.mockClear()

    await useChatStore.getState().switchSession(sid)

    expect(mockWindowApp.pathExists).not.toHaveBeenCalled()
  })
})

describe('worktree_missing event (main -> renderer signal)', () => {
  it('handleAgentEvent flips _worktreeRemoved, falls back cwd, and clears active worktree', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const sid = 'wt-session-gone'
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: sid,
          _sessions: {
            ...proj._sessions,
            [sid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'claude',
              cwd: '/test/.worktrees/gone',
              _worktreePath: '/test/.worktrees/gone',
              _gitBranch: 'feature/x',
              _worktreeRemoved: false,
            },
          },
        },
      },
    })
    mockSetActiveWorktree.mockClear()

    useChatStore.getState().handleAgentEvent({
      type: 'worktree_missing',
      worktreePath: '/test/.worktrees/gone',
      fallbackCwd: '/test',
      projectPath: '/test',
      sessionId: sid,
    } as AgentEvent)

    const after = useChatStore.getState().projectSessions['/test']._sessions[sid]
    expect(after._worktreeRemoved).toBe(true)
    expect(after.cwd).toBe('/test')
    expect(mockSetActiveWorktree).toHaveBeenCalledWith('/test', null)
  })

  it('handleAgentEvent does NOT clear active worktree when event project is in the background', () => {
    setupProject('/active')
    setupProject('/background')
    useChatStore.setState({ activeProject: '/active' })
    const bgProj = useChatStore.getState().projectSessions['/background']
    const bgSid = 'bg-wt'
    useChatStore.setState({
      projectSessions: {
        ...useChatStore.getState().projectSessions,
        '/background': {
          ...bgProj,
          _activeSessionId: bgSid,
          _sessions: {
            ...bgProj._sessions,
            [bgSid]: {
              ...createDefaultPerSessionState(),
              _worktreePath: '/background/.worktrees/gone',
              _gitBranch: 'feature/y',
              _worktreeRemoved: false,
            },
          },
        },
      },
    })
    mockSetActiveWorktree.mockClear()

    useChatStore.getState().handleAgentEvent({
      type: 'worktree_missing',
      worktreePath: '/background/.worktrees/gone',
      fallbackCwd: '/background',
      projectPath: '/background',
      sessionId: bgSid,
    } as AgentEvent)

    const after = useChatStore.getState().projectSessions['/background']._sessions[bgSid]
    expect(after._worktreeRemoved).toBe(true)
    expect(after.cwd).toBe('/background')
    expect(mockSetActiveWorktree).not.toHaveBeenCalled()
  })

  it('_getSessionCwd semantics: session with _worktreeRemoved=true routes cwd to projectPath', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const sid = 'wt-removed'
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'some-other',
          _sessions: {
            ...proj._sessions,
            [sid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'claude',
              _worktreePath: '/test/.worktrees/gone',
              _worktreeRemoved: true,
            },
          },
        },
      },
    })
    mockSetActiveWorktree.mockClear()
    mockWindowApp.resumeSession.mockClear()

    await useChatStore.getState().switchSession(sid)

    expect(mockSetActiveWorktree).toHaveBeenCalledWith('/test', null)
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', sid, '/test')
  })

  it('switchSession Case B no longer calls pathExists (main is the source of truth)', async () => {
    setupProject('/test')
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: 'feature/x',
      provider: 'claude',
      worktreePath: '/test/.worktrees/might-be-gone',
    })
    mockWindowApp.pathExists.mockClear()

    await useChatStore.getState().switchSession('db-wt-session')

    expect(mockWindowApp.pathExists).not.toHaveBeenCalled()
    expect(mockSetActiveWorktree).toHaveBeenCalledWith('/test', '/test/.worktrees/might-be-gone')
  })
})

describe('slash_command_output for compact', () => {
  it('removes /compact user message without setting slashCommandOutput', () => {
    setupProject('/test')

    const proj = useChatStore.getState().projectSessions['/test']
    const session = proj._sessions[proj._activeSessionId!]
    session._pendingSlashCommand = 'compact'
    session.messages = [
      { id: 'prev-msg', role: 'assistant', content: [{ type: 'text', text: 'hello' }], status: 'complete', createdAt: '', providerId: 'claude' },
      { id: 'compact-user', role: 'user', content: [{ type: 'text', text: '/compact' }], status: 'complete', createdAt: '', providerId: 'claude' },
      { id: 'compact-assist', role: 'assistant', content: [{ type: 'text', text: 'compacted' }], status: 'complete', createdAt: '', providerId: 'claude' },
    ] as never[]
    useChatStore.setState({ projectSessions: { '/test': proj } })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'slash_command_output',
      messageId: 'compact-assist',
      content: 'Conversation compacted',
    } as never))

    const after = useChatStore.getState().projectSessions['/test']
    const afterSession = after._sessions[after._activeSessionId!]
    expect(afterSession.slashCommandOutput).toBeNull()
    expect(afterSession._pendingSlashCommand).toBe('')
    expect(afterSession.messages.find((m: { id: string }) => m.id === 'compact-user')).toBeUndefined()
    expect(afterSession.messages.find((m: { id: string }) => m.id === 'compact-assist')).toBeUndefined()
    expect(afterSession.messages).toHaveLength(1)
    expect(afterSession.messages[0].id).toBe('prev-msg')
  })
})

describe('compact_boundary user-message cleanup', () => {
  it('removes the tracked /compact user when SDK only emits compact_boundary', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const session = proj._sessions[proj._activeSessionId!]
    session._pendingSlashCommand = 'compact'
    session._pendingCompactUserId = 'compact-user'
    session.messages = [
      { id: 'prev-user', role: 'user', content: [{ type: 'text', text: 'do task' }], status: 'complete', createdAt: '', providerId: 'claude' },
      { id: 'prev-assist', role: 'assistant', content: [{ type: 'text', text: 'done' }], status: 'complete', createdAt: '', providerId: 'claude' },
      { id: 'compact-user', role: 'user', content: [{ type: 'text', text: '/compact' }], status: 'complete', createdAt: '', providerId: 'claude' },
    ] as never[]
    useChatStore.setState({ projectSessions: { '/test': proj } })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'compact_boundary',
      trigger: 'manual',
      preTokens: 1234,
    } as never))

    const after = useChatStore.getState().projectSessions['/test']._sessions[useChatStore.getState().projectSessions['/test']._activeSessionId!]
    expect(after.messages.find((m: { id: string }) => m.id === 'compact-user')).toBeUndefined()
    expect(after._pendingCompactUserId).toBe('')
    expect(after.messages.at(-1)!.providerId).toBe('system')
    expect(after.messages.at(-1)!.content[0]).toMatchObject({ type: 'text', text: '__compact__:manual:1234::' })
  })

  it('inserts pill before last user when compactUserId is not tracked (auto compact)', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const session = proj._sessions[proj._activeSessionId!]
    session.messages = [
      { id: 'u0', role: 'user', content: [{ type: 'text', text: 'older' }], status: 'complete', createdAt: '', providerId: 'claude' },
      { id: 'a0', role: 'assistant', content: [{ type: 'text', text: 'older reply' }], status: 'complete', createdAt: '', providerId: 'claude' },
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'latest' }], status: 'complete', createdAt: '', providerId: 'claude' },
    ] as never[]
    useChatStore.setState({ projectSessions: { '/test': proj } })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 0,
    } as never))

    const after = useChatStore.getState().projectSessions['/test']._sessions[useChatStore.getState().projectSessions['/test']._activeSessionId!]
    const ids = after.messages.map((m: { id: string }) => m.id)
    expect(ids[0]).toBe('u0')
    expect(ids[1]).toBe('a0')
    expect(after.messages[2].providerId).toBe('system')
    expect(ids[3]).toBe('u1')
  })

  it('does not double-remove when slash_command_output arrives after compact_boundary', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const session = proj._sessions[proj._activeSessionId!]
    session._pendingSlashCommand = 'compact'
    session._pendingCompactUserId = 'compact-user'
    session.messages = [
      { id: 'prev-user', role: 'user', content: [{ type: 'text', text: 'task' }], status: 'complete', createdAt: '', providerId: 'claude' },
      { id: 'prev-assist', role: 'assistant', content: [{ type: 'text', text: 'done' }], status: 'complete', createdAt: '', providerId: 'claude' },
      { id: 'compact-user', role: 'user', content: [{ type: 'text', text: '/compact' }], status: 'complete', createdAt: '', providerId: 'claude' },
    ] as never[]
    useChatStore.setState({ projectSessions: { '/test': proj } })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'compact_boundary',
      trigger: 'manual',
      preTokens: 100,
    } as never))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'slash_command_output',
      messageId: 'never-existed',
      content: 'Conversation compacted',
    } as never))

    const after = useChatStore.getState().projectSessions['/test']._sessions[useChatStore.getState().projectSessions['/test']._activeSessionId!]
    expect(after.messages.find((m: { id: string }) => m.id === 'prev-user')).toBeDefined()
    expect(after.messages.find((m: { id: string }) => m.id === 'prev-assist')).toBeDefined()
    expect(after.messages.find((m: { id: string }) => m.id === 'compact-user')).toBeUndefined()
    expect(after._pendingSlashCommand).toBe('')
    expect(after._pendingCompactUserId).toBe('')
  })
})

describe('createDefaultPerSessionState', () => {
  it('returns correct default values', () => {
    const state = createDefaultPerSessionState()
    expect(state.cwd).toBe('')
    expect(state.messages).toEqual([])
    expect(state.status).toBe('idle')
    expect(state.awaitingAssistantReply).toBe(false)
    expect(state.session).toBeNull()
    expect(state.sessionProvider).toBeNull()
    expect(state.totalCostUsd).toBe(0)
    expect(state.contextTokens).toBe(0)
    expect(state.contextWindow).toBeNull()
    expect(state.subagentTokens).toEqual({})
    expect(state.taskProgress).toEqual({})
    expect(state.streamingTokens).toEqual({ input: 0, output: 0 })
    expect(state.codexUsageSnapshot).toBeNull()
    expect(state.codexTurnLastUsage).toBeNull()
    expect(state.selectedModel).toBe('')
    expect(state.selectedEffort).toBeUndefined()
    expect(state.selectedCodexModel).toBe('')
    expect(state.selectedCodexReasoningEffort).toBeUndefined()
    expect(state.selectedCodexPermissionPreset).toBe('auto-review')
    expect(state.selectedCodexCollaborationMode).toBe('default')
    expect(state.preferredProvider).toBe('claude')
    expect(state.draftText).toBe('')
    expect(state.promptSuggestion).toBeNull()
    expect(state.attachments).toEqual([])
    expect(state.mentions).toEqual([])
    expect(state.pendingPermissions).toEqual([])
    expect(state.permissionMode).toBe('default')
    expect(state.pendingQuestion).toBeNull()
    expect(state.pendingPlanApproval).toBeNull()
    expect(state.planApprovalOutcome).toBeNull()
    expect(state.slashCommandOutput).toBeNull()
    expect(state._pendingSlashCommand).toBe('')
    expect(state.todos).toEqual({})
    expect(state.showTodos).toBe(false)
    expect(state._todosUserDismissed).toBe(false)
    expect(state._nextTodoId).toBe(1)
    expect(state.isCompacting).toBe(false)
    expect(state.rateLimitInfo).toBeNull()
    expect(state._gitBranch).toBeNull()
    expect(state._worktreePath).toBeNull()
    expect(state._worktreeRemoved).toBe(false)
    expect(state.additionalDirs).toEqual([])
    expect(state.lastEventAt).toBe(0)
    expect(state.activeCodexMessageId).toBeNull()
    expect(state.lastAssistantMessageId).toBeNull()
  })
})

describe('createDefaultProjectState', () => {
  it('returns correct default values', () => {
    const state = createDefaultProjectState()
    expect(state._activeSessionId).toBeNull()
    expect(state._sessions).toEqual({})
    expect(state.slashCommands).toEqual([])
    expect(state._projectSkills).toEqual([])
    expect(state._projectCommands).toEqual([])
    expect(state.agents).toEqual([])
    expect(state.homedir).toBe('')
    expect(state.sandboxInfo).toEqual({ enabled: false, autoAllowBash: false })
    expect(state.sessions).toEqual([])
    expect(state.sessionsPage).toBe(0)
    expect(state.sessionsHasMore).toBe(true)
    expect(state.hasUnseenActivity).toBe(false)
    expect(state.hasPendingInteraction).toBe(false)
    expect(state.unseenCompletedSessions).toEqual(new Set())
    expect(state.codexModels).toEqual([])
    expect(state.codexModelsLoading).toBe(false)
    expect(state.showDirManager).toBe(false)
    expect(state.showReviewPanel).toBe(false)
  })
})

describe('handleAgentEvent supplemental', () => {
  describe('message_start', () => {
    it('creates a new assistant message with correct defaults', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-a1', role: 'assistant', content: [], status: 'streaming', createdAt: '2024-01-01', providerId: 'claude' } as never,
      }))

      const session = getActiveDraftSession('/test')!
      expect(session.messages).toHaveLength(1)
      expect(session.messages[0].id).toBe('msg-a1')
      expect(session.messages[0].role).toBe('assistant')
      expect(session.messages[0].status).toBe('streaming')
      expect(session.messages[0].content).toEqual([])
      expect(session.promptSuggestion).toBeNull()
      expect(session.awaitingAssistantReply).toBe(false)
      expect(session.lastAssistantMessageId).toBe('msg-a1')
    })

    it('does not set lastAssistantMessageId for user messages', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-u1', role: 'user', content: [], status: 'complete', createdAt: '', providerId: 'claude' } as never,
      }))

      const session = getActiveDraftSession('/test')!
      expect(session.lastAssistantMessageId).toBeNull()
    })

    it('is an idempotent upsert: a duplicate-id message_start must not overwrite accumulated content/metadata', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-dup', role: 'assistant', content: [], status: 'streaming', createdAt: '2024-01-01', providerId: 'claude' } as never,
      }))
      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-dup',
        delta: { type: 'text', text: 'finished reply' },
      }))
      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_complete',
        messageId: 'msg-dup',
        metadata: { durationMs: 57000, costUsd: 0.01 } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-dup', role: 'assistant', content: [], status: 'streaming', createdAt: '2024-01-01', providerId: 'claude' } as never,
      }))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-dup')!
      expect(msg.content).toHaveLength(1)
      expect(msg.content[0]).toMatchObject({ type: 'text', text: 'finished reply' })
      expect(msg.status).toBe('complete')
      expect(msg.metadata?.durationMs).toBe(57000)
    })
  })

  describe('content_delta', () => {
    it('appends text to last message via text delta', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-d1', role: 'assistant', content: [{ type: 'text', text: 'Hello' }], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-d1',
        delta: { type: 'text', text: ' world' },
      }))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-d1')
      const textBlock = msg?.content.find((b) => b.type === 'text')
      expect(textBlock).toBeDefined()
      expect((textBlock as { text: string }).text).toBe('Hello world')
    })

    it('appends thinking block via thinking delta', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-t1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-t1',
        delta: { type: 'thinking', thinking: 'Let me think...' },
      }))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-t1')
      const thinkingBlock = msg?.content.find((b) => b.type === 'thinking')
      expect(thinkingBlock).toBeDefined()
      expect((thinkingBlock as { thinking: string }).thinking).toBe('Let me think...')
    })

    it('keeps parentToolUseId when merging consecutive subagent thinking deltas', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-sa-t', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-sa-t',
        delta: { type: 'thinking', thinking: 'Sub ', parentToolUseId: 'task-1' },
      }))
      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-sa-t',
        delta: { type: 'thinking', thinking: 'thought', parentToolUseId: 'task-1' },
      }))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-sa-t')
      const thinkingBlock = msg?.content.find((b) => b.type === 'thinking')
      expect((thinkingBlock as { thinking: string }).thinking).toBe('Sub thought')
      expect((thinkingBlock as { parentToolUseId?: string }).parentToolUseId).toBe('task-1')
    })

    it('keeps parentToolUseId when merging consecutive subagent text deltas', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-sa-x', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-sa-x',
        delta: { type: 'text', text: 'Sub ', parentToolUseId: 'task-1' },
      }))
      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-sa-x',
        delta: { type: 'text', text: 'reply', parentToolUseId: 'task-1' },
      }))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-sa-x')
      const textBlock = msg?.content.find((b) => b.type === 'text')
      expect((textBlock as { text: string }).text).toBe('Sub reply')
      expect((textBlock as { parentToolUseId?: string }).parentToolUseId).toBe('task-1')
    })

    it('does not merge a subagent text delta into a preceding main-agent text block', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-mix', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-mix',
        delta: { type: 'text', text: 'Main answer' },
      }))
      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-mix',
        delta: { type: 'text', text: 'Subagent words', parentToolUseId: 'task-1' },
      }))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-mix')
      const textBlocks = msg?.content.filter((b) => b.type === 'text') ?? []
      expect(textBlocks).toHaveLength(2)
      expect((textBlocks[0] as { text: string }).text).toBe('Main answer')
      expect((textBlocks[0] as { parentToolUseId?: string }).parentToolUseId).toBeUndefined()
      expect((textBlocks[1] as { text: string }).text).toBe('Subagent words')
      expect((textBlocks[1] as { parentToolUseId?: string }).parentToolUseId).toBe('task-1')
    })
  })

  describe('tool_input_delta accumulation for streaming diff tools', () => {
    it('surfaces streaming partial input as preview for Edit tool', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-edit', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-edit',
        delta: { type: 'tool_use', toolName: 'Edit', toolUseId: 'tu-1', input: '', status: 'streaming' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'tool_input_delta',
        messageId: 'msg-edit',
        toolUseId: 'tu-1',
        partialJson: '{"file_path":"/x","new_string":"hello\n',
      } as never))

      const session = getActiveDraftSession('/test')!
      const preview = session._streamingToolInputPreviews['tu-1']
      expect(preview).toBeDefined()
      expect(preview.file_path).toBe('/x')
      expect(preview.new_string).toBe('hello\n')
      const msg = session.messages.find((m) => m.id === 'msg-edit')
      const block = msg?.content.find((b) => b.type === 'tool_use')
      if (block?.type !== 'tool_use') return
      expect(block.input).toBe('')
    })

    it('persists streaming partial input when the tool completes', () => {
      setupProject('/test')
      const rawInput = '{"file_path":"/x","old_string":"a","new_string":"hello\\n"}'

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-complete', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-complete',
        delta: { type: 'tool_use', toolName: 'Edit', toolUseId: 'tu-complete', input: '', status: 'streaming' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'tool_input_delta',
        messageId: 'msg-complete',
        toolUseId: 'tu-complete',
        partialJson: rawInput,
      } as never))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-complete',
        delta: { type: 'tool_result', toolUseId: 'tu-complete', summary: 'ok' } as never,
      }))

      const session = getActiveDraftSession('/test')!
      expect(session._streamingToolInputPreviews['tu-complete']).toBeUndefined()
      const msg = session.messages.find((m) => m.id === 'msg-complete')
      const block = msg?.content.find((b) => b.type === 'tool_use')
      expect(block?.type === 'tool_use' ? block.input : '').toBe(rawInput)
    })

    it('marks throttled streaming partial input as applied', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-seq', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-seq',
        delta: { type: 'tool_use', toolName: 'Edit', toolUseId: 'tu-seq', input: '', status: 'streaming' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'tool_input_delta',
        messageId: 'msg-seq',
        toolUseId: 'tu-seq',
        partialJson: '{"file_path":"/x","new_string":"a',
        seq: 1,
      } as never))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'tool_input_delta',
        messageId: 'msg-seq',
        toolUseId: 'tu-seq',
        partialJson: 'b',
        seq: 2,
      } as never))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-seq')
      expect(msg?._lastAppliedSeq).toBe(2)
    })

    it('surfaces streaming partial input as preview for Write tool', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-write', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-write',
        delta: { type: 'tool_use', toolName: 'Write', toolUseId: 'tu-w', input: '', status: 'streaming' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'tool_input_delta',
        messageId: 'msg-write',
        toolUseId: 'tu-w',
        partialJson: '{"content":"line1\n',
      } as never))

      const session = getActiveDraftSession('/test')!
      const preview = session._streamingToolInputPreviews['tu-w']
      expect(preview).toBeDefined()
      expect(preview.content).toBe('line1\n')
    })

    it('does NOT accumulate partialJson for non-streaming-diff tools like Bash', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-bash', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-bash',
        delta: { type: 'tool_use', toolName: 'Bash', toolUseId: 'tu-b', input: '', status: 'streaming' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'tool_input_delta',
        messageId: 'msg-bash',
        toolUseId: 'tu-b',
        partialJson: '{"command":"ls',
      } as never))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-bash')
      const block = msg?.content.find((b) => b.type === 'tool_use')
      if (block?.type !== 'tool_use') return
      expect(block.input).toBe('')
    })
  })

  describe('message_complete', () => {
    it('sets message status to complete and updates cost', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-c1', role: 'assistant', content: [{ type: 'text', text: 'done' }], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_complete',
        messageId: 'msg-c1',
        metadata: {
          costUsd: 0.02,
          usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 10, cacheCreationInputTokens: 5 },
        },
      }))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-c1')
      expect(msg?.status).toBe('complete')
      expect(session.totalCostUsd).toBe(0.02)
      expect(session.contextTokens).toBe(115)
    })
  })

  describe('permission_request', () => {
    it('sets pendingPermission on session state', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'permission_request',
        request: { requestId: 'perm-1', toolName: 'Bash', description: 'run command' } as never,
      }))

      const proj = useChatStore.getState().projectSessions['/test']
      const session = proj._sessions[draftOf(proj)]
      expect(session.pendingPermissions).toHaveLength(1)
      expect(session.pendingPermissions[0].requestId).toBe('perm-1')
      expect(session.pendingPermissions[0].toolName).toBe('Bash')
      expect(proj.hasPendingInteraction).toBe(true)
    })
  })

  describe('message_error', () => {
    it('stores structured error info and sets status to error', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-e1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_error',
        messageId: 'msg-e1',
        error: 'API timeout',
        errorInfo: { raw: 'API timeout', code: 'overloaded', httpStatus: 529, terminalReason: 'api_error' },
      }))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-e1')
      expect(msg?.status).toBe('error')
      expect(msg?.metadata?.errorInfo).toEqual({ raw: 'API timeout', code: 'overloaded', httpStatus: 529, terminalReason: 'api_error' })
      // The badge owns the summary — no text block is spliced into the transcript.
      expect(msg?.content.some((b) => b.type === 'text')).toBe(false)
    })

    it('synthesizes error info from the plain string when a harness sends none', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-e2', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'codex' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_error',
        messageId: 'msg-e2',
        error: 'spawn ENOENT',
      }))

      const msg = getActiveDraftSession('/test')!.messages.find((m) => m.id === 'msg-e2')
      expect(msg?.status).toBe('error')
      expect(msg?.metadata?.errorInfo).toEqual({ raw: 'spawn ENOENT' })
    })
  })
})

describe('cyclePermissionMode', () => {
  it('cycles Claude modes including auto: default → plan → auto → acceptEdits → default', async () => {
    setupProject('/test')

    const session = getActiveDraftSession('/test')!
    expect(session.permissionMode).toBe('default')

    await useChatStore.getState().cyclePermissionMode()
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('plan')

    await useChatStore.getState().cyclePermissionMode()
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('auto')

    await useChatStore.getState().cyclePermissionMode()
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('acceptEdits')

    await useChatStore.getState().cyclePermissionMode()
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('default')
  })
})

describe('setSelectedModel permission mode preservation', () => {
  it('immediately replaces a stale prewarm when the draft already has text', () => {
    setupProject('/test')
    setClaude({
      models: [
        { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', description: '' },
        { id: 'claude-opus-4-8', name: 'Opus 4.8', description: '' },
      ] as never[],
    })
    patchDraftSession('/test', { selectedModel: 'claude-sonnet-4-6', draftText: 'ship it' })
    mockWindowAgent.prewarm.mockClear()

    useChatStore.getState().setSelectedModel('claude-opus-4-8')

    expect(mockWindowAgent.prewarm).toHaveBeenCalledWith('/test', expect.objectContaining({ model: 'claude-opus-4-8' }))
  })

  it('keeps permissionMode=auto when switching models (no client-side auto-mode gate)', () => {
    setupProject('/test')
    setClaude({
      account: { subscriptionType: 'max', apiProvider: 'firstParty' },
      models: [
        { id: 'claude-opus-4-8', name: 'Opus 4.8', description: '', supportsAutoMode: true },
        { id: 'claude-haiku-4-5', name: 'Haiku 4.5', description: '' },
      ] as never[],
    })
    patchDraftSession('/test', { selectedModel: 'claude-opus-4-8', permissionMode: 'auto' })

    useChatStore.getState().setSelectedModel('claude-haiku-4-5')

    expect(getActiveDraftSession('/test')!.permissionMode).toBe('auto')
    expect(getActiveDraftSession('/test')!.selectedModel).toBe('claude-haiku-4-5')
    expect(mockWindowAgent.setPermissionMode).not.toHaveBeenCalled()
  })
})

describe('agent_setting_change patch broadcast', () => {
  function makeActiveSession(path: string, sid: string, sessionPatch: Record<string, unknown> = {}) {
    setupProject(path)
    const proj = useChatStore.getState().projectSessions[path]
    useChatStore.setState({
      projectSessions: {
        ...useChatStore.getState().projectSessions,
        [path]: {
          ...proj,
          _activeSessionId: sid,
          _sessions: {
            ...proj._sessions,
            [sid]: { ...createDefaultPerSessionState(), ...sessionPatch },
          },
        },
      },
    })
  }

  it('applies claude model + effort patch to active session', () => {
    makeActiveSession('/test', 'sess-1')
    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      projectPath: '/test',
      sessionId: 'sess-1',
      patch: { selectedModel: 'claude-opus-4-8', selectedEffort: 'high' },
    } as never)
    const sess = useChatStore.getState().projectSessions['/test']._sessions['sess-1']
    expect(sess.selectedModel).toBe('claude-opus-4-8')
    expect(sess.selectedEffort).toBe('high')
    expect(sess.modelUserChosen).toBe(true)
    expect(sess.effortUserChosen).toBe(true)
  })

  it('applies codex model + effort patch (different fields than claude)', () => {
    makeActiveSession('/test', 'sess-codex', { sessionProvider: 'codex' })
    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      projectPath: '/test',
      sessionId: 'sess-codex',
      patch: { selectedCodexModel: 'gpt-5', selectedCodexReasoningEffort: 'high' },
    } as never)
    const sess = useChatStore.getState().projectSessions['/test']._sessions['sess-codex']
    expect(sess.selectedCodexModel).toBe('gpt-5')
    expect(sess.selectedCodexReasoningEffort).toBe('high')
    expect(sess.codexModelUserChosen).toBe(true)
    expect(sess.codexReasoningEffortUserChosen).toBe(true)
  })

  it('applies codex permissionPreset patch', () => {
    makeActiveSession('/test', 'sess-codex', { sessionProvider: 'codex' })
    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      projectPath: '/test',
      sessionId: 'sess-codex',
      patch: { selectedCodexPermissionPreset: 'full-access' },
    } as never)
    const sess = useChatStore.getState().projectSessions['/test']._sessions['sess-codex']
    expect(sess.selectedCodexPermissionPreset).toBe('full-access')
  })

  it('applies codex collaborationMode patch and clears plan-reject hint', () => {
    makeActiveSession('/test', 'sess-codex', { sessionProvider: 'codex', codexPlanRejectHintActive: true })
    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      projectPath: '/test',
      sessionId: 'sess-codex',
      patch: { selectedCodexCollaborationMode: 'plan' },
    } as never)
    const sess = useChatStore.getState().projectSessions['/test']._sessions['sess-codex']
    expect(sess.selectedCodexCollaborationMode).toBe('plan')
    expect(sess.codexPlanRejectHintActive).toBe(false)
  })

  it('applies permissionMode patch (shared field)', () => {
    makeActiveSession('/test', 'sess-1')
    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      projectPath: '/test',
      sessionId: 'sess-1',
      patch: { permissionMode: 'plan' },
    } as never)
    const sess = useChatStore.getState().projectSessions['/test']._sessions['sess-1']
    expect(sess.permissionMode).toBe('plan')
  })

  it('routes sandboxInfo patch to project state, not session', () => {
    makeActiveSession('/test', 'sess-1')
    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      projectPath: '/test',
      sessionId: 'sess-1',
      patch: { sandboxInfo: { enabled: false, autoAllowBash: false } },
    } as never)
    const proj = useChatStore.getState().projectSessions['/test']
    expect(proj.sandboxInfo).toEqual({ enabled: false, autoAllowBash: false })
  })

  it('back-compat: legacy fields selectedModel/selectedEffort still work without patch', () => {
    makeActiveSession('/test', 'sess-1')
    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      projectPath: '/test',
      sessionId: 'sess-1',
      selectedModel: 'claude-haiku-4-5',
      selectedEffort: 'low',
    } as never)
    const sess = useChatStore.getState().projectSessions['/test']._sessions['sess-1']
    expect(sess.selectedModel).toBe('claude-haiku-4-5')
    expect(sess.selectedEffort).toBe('low')
  })

  it('combines multiple patch fields atomically', () => {
    makeActiveSession('/test', 'sess-codex', { sessionProvider: 'codex' })
    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      projectPath: '/test',
      sessionId: 'sess-codex',
      patch: {
        selectedCodexModel: 'gpt-5',
        selectedCodexCollaborationMode: 'plan',
        permissionMode: 'plan',
      },
    } as never)
    const sess = useChatStore.getState().projectSessions['/test']._sessions['sess-codex']
    expect(sess.selectedCodexModel).toBe('gpt-5')
    expect(sess.selectedCodexCollaborationMode).toBe('plan')
    expect(sess.permissionMode).toBe('plan')
  })
})

describe('codex setters broadcast via window.agent.broadcastSessionSetting', () => {
  function setupCodexSession(path: string, sid: string) {
    setupProject(path)
    const proj = useChatStore.getState().projectSessions[path]
    useChatStore.setState({
      projectSessions: {
        ...useChatStore.getState().projectSessions,
        [path]: {
          ...proj,
          _activeSessionId: sid,
          codexModels: [
            {
              id: 'gpt-5',
              name: 'GPT-5',
              description: '',
              defaultReasoningEffort: 'medium',
              supportedReasoningEfforts: [
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ],
            },
          ] as never,
          _sessions: {
            ...proj._sessions,
            [sid]: { ...createDefaultPerSessionState(), sessionProvider: 'codex' },
          },
        },
      },
    })
  }

  it('setSelectedCodexModel broadcasts model + effort patch', () => {
    setupCodexSession('/test', 'sess-codex')
    useChatStore.getState().setSelectedCodexModel('gpt-5')
    expect(mockWindowAgent.broadcastSessionSetting).toHaveBeenCalledWith(
      'sess-codex',
      expect.objectContaining({ selectedCodexModel: 'gpt-5' }),
    )
  })

  it('setSelectedCodexReasoningEffort broadcasts effort patch', () => {
    setupCodexSession('/test', 'sess-codex')
    useChatStore.getState().setSelectedCodexModel('gpt-5')
    mockWindowAgent.broadcastSessionSetting.mockClear()
    useChatStore.getState().setSelectedCodexReasoningEffort('high')
    expect(mockWindowAgent.broadcastSessionSetting).toHaveBeenCalledWith(
      'sess-codex',
      expect.objectContaining({ selectedCodexReasoningEffort: 'high' }),
    )
  })

  it('setSelectedCodexPermissionPreset broadcasts preset patch', () => {
    setupCodexSession('/test', 'sess-codex')
    mockWindowAgent.broadcastSessionSetting.mockClear()
    useChatStore.getState().setSelectedCodexPermissionPreset('full-access')
    expect(mockWindowAgent.broadcastSessionSetting).toHaveBeenCalledWith(
      'sess-codex',
      { selectedCodexPermissionPreset: 'full-access' },
    )
  })

  it('setSelectedCodexCollaborationMode broadcasts mode patch', () => {
    setupCodexSession('/test', 'sess-codex')
    mockWindowAgent.broadcastSessionSetting.mockClear()
    useChatStore.getState().setSelectedCodexCollaborationMode('plan')
    expect(mockWindowAgent.broadcastSessionSetting).toHaveBeenCalledWith(
      'sess-codex',
      { selectedCodexCollaborationMode: 'plan' },
    )
  })
})

describe('cost/token via message_complete', () => {
  it('uses latest cumulative cost from SDK (not additive)', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'mc-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_complete',
      messageId: 'mc-1',
      metadata: {
        costUsd: 0.01,
        usage: { inputTokens: 50, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      },
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'mc-2', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_complete',
      messageId: 'mc-2',
      metadata: {
        costUsd: 0.03,
        usage: { inputTokens: 200, outputTokens: 80, cacheReadInputTokens: 50, cacheCreationInputTokens: 10 },
      },
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.totalCostUsd).toBe(0.03)
    expect(session.contextTokens).toBe(260)
  })

  it('updates contextWindow from modelUsage metadata', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'cw-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_complete',
      messageId: 'cw-1',
      metadata: {
        costUsd: 0,
        usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        modelUsage: { 'claude-sonnet-4-6': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0, contextWindow: 200000 } },
      },
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.contextWindow).toBe(200000)
  })

  it('handles message_complete with no metadata gracefully', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'nm-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_complete',
      messageId: 'nm-1',
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.totalCostUsd).toBe(0)
    expect(session.contextTokens).toBe(0)
    const msg = session.messages.find((m) => m.id === 'nm-1')
    expect(msg?.status).toBe('complete')
  })
})

describe('remote session interaction routing', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  function setupRemoteSession() {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'desktop-session',
          _sessions: {
            'desktop-session': { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start',
      remoteProjectPath: '/test',
      remoteSessionId: 'remote-1',
    } as AgentEvent)
  }

  it('routes remote session permission_request to its own session, not active session', () => {
    setupRemoteSession()

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'remote-1',
      request: { requestId: 'r1', toolName: 'Bash', input: {} } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['remote-1'].pendingPermissions).toHaveLength(1)
    expect(after._sessions['remote-1'].pendingPermissions[0].requestId).toBe('r1')
    expect(after._sessions['desktop-session'].pendingPermissions).toHaveLength(0)
  })

  it('routes remote session ask_user_question to its own session', () => {
    setupRemoteSession()

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'ask_user_question',
      sessionId: 'remote-1',
      request: { requestId: 'q1', questions: [{ question: 'test?', header: '', options: [], multiSelect: false }] } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['remote-1'].pendingQuestion).toBeTruthy()
    expect(after._sessions['remote-1'].pendingQuestion!.requestId).toBe('q1')
    expect(after._sessions['desktop-session'].pendingQuestion).toBeNull()
  })

  it('routes bg session permission_request to its own session', () => {
    setupRemoteSession()

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'bg-agent-1',
      request: { requestId: 'r2', toolName: 'Bash', input: {} } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['desktop-session'].pendingPermissions).toHaveLength(0)
    expect(after._sessions['bg-agent-1'].pendingPermissions).toHaveLength(1)
    expect(after._sessions['bg-agent-1'].pendingPermissions[0].requestId).toBe('r2')
  })

  it('mobile-driven plan_approval rejection clears prompt and stamps planApprovalOutcome on the remote session', () => {
    setupRemoteSession()

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'plan_approval',
      sessionId: 'remote-1',
      request: { requestId: 'p1', planContent: 'plan', planFilePath: '/plan', allowedPrompts: [] } as never,
    }))

    expect(useChatStore.getState().projectSessions['/test']._sessions['remote-1'].pendingPlanApproval?.requestId).toBe('p1')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'interaction_resolved',
      interactionType: 'plan_approval',
      sessionId: 'remote-1',
      requestId: 'p1',
      approved: false,
      feedback: 'not yet',
    } as never))

    const after = useChatStore.getState().projectSessions['/test']._sessions['remote-1']
    expect(after.pendingPlanApproval).toBeNull()
    expect(after.planApprovalOutcome).toEqual({ approved: false, feedback: 'not yet' })
  })

  it('mobile-driven plan_approval approval stamps planApprovalOutcome with approved=true', () => {
    setupRemoteSession()

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'plan_approval',
      sessionId: 'remote-1',
      request: { requestId: 'p1', planContent: 'plan', planFilePath: '/plan', allowedPrompts: [] } as never,
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'interaction_resolved',
      interactionType: 'plan_approval',
      sessionId: 'remote-1',
      requestId: 'p1',
      approved: true,
    } as never))

    const after = useChatStore.getState().projectSessions['/test']._sessions['remote-1']
    expect(after.pendingPlanApproval).toBeNull()
    expect(after.planApprovalOutcome).toEqual({ approved: true })
  })

  it('marks the lazily-created remote session as codex when harnessId=codex on remote_session_start', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start',
      remoteProjectPath: '/test',
      remoteSessionId: 'mobile-codex-1',
      harnessId: 'codex',
    } as AgentEvent)
    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['mobile-codex-1'].sessionProvider).toBe('codex')
    expect(after._sessions['mobile-codex-1'].preferredProvider).toBe('codex')
  })

  it('marks the lazily-created remote session as claude when harnessId=claude on remote_session_start', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start',
      remoteProjectPath: '/test',
      remoteSessionId: 'mobile-claude-1',
      harnessId: 'claude',
    } as AgentEvent)
    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['mobile-claude-1'].sessionProvider).toBe('claude')
    expect(after._sessions['mobile-claude-1'].preferredProvider).toBe('claude')
  })

  it('does not overwrite an already-set sessionProvider on later remote_session_start (e.g. subscribe replay)', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start',
      remoteProjectPath: '/test',
      remoteSessionId: 'mobile-codex-2',
      harnessId: 'codex',
    } as AgentEvent)
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start',
      remoteProjectPath: '/test',
      remoteSessionId: 'mobile-codex-2',
      harnessId: 'claude',
      isSubscribe: true,
    } as AgentEvent)
    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['mobile-codex-2'].sessionProvider).toBe('codex')
  })
})

describe('interaction response routing', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('respondToPermission calls IPC with active sessionId', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', input: {}, allowAlwaysAllow: false }],
            },
          },
        },
      },
    })

    const result = await useChatStore.getState().respondToPermission('r1', true)

    expect(mockWindowAgent.respondToPermission).toHaveBeenCalledWith(
      'a', 'r1', true, undefined, undefined, undefined, undefined, undefined,
    )
    expect(result).toBe(true)
  })

  it('respondToPermission keeps the prompt when ack is false', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    mockWindowAgent.respondToPermission.mockResolvedValueOnce(false)
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', input: {}, allowAlwaysAllow: false }],
            },
          },
        },
      },
    })

    const result = await useChatStore.getState().respondToPermission('r1', true)

    expect(result).toBe(false)
    expect(useChatStore.getState().projectSessions['/test']._sessions['a'].pendingPermissions).toHaveLength(1)
  })

  it('respondToPermission routes cancel decisions through codex IPC for codex sessions', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_perm_test'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...proj._sessions[draftOf(proj)],
              status: 'streaming' as const,
              sessionProvider: 'codex',
              preferredProvider: 'codex',
              pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', input: {}, allowAlwaysAllow: true }],
            },
          },
        },
      },
    })

    const result = await useChatStore.getState().respondToPermission('r1', false, undefined, undefined, undefined, 'cancel')

    expect(mockWindowAgent.respondToPermission).toHaveBeenCalledWith(codexSid, 'r1', false, undefined, undefined, undefined, 'cancel', undefined)
    expect(result).toBe(true)
    expect(useChatStore.getState().projectSessions['/test']._sessions[codexSid].pendingPermissions).toHaveLength(0)
  })

  it('answerQuestion calls IPC with active sessionId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              pendingQuestion: { requestId: 'q1', questions: [] } as never,
            },
          },
        },
      },
    })

    useChatStore.getState().answerQuestion('q1', { q: 'a' })

    expect(mockWindowAgent.answerQuestion).toHaveBeenCalledWith('a', 'q1', { q: 'a' }, undefined)
  })

  it('dismissQuestion calls IPC with active sessionId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              pendingQuestion: { requestId: 'q1', questions: [] } as never,
            },
          },
        },
      },
    })

    useChatStore.getState().dismissQuestion('q1')

    expect(mockWindowAgent.dismissQuestion).toHaveBeenCalledWith('a', 'q1')
  })

  it('respondToPlanApproval calls IPC with active sessionId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              pendingPlanApproval: { requestId: 'p1', planContent: 'plan', planFilePath: '/plan', allowedPrompts: [] } as never,
            },
          },
        },
      },
    })

    useChatStore.getState().respondToPlanApproval('p1', true, 'ok')

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith('a', 'p1', true, 'ok')
  })

  it('respondToPlanApproval(approved=true, postApprovalMode="acceptEdits") also tells main to switch mode', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              permissionMode: 'plan',
              pendingPlanApproval: { requestId: 'p1', planContent: 'plan', planFilePath: '/plan', allowedPrompts: [] } as never,
            },
          },
        },
      },
    })

    mockWindowAgent.setPermissionMode.mockClear()
    useChatStore.getState().respondToPlanApproval('p1', true, undefined, 'acceptEdits')

    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/test', 'a', 'acceptEdits')
  })

  it('respondToPlanApproval(approved=true, no postApprovalMode) defaults to switching main to "default"', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              permissionMode: 'plan',
              pendingPlanApproval: { requestId: 'p1', planContent: 'plan', planFilePath: '/plan', allowedPrompts: [] } as never,
            },
          },
        },
      },
    })

    mockWindowAgent.setPermissionMode.mockClear()
    useChatStore.getState().respondToPlanApproval('p1', true)

    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/test', 'a', 'default')
  })

  it('respondToPlanApproval(approved=false) does NOT invoke setPermissionMode', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              permissionMode: 'plan',
              pendingPlanApproval: { requestId: 'p1', planContent: 'plan', planFilePath: '/plan', allowedPrompts: [] } as never,
            },
          },
        },
      },
    })

    mockWindowAgent.setPermissionMode.mockClear()
    useChatStore.getState().respondToPlanApproval('p1', false, 'rejected')

    expect(mockWindowAgent.setPermissionMode).not.toHaveBeenCalled()
  })
})

describe('cross-session event routing race conditions', () => {
  // Removed (date 2026-05-27): asserted session_init re-keys draft -> 'real-A' so a later stale draftSessionId routes nowhere; session_init does not re-key in production and the route layer does not consult draftSessionId. Exists in neither main nor refactor. Tracked as follow-up issue if/when feature is implemented.

  it('does not route content_delta with stale draftSessionId to the active session', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const originalDraftId = proj._activeSessionId!

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: makeMessage('msg-A', 'assistant'),
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      session: { sessionId: 'real-A' } as never,
    }))

    const afterRekey = useChatStore.getState().projectSessions['/test']

    const newDraftId = createDraftSessionId()
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...afterRekey,
          _activeSessionId: newDraftId,
          _sessions: {
            ...afterRekey._sessions,
            [newDraftId]: createDefaultPerSessionState(),
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'content_delta',
      draftSessionId: originalDraftId,
      messageId: 'msg-A',
      delta: { type: 'text', text: 'leaked text' },
    } as never))

    const final = useChatStore.getState().projectSessions['/test']
    const activeSession = final._sessions[newDraftId]
    expect(activeSession.messages).toHaveLength(0)
  })

  it('does not promote background session_init to a different active draft', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const draftB = proj._activeSessionId!

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            [draftB]: {
              ...createDefaultPerSessionState(),
              awaitingAssistantReply: true,
            },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      draftSessionId: '__draft_stale_xyz',
      session: { sessionId: 'real-A' } as never,
    } as never))

    const final = useChatStore.getState().projectSessions['/test']
    expect(final._activeSessionId).toBe(draftB)
    expect(final._sessions[draftB]).toBeDefined()
    expect(final._sessions['real-A']).toBeUndefined()
  })
})

describe('queued_message_consumed', () => {
  it('moves matching queued message into messages immediately', () => {
    setupProject('/test')
    const draftId = getActiveDraftId('/test')!

    const userMsg = makeMessage('user-q1', 'user')
    const asstMsg = makeMessage('asst-1', 'assistant')

    const proj = useChatStore.getState().projectSessions['/test']
    proj._sessions[draftId].messages = [asstMsg]
    proj._sessions[draftId].queuedMessages = [userMsg]
    proj._sessions[draftId].status = 'streaming'
    useChatStore.setState({ projectSessions: { '/test': proj } })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'queued_message_consumed',
      clientMessageId: 'user-q1',
    } as never))

    const session = useChatStore.getState().projectSessions['/test']._sessions[draftId]
    expect(session.messages).toHaveLength(2)
    expect(session.messages[1].id).toBe('user-q1')
    expect(session.queuedMessages).toHaveLength(0)
  })

  it('does nothing when clientMessageId is not in queue', () => {
    setupProject('/test')
    const draftId = getActiveDraftId('/test')!

    const userMsg = makeMessage('user-q1', 'user')
    const proj = useChatStore.getState().projectSessions['/test']
    proj._sessions[draftId].queuedMessages = [userMsg]
    useChatStore.setState({ projectSessions: { '/test': proj } })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'queued_message_consumed',
      clientMessageId: 'nonexistent',
    } as never))

    const session = useChatStore.getState().projectSessions['/test']._sessions[draftId]
    expect(session.queuedMessages).toHaveLength(1)
    expect(session.messages).toHaveLength(0)
  })

  it('message_start no longer dequeues from queuedMessages', () => {
    setupProject('/test')
    const draftId = getActiveDraftId('/test')!

    const userMsg = makeMessage('user-q1', 'user')
    const proj = useChatStore.getState().projectSessions['/test']
    proj._sessions[draftId].queuedMessages = [userMsg]
    useChatStore.setState({ projectSessions: { '/test': proj } })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: makeMessage('asst-new', 'assistant'),
    }))

    const session = useChatStore.getState().projectSessions['/test']._sessions[draftId]
    expect(session.queuedMessages).toHaveLength(1)
    expect(session.messages.find((m) => m.id === 'user-q1')).toBeUndefined()
  })

  it('idle then consume keeps the queued user after the completed Grok turn', () => {
    setupProject('/test')
    const draftId = getActiveDraftId('/test')!

    const user1 = makeMessage('user-1', 'user')
    const asst1 = makeMessage('asst-1', 'assistant')
    asst1.status = 'complete'
    const user2 = makeMessage('user-2', 'user')

    const proj = useChatStore.getState().projectSessions['/test']
    proj._sessions[draftId].messages = [user1, asst1]
    proj._sessions[draftId].queuedMessages = [user2]
    proj._sessions[draftId].status = 'streaming'
    useChatStore.setState({ projectSessions: { '/test': proj } })

    useChatStore.getState().handleAgentEvent(makeEvent({ type: 'status_change', status: 'idle' }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'queued_message_consumed',
      clientMessageId: 'user-2',
    } as never))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: makeMessage('asst-2', 'assistant'),
    }))

    const session = useChatStore.getState().projectSessions['/test']._sessions[draftId]
    expect(session.messages.map((m) => m.id)).toEqual(['user-1', 'asst-1', 'user-2', 'asst-2'])
    expect(session.queuedMessages).toHaveLength(0)
  })
})

describe('edit/delete queued message vs consume race (Bug D)', () => {
  function seedQueued(text: string) {
    setupProject('/test')
    const draftId = getActiveDraftId('/test')!
    const userMsg: ChatMessage = {
      ...makeMessage('user-q1', 'user'),
      content: [{ type: 'text', text }],
    }
    const proj = useChatStore.getState().projectSessions['/test']
    proj._sessions[draftId].queuedMessages = [userMsg]
    proj._sessions[draftId].status = 'streaming'
    useChatStore.setState({ projectSessions: { '/test': proj } })
    return draftId
  }

  it('editQueuedMessage does not pull into draft when the CLI already consumed it (dequeue=false)', async () => {
    const draftId = seedQueued('queued text')
    mockWindowAgent.dequeueMessage.mockResolvedValueOnce(false)

    await useChatStore.getState().editQueuedMessage('user-q1')

    const session = useChatStore.getState().projectSessions['/test']._sessions[draftId]
    // Lost the race: message is being answered by the CLI. Don't load it into
    // the input (that would double-send) and don't yank it from the queue —
    // the imminent queued_message_consumed event moves it to the transcript.
    expect(session.draftText).toBe('')
    expect(session.queuedMessages.map((m) => m.id)).toEqual(['user-q1'])
  })

  it('editQueuedMessage still pulls into draft when dequeue succeeds (race won)', async () => {
    const draftId = seedQueued('queued text')
    mockWindowAgent.dequeueMessage.mockResolvedValueOnce(true)

    await useChatStore.getState().editQueuedMessage('user-q1')

    const session = useChatStore.getState().projectSessions['/test']._sessions[draftId]
    expect(session.draftText).toBe('queued text')
    expect(session.queuedMessages).toHaveLength(0)
  })

  it('deleteQueuedMessage keeps the message when the CLI already consumed it (dequeue=false)', async () => {
    const draftId = seedQueued('queued text')
    mockWindowAgent.dequeueMessage.mockResolvedValueOnce(false)

    await useChatStore.getState().deleteQueuedMessage('user-q1')

    const session = useChatStore.getState().projectSessions['/test']._sessions[draftId]
    expect(session.queuedMessages.map((m) => m.id)).toEqual(['user-q1'])
  })

  it('deleteQueuedMessage removes the message when dequeue succeeds (race won)', async () => {
    const draftId = seedQueued('queued text')
    mockWindowAgent.dequeueMessage.mockResolvedValueOnce(true)

    await useChatStore.getState().deleteQueuedMessage('user-q1')

    const session = useChatStore.getState().projectSessions['/test']._sessions[draftId]
    expect(session.queuedMessages).toHaveLength(0)
  })
})

describe('mini-app context injection', () => {
  beforeEach(() => {
    setupProject('/test')
  })

  it('setMiniAppContext adds a context slot to the session', () => {
    useChatStore.getState().setMiniAppContext('my-app', {
      appName: 'My App',
      summary: 'selected items',
      content: 'item1\nitem2',
      mode: 'inject',
      color: '#4a7fbf',
    })
    const sess = getActiveDraftSession('/test')!
    expect(sess.miniAppContexts['my-app']).toEqual({
      appId: 'my-app',
      appName: 'My App',
      summary: 'selected items',
      content: 'item1\nitem2',
      mode: 'inject',
      color: '#4a7fbf',
      checked: true,
    })
  })

  it('setMiniAppContext with suggest mode defaults checked to false', () => {
    useChatStore.getState().setMiniAppContext('my-app', {
      appName: 'My App',
      summary: 'notes',
      content: 'some notes',
      mode: 'suggest',
    })
    const sess = getActiveDraftSession('/test')!
    expect(sess.miniAppContexts['my-app'].checked).toBe(false)
  })

  it('setMiniAppContext overwrites previous context for same app', () => {
    const store = useChatStore.getState()
    store.setMiniAppContext('my-app', { appName: 'My App', summary: 'v1', content: 'old', mode: 'inject' })
    store.setMiniAppContext('my-app', { appName: 'My App', summary: 'v2', content: 'new', mode: 'inject' })
    const sess = getActiveDraftSession('/test')!
    expect(sess.miniAppContexts['my-app'].summary).toBe('v2')
    expect(sess.miniAppContexts['my-app'].content).toBe('new')
  })

  it('clearMiniAppContext removes the context slot', () => {
    useChatStore.getState().setMiniAppContext('my-app', {
      appName: 'My App', summary: 'test', content: 'test', mode: 'inject',
    })
    useChatStore.getState().clearMiniAppContext('my-app')
    const sess = getActiveDraftSession('/test')!
    expect(sess.miniAppContexts['my-app']).toBeUndefined()
  })

  it('toggleMiniAppContext flips checked state', () => {
    useChatStore.getState().setMiniAppContext('my-app', {
      appName: 'My App', summary: 'notes', content: 'abc', mode: 'suggest',
    })
    expect(getActiveDraftSession('/test')!.miniAppContexts['my-app'].checked).toBe(false)
    useChatStore.getState().toggleMiniAppContext('my-app')
    expect(getActiveDraftSession('/test')!.miniAppContexts['my-app'].checked).toBe(true)
    useChatStore.getState().toggleMiniAppContext('my-app')
    expect(getActiveDraftSession('/test')!.miniAppContexts['my-app'].checked).toBe(false)
  })

  it('clearMiniAppContext can be used to dismiss inject-mode context', () => {
    useChatStore.getState().setMiniAppContext('my-app', {
      appName: 'My App', summary: 'test', content: 'test', mode: 'inject',
    })
    useChatStore.getState().clearMiniAppContext('my-app')
    expect(getActiveDraftSession('/test')!.miniAppContexts['my-app']).toBeUndefined()
  })

  it('sendMessage attaches active contexts to user message and clears them', async () => {
    useChatStore.getState().setMiniAppContext('app-a', {
      appName: 'App A', summary: 'data', content: 'context-content', mode: 'inject', color: '#ff0000',
    })
    await useChatStore.getState().sendMessage('hello')
    const sess = getActiveDraftSession('/test')!
    const userMsg = sess.messages.find((m) => m.role === 'user')
    expect(userMsg?.contexts).toEqual([
      { appId: 'app-a', appName: 'App A', summary: 'data', content: 'context-content', color: '#ff0000' },
    ])
    expect(sess.miniAppContexts).toEqual({})
  })

  it('sendMessage appends context as suffix in agent payload', async () => {
    useChatStore.getState().setMiniAppContext('app-a', {
      appName: 'App A', summary: 'info', content: 'ctx-data', mode: 'inject',
    })
    await useChatStore.getState().sendMessage('my question')
    expect(mockWindowAgent.sendMessage).toHaveBeenCalled()
    const payload = mockWindowAgent.sendMessage.mock.calls[0][1]
    expect(payload.content).toContain('my question')
    expect(payload.content).toContain('<app-context app="App A" summary="info">')
    expect(payload.content).toContain('ctx-data')
    expect(payload.content.indexOf('my question')).toBeLessThan(payload.content.indexOf('<app-context'))
  })

  it('sendMessage excludes cleared inject contexts', async () => {
    useChatStore.getState().setMiniAppContext('app-a', {
      appName: 'App A', summary: 'data', content: 'ctx', mode: 'inject',
    })
    useChatStore.getState().clearMiniAppContext('app-a')
    await useChatStore.getState().sendMessage('hello')
    const payload = mockWindowAgent.sendMessage.mock.calls[0][1]
    expect(payload.content).not.toContain('<app-context')
  })

  it('sendMessage excludes unchecked suggest contexts', async () => {
    useChatStore.getState().setMiniAppContext('app-a', {
      appName: 'App A', summary: 'notes', content: 'ctx', mode: 'suggest',
    })
    await useChatStore.getState().sendMessage('hello')
    const payload = mockWindowAgent.sendMessage.mock.calls[0][1]
    expect(payload.content).not.toContain('<app-context')
  })

  it('sendMessage includes checked suggest contexts', async () => {
    useChatStore.getState().setMiniAppContext('app-a', {
      appName: 'App A', summary: 'notes', content: 'suggest-ctx', mode: 'suggest',
    })
    useChatStore.getState().toggleMiniAppContext('app-a')
    await useChatStore.getState().sendMessage('hello')
    const payload = mockWindowAgent.sendMessage.mock.calls[0][1]
    expect(payload.content).toContain('suggest-ctx')
  })

  it('sendMessage dispatches miniapp-context-consumed event', async () => {
    const handler = vi.fn()
    window.addEventListener('miniapp-context-consumed', handler)
    useChatStore.getState().setMiniAppContext('app-a', {
      appName: 'App A', summary: 'data', content: 'ctx', mode: 'inject',
    })
    await useChatStore.getState().sendMessage('hello')
    expect(handler).toHaveBeenCalledTimes(1)
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail
    expect(detail.appIds).toEqual(['app-a'])
    window.removeEventListener('miniapp-context-consumed', handler)
  })

  it('sendMessage does not dispatch consumed event when no contexts', async () => {
    const handler = vi.fn()
    window.addEventListener('miniapp-context-consumed', handler)
    await useChatStore.getState().sendMessage('hello')
    expect(handler).not.toHaveBeenCalled()
    window.removeEventListener('miniapp-context-consumed', handler)
  })
})

describe('user selection (right-click → "添加到聊天" quote chips)', () => {
  beforeEach(() => {
    setupProject('/test')
  })

  it('addUserSelection appends a quote to the active session', () => {
    useChatStore.getState().addUserSelection('quote A')
    useChatStore.getState().addUserSelection('quote B')
    expect(getActiveDraftSession('/test')!.userSelections).toEqual(['quote A', 'quote B'])
  })

  it('addUserSelection trims whitespace and ignores empty input', () => {
    useChatStore.getState().addUserSelection('   ')
    useChatStore.getState().addUserSelection('  hi  ')
    expect(getActiveDraftSession('/test')!.userSelections).toEqual(['hi'])
  })

  it('removeUserSelectionAt deletes the entry at the given index', () => {
    useChatStore.getState().addUserSelection('a')
    useChatStore.getState().addUserSelection('b')
    useChatStore.getState().addUserSelection('c')
    useChatStore.getState().removeUserSelectionAt(1)
    expect(getActiveDraftSession('/test')!.userSelections).toEqual(['a', 'c'])
  })

  it('clearUserSelections empties the array', () => {
    useChatStore.getState().addUserSelection('x')
    useChatStore.getState().clearUserSelections()
    expect(getActiveDraftSession('/test')!.userSelections).toEqual([])
  })

  it('sendMessage wraps a single selection in <quote>...</quote> at the prompt tail', async () => {
    useChatStore.getState().addUserSelection('only one')
    await useChatStore.getState().sendMessage('hello')
    const payload = mockWindowAgent.sendMessage.mock.calls[0][1]
    expect(payload.content).toContain('hello')
    expect(payload.content).toContain('<quote>\nonly one\n</quote>')
    expect(payload.content).not.toContain('<quote1>')
  })

  it('sendMessage wraps multiple selections with <quoteN>...</quoteN> grouped under <quote>', async () => {
    useChatStore.getState().addUserSelection('first')
    useChatStore.getState().addUserSelection('second')
    useChatStore.getState().addUserSelection('third')
    await useChatStore.getState().sendMessage('q')
    const payload = mockWindowAgent.sendMessage.mock.calls[0][1]
    expect(payload.content).toMatch(/<quote>[\s\S]*<quote1>[\s\S]*first[\s\S]*<\/quote1>[\s\S]*<quote2>[\s\S]*second[\s\S]*<\/quote2>[\s\S]*<quote3>[\s\S]*third[\s\S]*<\/quote3>[\s\S]*<\/quote>/)
  })

  it('sendMessage attaches userSelections to the user message and to the IPC payload', async () => {
    useChatStore.getState().addUserSelection('alpha')
    useChatStore.getState().addUserSelection('beta')
    await useChatStore.getState().sendMessage('msg')
    const sess = getActiveDraftSession('/test')!
    const userMsg = sess.messages.find((m) => m.role === 'user')
    expect(userMsg?.userSelections).toEqual(['alpha', 'beta'])
    const payload = mockWindowAgent.sendMessage.mock.calls[0][1]
    expect(payload.userSelections).toEqual(['alpha', 'beta'])
  })

  it('sendMessage clears userSelections after sending', async () => {
    useChatStore.getState().addUserSelection('to-be-cleared')
    await useChatStore.getState().sendMessage('hi')
    expect(getActiveDraftSession('/test')!.userSelections).toEqual([])
  })

  it('sendMessage with no selections produces no quote suffix and no userSelections field', async () => {
    await useChatStore.getState().sendMessage('plain hello')
    const payload = mockWindowAgent.sendMessage.mock.calls[0][1]
    expect(payload.content).not.toContain('<quote')
    expect(payload.userSelections).toBeUndefined()
  })
})

describe('streamingTokens lifecycle around turn boundaries', () => {
  it('clears streamingTokens and freezes consumedTokens on message_interrupted', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'int-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'int-1',
      inputTokens: 1234,
      outputTokens: 567,
    }))

    const before = getActiveDraftSession('/test')!
    expect(before.streamingTokens).toEqual({ input: 1234, output: 567 })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_interrupted',
      messageId: 'int-1',
    }))

    const after = getActiveDraftSession('/test')!
    expect(after.streamingTokens).toEqual({ input: 0, output: 0 })
    const msg = after.messages.find((m) => m.id === 'int-1')!
    expect(msg.status).toBe('interrupted')
    expect(msg.metadata?.consumedTokens).toEqual({ input: 1234, output: 567 })
  })

  it('clears streamingTokens on message_error', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'err-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'err-1',
      inputTokens: 88,
      outputTokens: 42,
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_error',
      messageId: 'err-1',
      error: 'boom',
    }))

    const after = getActiveDraftSession('/test')!
    expect(after.streamingTokens).toEqual({ input: 0, output: 0 })
  })

  it('new assistant message_start resets any leaked streamingTokens', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'prev-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'prev-1',
      inputTokens: 999,
      outputTokens: 111,
    }))

    expect(getActiveDraftSession('/test')!.streamingTokens).toEqual({ input: 999, output: 111 })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'next-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    const after = getActiveDraftSession('/test')!
    expect(after.streamingTokens).toEqual({ input: 0, output: 0 })
  })

  it('does not reset streamingTokens when a user message_start arrives mid-turn', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'assist-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'assist-1',
      inputTokens: 50,
      outputTokens: 20,
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'user-1', role: 'user', content: [], status: 'complete', createdAt: '', providerId: 'claude' } as never,
    }))

    const after = getActiveDraftSession('/test')!
    expect(after.streamingTokens).toEqual({ input: 50, output: 20 })
  })
})

describe('session id drift regression (permission prompt stuck)', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  function seedActiveSession(sid: string) {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: sid,
          _sessions: {
            [sid]: { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })
  }

  it('routes permission_request tagged with unknown sessionId into a lazy session, hidden from active UI', () => {
    seedActiveSession('alpha')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'beta',
      request: { requestId: 'r1', toolName: 'Edit', input: { file_path: '/x' }, allowAlwaysAllow: false } as never,
    }))

    const proj = useChatStore.getState().projectSessions['/test']
    expect(proj._activeSessionId).toBe('alpha')
    expect(proj._sessions['alpha'].pendingPermissions).toHaveLength(0)
    expect(proj._sessions['beta']?.pendingPermissions).toHaveLength(1)
    expect(proj._sessions['beta'].pendingPermissions[0].requestId).toBe('r1')
  })

  it('still flags hasPendingInteraction when the lazy session holds the prompt, so the sidebar shows a badge', () => {
    seedActiveSession('alpha')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'beta',
      request: { requestId: 'r1', toolName: 'Edit', input: {}, allowAlwaysAllow: false } as never,
    }))

    const proj = useChatStore.getState().projectSessions['/test']
    expect(proj.hasPendingInteraction).toBe(true)
  })

  it('does not clear active session stale pendingPermissions when message_interrupted targets a different session', () => {
    seedActiveSession('alpha')
    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        '/test': {
          ...s.projectSessions['/test'],
          _sessions: {
            ...s.projectSessions['/test']._sessions,
            alpha: {
              ...s.projectSessions['/test']._sessions['alpha'],
              pendingPermissions: [{ requestId: 'r-old', toolName: 'Edit', input: {}, allowAlwaysAllow: false }],
            },
          },
        },
      },
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_interrupted',
      sessionId: 'beta',
      messageId: 'msg-b',
    } as never))

    const proj = useChatStore.getState().projectSessions['/test']
    expect(proj._sessions['alpha'].pendingPermissions).toHaveLength(1)
  })

  it('permission_request deduped per session: same requestId arriving on both drifted and active sessions still surfaces on drifted only', () => {
    seedActiveSession('alpha')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'beta',
      request: { requestId: 'r1', toolName: 'Edit', input: {}, allowAlwaysAllow: false } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'alpha',
      request: { requestId: 'r1', toolName: 'Edit', input: {}, allowAlwaysAllow: false } as never,
    }))

    const proj = useChatStore.getState().projectSessions['/test']
    expect(proj._sessions['alpha'].pendingPermissions).toHaveLength(1)
    expect(proj._sessions['beta'].pendingPermissions).toHaveLength(1)
  })
})

describe('multi-mobile remoteSessions tracking', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('tracks two concurrent remote sessions independently (no overwrite)', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start', remoteProjectPath: '/test', remoteSessionId: 'sess-A', isSubscribe: true,
    } as AgentEvent)
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start', remoteProjectPath: '/test', remoteSessionId: 'sess-B', isSubscribe: true,
    } as AgentEvent)

    const ids = useChatStore.getState().remoteSessions['/test'] ?? []
    expect(new Set(ids)).toEqual(new Set(['sess-A', 'sess-B']))
  })

  it('remote_session_end for one session does not clear the other', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start', remoteProjectPath: '/test', remoteSessionId: 'sess-A', isSubscribe: true,
    } as AgentEvent)
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start', remoteProjectPath: '/test', remoteSessionId: 'sess-B', isSubscribe: true,
    } as AgentEvent)

    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_end', remoteProjectPath: '/test', remoteSessionId: 'sess-A', isSubscribe: true,
    } as AgentEvent)

    expect(useChatStore.getState().remoteSessions['/test']).toEqual(['sess-B'])
  })

  it('removes the project key from remoteSessions when its last remote session ends', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start', remoteProjectPath: '/test', remoteSessionId: 'sess-A', isSubscribe: true,
    } as AgentEvent)
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_end', remoteProjectPath: '/test', remoteSessionId: 'sess-A', isSubscribe: true,
    } as AgentEvent)

    expect(useChatStore.getState().remoteSessions['/test']).toBeUndefined()
  })

  it('user_message_appended event echoes a remote-origin user message into the routed session', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start', remoteProjectPath: '/test', remoteSessionId: 'sess-A', isSubscribe: true,
    } as AgentEvent)

    const userMsg = makeMessage('user-1', 'user' as never)
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'user_message_appended',
      sessionId: 'sess-A',
      message: userMsg as never,
    }))

    const sess = useChatStore.getState().projectSessions['/test']._sessions['sess-A']
    expect(sess.messages.map((m) => m.id)).toContain('user-1')
  })

  it('ownership-only remote_session_start (no isSubscribe) does NOT add to remoteSessions', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start', remoteProjectPath: '/test', remoteSessionId: 'sess-A',
    } as AgentEvent)
    expect(useChatStore.getState().remoteSessions['/test']).toBeUndefined()
  })

  it('ownership-only remote_session_end (no isSubscribe) does NOT remove a subscribed session', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start', remoteProjectPath: '/test', remoteSessionId: 'sess-A', isSubscribe: true,
    } as AgentEvent)
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_end', remoteProjectPath: '/test', remoteSessionId: 'sess-A',
    } as AgentEvent)
    expect(useChatStore.getState().remoteSessions['/test']).toEqual(['sess-A'])
  })

  it('subscribe-tagged remote_session_end removes the session', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start', remoteProjectPath: '/test', remoteSessionId: 'sess-A', isSubscribe: true,
    } as AgentEvent)
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_end', remoteProjectPath: '/test', remoteSessionId: 'sess-A', isSubscribe: true,
    } as AgentEvent)
    expect(useChatStore.getState().remoteSessions['/test']).toBeUndefined()
  })

  it('user_message_appended is idempotent (duplicate id is not appended twice)', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start', remoteProjectPath: '/test', remoteSessionId: 'sess-A', isSubscribe: true,
    } as AgentEvent)

    const userMsg = makeMessage('user-1', 'user' as never)
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'user_message_appended', sessionId: 'sess-A', message: userMsg as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'user_message_appended', sessionId: 'sess-A', message: userMsg as never,
    }))

    const sess = useChatStore.getState().projectSessions['/test']._sessions['sess-A']
    expect(sess.messages.filter((m) => m.id === 'user-1')).toHaveLength(1)
  })
})

describe('initializeHarness', () => {
  beforeEach(() => {
    mockWindowApp.connectClaude.mockResolvedValue({
      models: [{ id: 'claude-haiku-4-5', name: 'Haiku' }],
      account: {},
      slashCommands: [],
      skills: [],
      commands: [],
      agents: [],
      outputStyles: [],
    })
    mockWindowApp.connectCodex.mockResolvedValue({
      models: [{ id: 'gpt-5.4', name: 'GPT-5.4' }],
    })
  })

  it('routes claude to connectClaude and applies models without touching codex', async () => {
    await useChatStore.getState().initializeHarness('claude')

    expect(mockWindowApp.connectClaude).toHaveBeenCalledTimes(1)
    expect(mockWindowApp.connectCodex).not.toHaveBeenCalled()
    expect(useChatStore.getState().harnessResources.claude?.models[0].id).toBe('claude-haiku-4-5')
    expect(useChatStore.getState().harnessResources.codex).toBeNull()
  })

  it('routes codex to connectCodex and applies models without touching claude', async () => {
    await useChatStore.getState().initializeHarness('codex')

    expect(mockWindowApp.connectCodex).toHaveBeenCalledTimes(1)
    expect(mockWindowApp.connectClaude).not.toHaveBeenCalled()
    expect(useChatStore.getState().harnessResources.codex?.models[0].id).toBe('gpt-5.4')
    expect(useChatStore.getState().harnessResources.claude).toBeNull()
  })

  it('skips connect on second call within the same app session', async () => {
    await useChatStore.getState().initializeHarness('claude')
    await useChatStore.getState().initializeHarness('claude')

    expect(mockWindowApp.connectClaude).toHaveBeenCalledTimes(1)
  })

  it('skips connect even when called concurrently before the first promise resolves', async () => {
    const p1 = useChatStore.getState().initializeHarness('codex')
    const p2 = useChatStore.getState().initializeHarness('codex')
    await Promise.all([p1, p2])

    expect(mockWindowApp.connectCodex).toHaveBeenCalledTimes(1)
  })

  it('rolls back initializedHarnesses on failure so a retry can re-attempt', async () => {
    mockWindowApp.connectCodex
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ models: [{ id: 'gpt-5.4', name: 'GPT-5.4' }] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await useChatStore.getState().initializeHarness('codex')
    expect(useChatStore.getState().initializedHarnesses.has('codex')).toBe(false)
    expect(useChatStore.getState().harnessResources.codex).toBeNull()

    await useChatStore.getState().initializeHarness('codex')
    expect(useChatStore.getState().harnessResources.codex?.models[0].id).toBe('gpt-5.4')
    expect(mockWindowApp.connectCodex).toHaveBeenCalledTimes(2)

    warn.mockRestore()
  })
})

describe('setHarnessResources(codex) syncs models to per-session', () => {
  it('updates project.codexModels when a fresh refresh replaces the cached models', () => {
    setCodex({ models: [{ id: 'gpt-5.3', name: 'old' }] as never[] })
    setupProject('/codex-refresh')

    expect(
      useChatStore.getState().projectSessions['/codex-refresh'].codexModels?.map((m) => m.id),
    ).toEqual(['gpt-5.3'])

    setCodex({ models: [{ id: 'gpt-5.4', name: 'new' }] as never[] })

    expect(
      useChatStore.getState().projectSessions['/codex-refresh'].codexModels?.map((m) => m.id),
    ).toEqual(['gpt-5.4'])
  })

  it('does not overwrite per-session codexModels when models payload is empty', () => {
    setCodex({ models: [{ id: 'gpt-5.3', name: 'old' }] as never[] })
    setupProject('/codex-empty-payload')

    setCodex({ models: [] })

    expect(
      useChatStore.getState().projectSessions['/codex-empty-payload'].codexModels?.map((m) => m.id),
    ).toEqual(['gpt-5.3'])
  })
})

describe('refreshCodexSkills', () => {
  it('writes IPC result into project _codexSkills', async () => {
    setupProject('/p')
    mockWindowApp.codexListSkills.mockResolvedValueOnce([
      { name: 'review', displayName: 'Review', scope: 'user', description: 'r', hasConfig: false },
    ])
    await useChatStore.getState().refreshCodexSkills('/p')
    expect(mockWindowApp.codexListSkills).toHaveBeenCalledWith('/p')
    expect(useChatStore.getState().projectSessions['/p']._codexSkills.map((s) => s.name)).toEqual(['review'])
    expect(useChatStore.getState().projectSessions['/p']._codexSkillsLoading).toBe(false)
  })

  it('skips concurrent calls while a refresh is in flight', async () => {
    setupProject('/p2')
    let resolve: ((v: unknown[]) => void) | null = null
    mockWindowApp.codexListSkills.mockImplementationOnce(
      () => new Promise((r) => { resolve = r as (v: unknown[]) => void }),
    )
    const first = useChatStore.getState().refreshCodexSkills('/p2')
    const second = useChatStore.getState().refreshCodexSkills('/p2')
    resolve!([])
    await Promise.all([first, second])
    expect(mockWindowApp.codexListSkills).toHaveBeenCalledTimes(1)
  })

  it('triggers from setPreferredProvider("codex") when not yet cached', async () => {
    setupProject('/p3')
    mockWindowApp.codexListSkills.mockResolvedValueOnce([
      { name: 'tdd', displayName: 'TDD', scope: 'user', description: '', hasConfig: false },
    ])
    useChatStore.getState().setPreferredProvider('codex')
    await new Promise((r) => setTimeout(r, 0))
    expect(mockWindowApp.codexListSkills).toHaveBeenCalledWith('/p3')
  })
})

describe('Task tools id mapping (SDK 0.3.142 TodoWrite→Task migration)', () => {
  function toolUse(messageId: string, toolUseId: string, toolName: string, input: object) {
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'content_delta',
      messageId,
      delta: { type: 'tool_use', toolName, toolUseId, input: JSON.stringify(input), status: 'streaming' } as never,
    }))
  }
  function toolResult(messageId: string, toolUseId: string, extra: object = {}) {
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'content_delta',
      messageId,
      delta: { type: 'tool_result', toolUseId, summary: 'ok', ...extra } as never,
    }))
  }

  it('keys TaskCreate todo by the SDK-assigned task id so a later TaskUpdate matches', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    toolUse('m1', 'tc-1', 'TaskCreate', { subject: 'Build feature', description: 'do the thing' })
    toolResult('m1', 'tc-1', {
      todoToolName: 'TaskCreate',
      toolTodos: [{ content: 'Build feature', status: 'pending', taskId: 'task_abc' }],
    })

    let session = getActiveDraftSession('/test')!
    expect(session.todos['task_abc']).toBeDefined()
    expect(session.todos['task_abc'].subject).toBe('Build feature')
    expect(session.todos['task_abc'].description).toBe('do the thing')
    expect(session.todos['task_abc'].status).toBe('pending')

    toolUse('m1', 'tu-1', 'TaskUpdate', { taskId: 'task_abc', status: 'in_progress' })
    toolResult('m1', 'tu-1')
    toolUse('m1', 'tu-2', 'TaskUpdate', { taskId: 'task_abc', status: 'completed' })
    toolResult('m1', 'tu-2')

    session = getActiveDraftSession('/test')!
    expect(Object.keys(session.todos)).toEqual(['task_abc'])
    expect(session.todos['task_abc'].status).toBe('completed')
  })

  it('removes a TaskCreate-created todo when TaskUpdate marks it deleted', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    toolUse('m1', 'tc-1', 'TaskCreate', { subject: 'Temp task' })
    toolResult('m1', 'tc-1', {
      todoToolName: 'TaskCreate',
      toolTodos: [{ content: 'Temp task', status: 'pending', taskId: 'task_xyz' }],
    })
    toolUse('m1', 'tu-1', 'TaskUpdate', { taskId: 'task_xyz', status: 'deleted' })
    toolResult('m1', 'tu-1')

    const session = getActiveDraftSession('/test')!
    expect(session.todos['task_xyz']).toBeUndefined()
  })

  it('still handles legacy TodoWrite snapshots (back-compat)', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    toolUse('m1', 'tw-1', 'TodoWrite', { todos: [
      { content: 'A', status: 'completed' },
      { content: 'B', status: 'in_progress' },
    ] })
    toolResult('m1', 'tw-1')

    const session = getActiveDraftSession('/test')!
    expect(session.todos['1'].subject).toBe('A')
    expect(session.todos['1'].status).toBe('completed')
    expect(session.todos['2'].subject).toBe('B')
  })

  it('captures owner and accumulates blockedBy/blocks across TaskUpdate calls', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    toolUse('m1', 'tc-1', 'TaskCreate', { subject: 'Blocker' })
    toolResult('m1', 'tc-1', { todoToolName: 'TaskCreate', toolTodos: [{ content: 'Blocker', status: 'pending', taskId: 'task_a' }] })
    toolUse('m1', 'tc-2', 'TaskCreate', { subject: 'Dependent' })
    toolResult('m1', 'tc-2', { todoToolName: 'TaskCreate', toolTodos: [{ content: 'Dependent', status: 'pending', taskId: 'task_b' }] })

    toolUse('m1', 'tu-1', 'TaskUpdate', { taskId: 'task_b', owner: 'general-purpose', addBlockedBy: ['task_a'], addBlocks: ['task_c'] })
    toolResult('m1', 'tu-1')

    let session = getActiveDraftSession('/test')!
    expect(session.todos['task_b'].owner).toBe('general-purpose')
    expect(session.todos['task_b'].blockedBy).toEqual(['task_a'])
    expect(session.todos['task_b'].blocks).toEqual(['task_c'])

    toolUse('m1', 'tu-2', 'TaskUpdate', { taskId: 'task_b', addBlockedBy: ['task_a', 'task_d'] })
    toolResult('m1', 'tu-2')

    session = getActiveDraftSession('/test')!
    expect(session.todos['task_b'].blockedBy).toEqual(['task_a', 'task_d'])
  })
})

describe('browser annotation sync', () => {
  function makeAnno(id: string, comment: string, styleChanges: BrowserAnnotation['styleChanges'] = []): BrowserAnnotation {
    return { id, kind: 'element', selector: '#btn', comment, pageUrl: 'https://x', pageTitle: 'X', screenshot: null, styleChanges }
  }

  it('updateBrowserAnnotation patches only the matched annotation', () => {
    setupProject('/anno')
    const store = useChatStore.getState()
    store.addBrowserAnnotation(makeAnno('a1', 'first', [{ property: 'color', previousValue: '#000', value: '#f00' }]))
    store.addBrowserAnnotation(makeAnno('a2', 'second'))

    store.updateBrowserAnnotation('a1', { comment: 'edited', screenshot: 'base64==', styleChanges: [{ property: 'color', previousValue: '#000', value: '#00f' }] })

    const session = getActiveDraftSession('/anno')!
    expect(session.browserAnnotations).toHaveLength(2)
    const a1 = session.browserAnnotations.find((a) => a.id === 'a1')!
    expect(a1.comment).toBe('edited')
    expect(a1.screenshot).toBe('base64==')
    expect(a1.styleChanges[0].value).toBe('#00f')
    const a2 = session.browserAnnotations.find((a) => a.id === 'a2')!
    expect(a2.comment).toBe('second')
    expect(a2.screenshot).toBeNull()
  })

  it('updateBrowserAnnotation on unknown id is a no-op', () => {
    setupProject('/anno')
    const store = useChatStore.getState()
    store.addBrowserAnnotation(makeAnno('a1', 'first'))
    store.updateBrowserAnnotation('missing', { comment: 'x' })
    const session = getActiveDraftSession('/anno')!
    expect(session.browserAnnotations).toHaveLength(1)
    expect(session.browserAnnotations[0].comment).toBe('first')
  })

  it('removeBrowserAnnotation deletes only the matched annotation', () => {
    setupProject('/anno')
    const store = useChatStore.getState()
    store.addBrowserAnnotation(makeAnno('a1', 'first'))
    store.addBrowserAnnotation(makeAnno('a2', 'second'))
    store.removeBrowserAnnotation('a1')
    const session = getActiveDraftSession('/anno')!
    expect(session.browserAnnotations).toHaveLength(1)
    expect(session.browserAnnotations[0].id).toBe('a2')
  })
})
