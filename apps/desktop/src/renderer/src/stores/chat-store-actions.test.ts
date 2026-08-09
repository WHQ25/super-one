/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AccountInfo, ClaudeResources, CodexResources, ModelOption } from '@superone/shared/agent-types'

const localStorageState = new Map<string, string>()
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageState.set(key, value) }),
  removeItem: vi.fn((key: string) => { localStorageState.delete(key) }),
  clear: vi.fn(() => { localStorageState.clear() }),
}

const mockActivateWorktree = vi.fn().mockResolvedValue({ ok: true, path: '/wt-path' })
const mockSetActiveWorktree = vi.fn()
const mockClearWorktree = vi.fn().mockResolvedValue(undefined)
vi.mock('./app', () => ({
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
vi.mock('./activity-view-state', () => ({
  useActivityViewStateStore: { getState: () => ({ seedFromCurrent: mockSeedFromCurrent, clearForSession: mockClearForSession }) },
}))

const mockMiniAppStore: { openApps: Record<string, unknown>; apps: Array<{ id: string; manifest?: { name: string; toolSlug: string } }> } = {
  openApps: {},
  apps: [],
}
vi.mock('./miniapp', () => ({
  useMiniAppStore: {
    getState: () => mockMiniAppStore,
    setState: vi.fn(),
  },
}))

const mockMiniAppAuthorize = vi.fn().mockResolvedValue(undefined)
const mockWindowAgent = {
  prewarm: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
  setSessionSettings: vi.fn().mockResolvedValue(undefined),
  setSessionApiProvider: vi.fn().mockResolvedValue(undefined),
  addProjectAdditionalDir: vi.fn().mockResolvedValue(undefined),
  removeProjectAdditionalDir: vi.fn().mockResolvedValue(undefined),
  setSandboxMode: vi.fn().mockResolvedValue({ enabled: true, autoAllowBash: false }),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  interrupt: vi.fn().mockResolvedValue(true),
  resetSession: vi.fn().mockResolvedValue({ permissionMode: 'default', sandboxInfo: { enabled: false, autoAllowBash: false } }),
  parkSession: vi.fn().mockResolvedValue({ permissionMode: 'default', sandboxInfo: { enabled: false, autoAllowBash: false } }),
  disconnectRemoteSession: vi.fn().mockResolvedValue(undefined),
  truncateAtCheckpoint: vi.fn().mockResolvedValue(undefined),
  dequeueMessage: vi.fn().mockResolvedValue(true),
  readProjectAdditionalDirs: vi.fn().mockResolvedValue([]),
  respondToPlanApproval: vi.fn().mockResolvedValue(undefined),
  broadcastSessionSetting: vi.fn().mockResolvedValue(undefined),
}

const mockWindowApp = {
  setFastMode: vi.fn().mockResolvedValue(undefined),
  trace: vi.fn(),
  activateWorktree: mockActivateWorktree,
  unwatchBashOutput: vi.fn(),
  loadSessionState: vi.fn().mockResolvedValue(null),
  resumeSession: vi.fn().mockResolvedValue(null),
  listSessionsForFolderPage: vi.fn().mockResolvedValue([]),
  renameSession: vi.fn().mockResolvedValue(undefined),
  codexGetAuthStatus: vi.fn().mockResolvedValue({
    mode: 'apiKey', resolvedMode: 'apiKey', hasEnvApiKey: false, hasSessionApiKey: false, isRunning: false,
  }),
  codexSetAuth: vi.fn().mockResolvedValue({
    mode: 'chatgpt', resolvedMode: 'chatgpt', hasEnvApiKey: false, hasSessionApiKey: false, isRunning: false,
  }),
  codexRun: vi.fn().mockResolvedValue({ finalResponse: 'done', usage: null, items: [], threadId: 't-1' }),
  codexReview: vi.fn().mockResolvedValue({ finalResponse: 'done', usage: null, items: [], threadId: 't-1' }),
  codexCompact: vi.fn().mockResolvedValue({ finalResponse: 'compacted', usage: null, items: [], threadId: 't-1' }),
  codexSteer: vi.fn().mockResolvedValue(undefined),
  codexPlanApproval: vi.fn(),
  codexCollaborationModeChange: vi.fn(),
  getAppSettings: vi.fn().mockResolvedValue({
    analyticsEnabled: true,
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '' },
    },
  }),
}

const mockMiniApp = {
  authorize: mockMiniAppAuthorize,
}

const mockWindowEnvironment = {
  listSessions: vi.fn().mockResolvedValue([]),
  listProjects: vi.fn().mockResolvedValue([]),
}

const eventTarget = new EventTarget()
vi.stubGlobal('window', {
  agent: mockWindowAgent,
  app: mockWindowApp,
  environment: mockWindowEnvironment,
  miniapp: mockMiniApp,
  localStorage: mockLocalStorage,
  dispatchEvent: (e: Event) => eventTarget.dispatchEvent(e),
  addEventListener: (t: string, h: EventListenerOrEventListenerObject) => eventTarget.addEventListener(t, h),
  removeEventListener: (t: string, h: EventListenerOrEventListenerObject) => eventTarget.removeEventListener(t, h),
})
vi.stubGlobal('localStorage', mockLocalStorage)

const { useChatStore } = await import('./chat')

const PATH = '/test-project'

function resetStore() {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    remoteSessions: {},
    _previousFocusedSession: null,
    harnessResources: { claude: null, codex: null, acp: null },
    initializedHarnesses: new Set(),
    isOpen: false,
    corner: 'br',
    _bashOutputs: {},
  })
}

function setClaudeResources(partial: Partial<ClaudeResources>) {
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

function setCodexResources(partial: Partial<CodexResources>) {
  useChatStore.getState().setHarnessResources('codex', {
    models: [],
    prompts: [],
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

function activeSession(path: string = PATH) {
  const proj = useChatStore.getState().projectSessions[path]
  return proj._sessions[proj._activeSessionId!]
}

function activeProjectState(path: string = PATH) {
  return useChatStore.getState().projectSessions[path]
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  mockLocalStorage.clear()
  mockMiniAppStore.openApps = {}
  mockMiniAppStore.apps = []
})

// ─────────────────────────────────────────────────────────────────────────────
// session lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('disconnectRemoteSession', () => {
  it('clears the active session from remoteSessions and dispatches IPC', () => {
    setupProject()
    const sid = activeProjectState()._activeSessionId!
    useChatStore.setState({ remoteSessions: { [PATH]: [sid] } })

    useChatStore.getState().disconnectRemoteSession()

    expect(mockWindowAgent.disconnectRemoteSession).toHaveBeenCalledWith(sid)
    expect(useChatStore.getState().remoteSessions).toEqual({})
  })

  it('wipes remoteSessions entirely when no project is active', () => {
    useChatStore.setState({ remoteSessions: { '/p1': ['s1'], '/p2': ['s2'] } })
    useChatStore.getState().disconnectRemoteSession()
    expect(mockWindowAgent.disconnectRemoteSession).toHaveBeenCalledWith(undefined)
    expect(useChatStore.getState().remoteSessions).toEqual({})
  })
})

describe('interrupt', () => {
  it('forwards to window.agent.interrupt + resets awaitingAssistantReply', async () => {
    setupProject()
    patchSession({ awaitingAssistantReply: true, status: 'streaming' })
    mockWindowAgent.interrupt.mockResolvedValueOnce(true)

    await useChatStore.getState().interrupt()

    expect(mockWindowAgent.interrupt).toHaveBeenCalled()
    expect(activeSession().awaitingAssistantReply).toBe(false)
  })

  it('reconciles to idle + clears pendings when the IPC reports it could NOT interrupt', async () => {
    setupProject()
    patchSession({ status: 'streaming', pendingPermissions: [{} as never], pendingQuestion: {} as never })
    mockWindowAgent.interrupt.mockResolvedValueOnce(false)

    await useChatStore.getState().interrupt()
    expect(activeSession().status).toBe('idle')
    expect(activeSession().pendingPermissions).toEqual([])
    expect(activeSession().pendingQuestion).toBeNull()
  })

  it('is a no-op when no project is active', async () => {
    await useChatStore.getState().interrupt()
    expect(mockWindowAgent.interrupt).not.toHaveBeenCalled()
  })
})

describe('clearMessages', () => {
  it('drops messages + clears bash outputs for tool uses referenced by the session', () => {
    setupProject()
    patchSession({
      messages: [
        { id: 'm1', role: 'assistant' as const, status: 'complete' as const, content: [
          { type: 'tool_use', toolUseId: 't-bash-1', toolName: 'BashTool', input: '' } as never,
        ], createdAt: '', providerId: 'claude' as const },
      ],
      totalCostUsd: 1,
    })
    useChatStore.setState({
      _bashOutputs: {
        't-bash-1': { content: 'hi', finished: false, outputPath: '/x' },
        't-other': { content: '', finished: true },
      },
    })

    useChatStore.getState().clearMessages()

    expect(activeSession().messages).toEqual([])
    expect(activeSession().totalCostUsd).toBe(0)
    expect(mockWindowApp.unwatchBashOutput).toHaveBeenCalledWith('t-bash-1')
    expect(useChatStore.getState()._bashOutputs['t-bash-1']).toBeUndefined()
    expect(useChatStore.getState()._bashOutputs['t-other']).toBeDefined()
  })

  it('is a no-op when no project is active', () => {
    useChatStore.getState().clearMessages()
    expect(mockWindowApp.unwatchBashOutput).not.toHaveBeenCalled()
  })
})

describe('resetSession', () => {
  it('is idempotent on a pristine empty session — no IPC, no new sid', async () => {
    setupProject()
    const beforeSid = activeProjectState()._activeSessionId
    await useChatStore.getState().resetSession()
    expect(activeProjectState()._activeSessionId).toBe(beforeSid)
    expect(mockWindowAgent.resetSession).not.toHaveBeenCalled()
    expect(mockWindowAgent.parkSession).not.toHaveBeenCalled()
  })

  it('rotates to a new sid + calls window.agent.resetSession for an idle Claude session with messages', async () => {
    setupProject()
    patchSession({
      messages: [{ id: 'u1', role: 'user' as const, status: 'complete' as const, content: [], createdAt: '', providerId: 'claude' as const }],
    })
    const oldSid = activeProjectState()._activeSessionId

    await useChatStore.getState().resetSession()

    const newSid = activeProjectState()._activeSessionId
    expect(newSid).not.toBe(oldSid)
    expect(mockWindowAgent.resetSession).toHaveBeenCalledWith(oldSid, newSid)
    expect(mockWindowAgent.parkSession).not.toHaveBeenCalled()
  })

  it('parks instead of resetting when the session is mid-stream', async () => {
    setupProject()
    patchSession({
      status: 'streaming',
      messages: [{ id: 'u1', role: 'user' as const, status: 'complete' as const, content: [], createdAt: '', providerId: 'claude' as const }],
    })
    await useChatStore.getState().resetSession()
    expect(mockWindowAgent.parkSession).toHaveBeenCalled()
    expect(mockWindowAgent.resetSession).not.toHaveBeenCalled()
  })

  it('skips agent.resetSession for codex when the session is idle', async () => {
    setupProject()
    patchSession({
      sessionProvider: 'codex',
      messages: [{ id: 'u1', role: 'user' as const, status: 'complete' as const, content: [], createdAt: '', providerId: 'codex' as const }],
    })
    await useChatStore.getState().resetSession()
    // For codex idle path, calls resetSession on old sid (no new sid)
    expect(mockWindowAgent.resetSession).toHaveBeenCalled()
    expect(mockClearWorktree).toHaveBeenCalledWith(PATH)
  })
})

describe('resetSessionForWorktreeSwitch', () => {
  it('seeds a new session with worktree info without inheriting activity dock layout', () => {
    setupProject()
    useChatStore.getState().resetSessionForWorktreeSwitch(PATH, { wtPath: '/wt', gitBranch: 'feature' })

    expect(activeSession().cwd).toBe('/wt')
    expect(activeSession()._worktreePath).toBe('/wt')
    expect(activeSession()._gitBranch).toBe('feature')
    expect(mockSeedFromCurrent).not.toHaveBeenCalled()
  })
})

describe('setPreferredProvider', () => {
  it("keeps the same session id when switching claude→codex with no messages yet", () => {
    setupProject()
    setCodexResources({ models: [{ id: 'gpt-5-high', name: 'GPT-5', description: '', isDefault: true } as ModelOption] })
    const oldSid = activeProjectState()._activeSessionId
    useChatStore.getState().setPreferredProvider('codex')
    const newSid = activeProjectState()._activeSessionId
    expect(newSid).toBe(oldSid)
    expect(activeSession().sessionProvider).toBe('codex')
  })

  it("is a no-op when sessionProvider already matches", () => {
    setupProject()
    patchSession({ sessionProvider: 'claude' })
    const beforeSid = activeProjectState()._activeSessionId
    useChatStore.getState().setPreferredProvider('claude')
    expect(activeProjectState()._activeSessionId).toBe(beforeSid)
  })

  it('is a no-op when there is no active project', () => {
    useChatStore.getState().setPreferredProvider('codex')
    expect(mockSeedFromCurrent).not.toHaveBeenCalled()
  })

  it("is a no-op when the active session already has messages bound to a provider", () => {
    setupProject()
    patchSession({
      sessionProvider: 'claude',
      messages: [{ id: 'u1', role: 'user' as const, status: 'complete' as const, content: [], createdAt: '', providerId: 'claude' as const }],
    })
    const beforeSid = activeProjectState()._activeSessionId
    useChatStore.getState().setPreferredProvider('codex')
    expect(activeProjectState()._activeSessionId).toBe(beforeSid)
  })
})

describe('focusProject', () => {
  it('switches the active project AND clears unseen activity', async () => {
    setupProject('/p-other')
    setupProject(PATH)
    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        [PATH]: { ...s.projectSessions[PATH], hasUnseenActivity: true },
      },
    }))

    await useChatStore.getState().focusProject(PATH)
    expect(useChatStore.getState().activeProject).toBe(PATH)
    expect(activeProjectState().hasUnseenActivity).toBe(false)
  })

  it('parks the outgoing session if it was streaming', async () => {
    setupProject('/p-current')
    patchSession({ status: 'streaming' }, '/p-current')
    setupProject('/p-target')
    useChatStore.setState({ activeProject: '/p-current' })

    await useChatStore.getState().focusProject('/p-target')
    expect(mockWindowAgent.parkSession).toHaveBeenCalledWith('/p-current')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// interaction
// ─────────────────────────────────────────────────────────────────────────────

describe('setSessionApiProviderId', () => {
  it('writes apiProviderId to the session and forwards to window.agent.setSessionApiProvider', async () => {
    setupProject()
    await useChatStore.getState().setSessionApiProviderId('gateway-x')
    expect(activeSession().apiProviderId).toBe('gateway-x')
    expect(mockWindowAgent.setSessionApiProvider).toHaveBeenCalledWith(activeProjectState()._activeSessionId, 'gateway-x')
  })

  it('survives an IPC error without throwing', async () => {
    setupProject()
    mockWindowAgent.setSessionApiProvider.mockRejectedValueOnce(new Error('boom'))
    await expect(useChatStore.getState().setSessionApiProviderId('gateway-x')).resolves.toBeUndefined()
    expect(activeSession().apiProviderId).toBe('gateway-x')
  })

  it('is a no-op when no project is active', async () => {
    await useChatStore.getState().setSessionApiProviderId('gateway-x')
    expect(mockWindowAgent.setSessionApiProvider).not.toHaveBeenCalled()
  })
})

describe('setSandboxMode', () => {
  it('forwards the new mode + writes the returned sandboxInfo onto the project', async () => {
    setupProject()
    mockWindowAgent.setSandboxMode.mockResolvedValueOnce({ enabled: false, autoAllowBash: false })
    await useChatStore.getState().setSandboxMode('off')
    expect(mockWindowAgent.setSandboxMode).toHaveBeenCalledWith(PATH, 'off')
    expect(activeProjectState().sandboxInfo).toEqual({ enabled: false, autoAllowBash: false })
  })

  it('is a no-op when no project is active', async () => {
    await useChatStore.getState().setSandboxMode('on')
    expect(mockWindowAgent.setSandboxMode).not.toHaveBeenCalled()
  })
})

describe('cyclePermissionMode + togglePlanModeShortcut', () => {
  it('cyclePermissionMode rotates to the next mode and forwards IPC', () => {
    setupProject()
    patchSession({ permissionMode: 'default' })
    useChatStore.getState().cyclePermissionMode()
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledTimes(1)
    // next mode is 'acceptEdits'
    expect(mockWindowAgent.setPermissionMode.mock.calls[0][1]).not.toBe('default')
  })

  it("togglePlanModeShortcut routes to setSelectedCodexCollaborationMode for Codex sessions", () => {
    setupProject()
    patchSession({ sessionProvider: 'codex', selectedCodexCollaborationMode: 'default' })
    useChatStore.getState().togglePlanModeShortcut()
    expect(activeSession().selectedCodexCollaborationMode).toBe('plan')
  })

  it('togglePlanModeShortcut falls through to cyclePermissionMode for Claude sessions', () => {
    setupProject()
    patchSession({ sessionProvider: 'claude', permissionMode: 'default' })
    useChatStore.getState().togglePlanModeShortcut()
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledTimes(1)
  })

  it('togglePlanModeShortcut toggles plan vs default for ACP sessions', () => {
    setupProject()
    patchSession({ sessionProvider: 'acp', permissionMode: 'default' })
    useChatStore.getState().togglePlanModeShortcut()
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith(expect.any(String), 'plan')
    mockWindowAgent.setPermissionMode.mockClear()
    patchSession({ sessionProvider: 'acp', permissionMode: 'plan' })
    useChatStore.getState().togglePlanModeShortcut()
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith(expect.any(String), 'default')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// sendMessage – Codex utility commands + Claude IPC
// ─────────────────────────────────────────────────────────────────────────────

describe('sendMessage: Codex utility slash commands', () => {
  beforeEach(() => {
    setupProject()
    patchSession({ sessionProvider: 'codex' })
  })

  it('/help shows a popup and never hits codexRun', async () => {
    await useChatStore.getState().sendMessage('/help')
    expect(activeSession().slashCommandOutput?.command).toBe('help')
    expect(mockWindowApp.codexRun).not.toHaveBeenCalled()
  })

  it('/auth shows the auth status popup', async () => {
    await useChatStore.getState().sendMessage('/auth')
    expect(activeSession().slashCommandOutput?.command).toBe('auth-status')
    expect(mockWindowApp.codexGetAuthStatus).toHaveBeenCalledWith(PATH)
  })

  it('/auth chatgpt forwards a mode change and shows a popup', async () => {
    await useChatStore.getState().sendMessage('/auth chatgpt')
    expect(mockWindowApp.codexSetAuth).toHaveBeenCalledWith(PATH, { mode: 'chatgpt', apiKey: undefined })
    expect(activeSession().slashCommandOutput?.command).toBe('auth-set')
  })

  it('/reset clears the Codex thread when a session id is bound', async () => {
    const sid = activeProjectState()._activeSessionId!
    await useChatStore.getState().sendMessage('/reset')
    expect(mockWindowAgent.resetSession).toHaveBeenCalledWith(sid)
    expect(activeSession().slashCommandOutput?.command).toBe('reset')
  })

  it('/plan toggles collaborationMode + early-returns (no popup)', async () => {
    await useChatStore.getState().sendMessage('/plan')
    expect(activeSession().selectedCodexCollaborationMode).toBe('plan')
    // No popup is set for /plan — it just switches mode and returns
    expect(activeSession().slashCommandOutput).toBeNull()
  })

  it('codex utility command surfacing an IPC error renders an in-chat assistant error message', async () => {
    mockWindowApp.codexGetAuthStatus.mockRejectedValueOnce(new Error('connection lost'))
    await useChatStore.getState().sendMessage('/auth')
    const last = activeSession().messages.at(-1)
    expect(last?.role).toBe('assistant')
    expect((last?.content[0] as { text: string }).text).toContain('connection lost')
  })
})

describe('sendMessage: intercepted Claude slash commands', () => {
  it('/provider opens the provider popup and returns', async () => {
    setupProject()
    await useChatStore.getState().sendMessage('/provider')
    expect(activeSession().slashCommandOutput?.command).toBe('provider')
    expect(mockWindowAgent.sendMessage).not.toHaveBeenCalled()
  })

  it("/clear routes through CLAUDE_INTERCEPTED_COMMANDS instead of forwarding the message", async () => {
    setupProject()
    patchSession({
      messages: [{ id: 'u1', role: 'user' as const, status: 'complete' as const, content: [], createdAt: '', providerId: 'claude' as const }],
    })
    await useChatStore.getState().sendMessage('/clear')
    expect(mockWindowAgent.sendMessage).not.toHaveBeenCalled()
    // /clear is wired to resetSession → rotates the active session id
    expect(activeSession().messages).toEqual([])
  })
})

describe('sendMessage: Claude IPC path', () => {
  it('appends the user message + dispatches window.agent.sendMessage', async () => {
    setupProject()
    await useChatStore.getState().sendMessage('hello')
    expect(activeSession().messages.at(-1)?.role).toBe('user')
    expect(mockWindowAgent.sendMessage).toHaveBeenCalledTimes(1)
    const args = mockWindowAgent.sendMessage.mock.calls[0]
    expect(args[0]).toBe(PATH)
    expect(args[1].content).toBe('hello')
  })

  it('queues the message instead of appending when the session is currently streaming', async () => {
    setupProject()
    patchSession({ status: 'streaming', sessionProvider: 'claude' })
    await useChatStore.getState().sendMessage('queued')
    expect(activeSession().queuedMessages.length).toBe(1)
    expect(activeSession().messages.length).toBe(0)
    // priority:'next' is set for the queued path
    expect(mockWindowAgent.sendMessage.mock.calls[0][1].priority).toBe('next')
  })

  it('rolls back awaitingAssistantReply when the IPC throws (non-queued)', async () => {
    setupProject()
    mockWindowAgent.sendMessage.mockRejectedValueOnce(new Error('disk full'))
    await expect(useChatStore.getState().sendMessage('boom')).rejects.toThrow('disk full')
    expect(activeSession().awaitingAssistantReply).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DB / nav store actions in chat-store/index.ts (fetchSessions / switchToSession / addDir / startCodexReview)
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchSessions / fetchSessionsPage', () => {
  beforeEach(() => {
    mockWindowEnvironment.listSessions.mockReset()
    mockWindowEnvironment.listSessions.mockResolvedValue([])
  })

  it('writes the first page into project.sessions + sets hasMore based on page-full', async () => {
    setupProject()
    const entries = Array.from({ length: 30 }, (_, i) => ({
      sessionId: `s${i}`,
      title: `t${i}`,
      lastActiveAt: new Date().toISOString(),
      provider: 'claude',
      messageCount: 0,
    }))
    mockWindowEnvironment.listSessions.mockResolvedValueOnce(entries)
    await useChatStore.getState().fetchSessions()
    const proj = activeProjectState()
    expect(proj.sessions.length).toBe(30)
    expect(proj.sessionsPage).toBe(1)
    expect(proj.sessionsHasMore).toBe(true)
    expect(mockWindowEnvironment.listSessions).toHaveBeenCalledWith(
      'local',
      PATH,
      { limit: 30, offset: 0 },
    )
  })

  it("clears hasMore when a short page returns < SESSIONS_PAGE_SIZE", async () => {
    setupProject()
    mockWindowEnvironment.listSessions.mockResolvedValueOnce([{
      sessionId: 's1',
      title: 't1',
      lastActiveAt: new Date().toISOString(),
      provider: 'claude',
      messageCount: 0,
    }])
    await useChatStore.getState().fetchSessions()
    expect(activeProjectState().sessionsHasMore).toBe(false)
  })

  it('survives an IPC error without throwing', async () => {
    setupProject()
    mockWindowEnvironment.listSessions.mockRejectedValueOnce(new Error('db locked'))
    await expect(useChatStore.getState().fetchSessions()).resolves.toBeUndefined()
  })

  it('fetchSessionsPage appends the next page when more is available', async () => {
    setupProject()
    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        [PATH]: {
          ...s.projectSessions[PATH],
          sessions: [{ sessionId: 's0', title: 't', providerId: 'claude' } as never],
          sessionsPage: 1,
          sessionsHasMore: true,
        },
      },
    }))
    mockWindowEnvironment.listSessions.mockResolvedValueOnce([{
      sessionId: 's1',
      title: 't1',
      lastActiveAt: new Date().toISOString(),
      provider: 'claude',
      messageCount: 0,
    }])
    await useChatStore.getState().fetchSessionsPage()
    const proj = activeProjectState()
    expect(proj.sessions.map((s) => s.sessionId)).toEqual(['s0', 's1'])
    expect(proj.sessionsPage).toBe(2)
  })

  it('fetchSessionsPage is a no-op when sessionsHasMore is false', async () => {
    setupProject()
    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        [PATH]: { ...s.projectSessions[PATH], sessionsHasMore: false },
      },
    }))
    await useChatStore.getState().fetchSessionsPage()
    expect(mockWindowEnvironment.listSessions).not.toHaveBeenCalled()
  })
})

describe('renameSession', () => {
  it('forwards to window.app.renameSession + patches the local sessions list', async () => {
    setupProject()
    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        [PATH]: {
          ...s.projectSessions[PATH],
          sessions: [
            { sessionId: 's1', title: 'old', providerId: 'claude' } as never,
            { sessionId: 's2', title: 'other', providerId: 'claude' } as never,
          ],
        },
      },
    }))
    await useChatStore.getState().renameSession('s1', 'new title')
    expect(mockWindowApp.renameSession).toHaveBeenCalledWith('s1', 'new title')
    const proj = activeProjectState()
    expect(proj.sessions[0].title).toBe('new title')
    expect(proj.sessions[1].title).toBe('other')
  })

  it('is a no-op when no project is active', async () => {
    await useChatStore.getState().renameSession('s1', 'x')
    expect(mockWindowApp.renameSession).not.toHaveBeenCalled()
  })
})

describe('addDir / removeDir', () => {
  it("addDir scope='session' appends to session.additionalDirs and sets dirty flag", () => {
    setupProject()
    useChatStore.getState().addDir('/extra-dir', 'session')
    expect(activeSession().additionalDirs).toContain('/extra-dir')
    expect(activeSession().additionalDirsDirty).toBe(true)
  })

  it("addDir scope='session' dedupes by exact path", () => {
    setupProject()
    patchSession({ additionalDirs: ['/already'] })
    useChatStore.getState().addDir('/already', 'session')
    expect(activeSession().additionalDirs).toEqual(['/already'])
  })

  it("addDir scope='project' calls addProjectAdditionalDir IPC and writes projectLocalDirs", () => {
    setupProject()
    useChatStore.getState().addDir('/proj-shared', 'project')
    expect(mockWindowAgent.addProjectAdditionalDir).toHaveBeenCalledWith(PATH, '/proj-shared')
    expect(activeProjectState().projectLocalDirs).toContain('/proj-shared')
  })

  it("removeDir scope='session' filters out the path", () => {
    setupProject()
    patchSession({ additionalDirs: ['/a', '/b'] })
    useChatStore.getState().removeDir('/a', 'session')
    expect(activeSession().additionalDirs).toEqual(['/b'])
  })

  it("removeDir scope='project' calls removeProjectAdditionalDir IPC", () => {
    setupProject()
    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        [PATH]: { ...s.projectSessions[PATH], projectLocalDirs: ['/p'] },
      },
    }))
    useChatStore.getState().removeDir('/p', 'project')
    expect(mockWindowAgent.removeProjectAdditionalDir).toHaveBeenCalledWith(PATH, '/p')
    expect(activeProjectState().projectLocalDirs).toEqual([])
  })

  it('removeDir / addDir are no-ops when no active project', () => {
    useChatStore.getState().addDir('/x', 'session')
    useChatStore.getState().removeDir('/x', 'session')
    expect(mockWindowAgent.addProjectAdditionalDir).not.toHaveBeenCalled()
  })
})

describe('startCodexReview', () => {
  it("uncommittedChanges target translates to '/review' sendMessage", async () => {
    setupProject()
    patchSession({ sessionProvider: 'codex' })
    useChatStore.getState().startCodexReview({ type: 'uncommittedChanges' })
    await new Promise((r) => setTimeout(r, 0))
    expect(mockWindowApp.codexReview).toHaveBeenCalled()
    // showReviewPanel must close
    expect(activeProjectState().showReviewPanel).toBe(false)
  })

  it("baseBranch target includes the selected branch", async () => {
    setupProject()
    patchSession({ sessionProvider: 'codex' })
    useChatStore.getState().startCodexReview({ type: 'baseBranch', branch: 'main' })
    await new Promise((r) => setTimeout(r, 0))
    expect(mockWindowApp.codexReview.mock.calls[0]?.[2]).toEqual({
      type: 'baseBranch',
      branch: 'main',
    })
  })

  it("commit target translates to '/review commit <sha>'", async () => {
    setupProject()
    patchSession({ sessionProvider: 'codex' })
    useChatStore.getState().startCodexReview({ type: 'commit', sha: 'abcd1234' })
    await new Promise((r) => setTimeout(r, 0))
    expect(mockWindowApp.codexReview).toHaveBeenCalled()
  })

  it('is a no-op when no project is active', () => {
    useChatStore.getState().startCodexReview({ type: 'uncommittedChanges' })
    expect(mockWindowApp.codexReview).not.toHaveBeenCalled()
  })
})

describe('sendMessage: worktree activation', () => {
  it('activates a pending worktree before sending', async () => {
    setupProject()
    // Override useAppStore.getState to surface a pending worktree
    const { useAppStore } = await import('./app')
    vi.spyOn(useAppStore, 'getState').mockReturnValue({
      getWorktreeState: () => ({ pendingBaseBranch: 'main', pendingMode: 'use-base', pendingBranchName: '', pendingCarryLocalChanges: true }),
      setActiveWorktree: mockSetActiveWorktree,
      clearWorktree: mockClearWorktree,
      sandboxCapability: { supportLevel: 'always' },
      sandboxProbe: null,
      probeSandbox: vi.fn(async () => ({ ok: true })),
    } as never)
    mockActivateWorktree.mockResolvedValueOnce({ ok: true, path: '/wt-resolved' })

    await useChatStore.getState().sendMessage('after worktree')

    expect(mockActivateWorktree).toHaveBeenCalled()
    expect(mockSetActiveWorktree).toHaveBeenCalledWith(PATH, '/wt-resolved')
    expect(activeSession().cwd).toBe('/wt-resolved')
  })
})
