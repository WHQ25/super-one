/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSetActiveWorktree = vi.fn()
const mockWorktreeState: {
  pendingBaseBranch: string | null
  pendingMode: 'branch' | 'worktree' | 'in-place'
  pendingBranchName: string
  pendingCarryLocalChanges: boolean
  activePath: string | null
} = {
  pendingBaseBranch: null,
  pendingMode: 'branch',
  pendingBranchName: '',
  pendingCarryLocalChanges: false,
  activePath: null,
}

vi.mock('@/stores/app', () => ({
  useAppStore: {
    getState: () => ({
      getWorktreeState: () => mockWorktreeState,
      setActiveWorktree: mockSetActiveWorktree,
      clearWorktree: vi.fn().mockResolvedValue(undefined),
      sandboxCapability: null,
      currentProjectId: 'remote-project-1',
    }),
  },
}))
vi.mock('@/stores/activity-view-state', () => ({
  useActivityViewStateStore: { getState: () => ({ seedFromCurrent: vi.fn() }) },
}))
const mockMiniApps: Array<{ id: string; manifest: Record<string, unknown> }> = []
vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: { getState: () => ({ apps: mockMiniApps, openApps: {} }), setState: vi.fn() },
}))
const mockRunCodexCommand = vi.fn().mockResolvedValue(undefined)
vi.mock('../codex/runner', () => ({ runCodexCommand: mockRunCodexCommand }))

const mockActivateWorktree = vi.fn().mockResolvedValue({ ok: true, path: '/wt/feature-x' })
const mockSendMessage = vi.fn().mockResolvedValue(undefined)
const mockMiniAppAuthorize = vi.fn().mockResolvedValue(undefined)
const mockResumeSession = vi.fn().mockResolvedValue(null)
const mockCodexGetAuthStatus = vi.fn().mockResolvedValue({ mode: 'auto', signedIn: false })
const mockEnvGetSession = vi.fn()
const mockEnvCreateSession = vi.fn()
const mockEnvSendSessionMessage = vi.fn()
const mockToastError = vi.fn()

const mockRequestSessionRecap = vi.fn().mockResolvedValue(true)

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}))
vi.mock('i18next', () => ({
  default: {
    t: (key: string, opts?: { message?: string }) => {
      if (key === 'chat.send.remoteUnavailable') return 'remote-unavailable'
      if (key === 'chat.send.failed') return `failed:${opts?.message ?? ''}`
      return key
    },
  },
}))

vi.stubGlobal('window', {
  agent: {
    sendMessage: mockSendMessage,
    resetSession: vi.fn().mockResolvedValue(undefined),
    parkSession: vi.fn().mockResolvedValue(undefined),
    prewarm: vi.fn().mockResolvedValue(undefined),
    requestSessionRecap: mockRequestSessionRecap,
  },
  app: {
    activateWorktree: mockActivateWorktree,
    resumeSession: mockResumeSession,
    trace: vi.fn(),
    getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }),
    codexGetAuthStatus: mockCodexGetAuthStatus,
  },
  environment: {
    getSession: mockEnvGetSession,
    createSession: mockEnvCreateSession,
    sendSessionMessage: mockEnvSendSessionMessage,
  },
  miniapp: { authorize: mockMiniAppAuthorize },
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})

await import('../index')
const { useChatStore } = await import('../index')
const { createDefaultPerSessionState, createDefaultProjectState } = await import('../defaults')

function seedProject(path: string, sessionId: string, sessionPatch: Partial<ReturnType<typeof createDefaultPerSessionState>> = {}) {
  const proj = createDefaultProjectState()
  proj._activeSessionId = sessionId
  proj._sessions = { [sessionId]: { ...createDefaultPerSessionState(), ...sessionPatch } }
  useChatStore.setState({
    projectSessions: { [path]: proj },
    activeProject: path,
    remoteSessions: {},
  })
}

function getActiveSession(path: string) {
  const proj = useChatStore.getState().projectSessions[path]
  const sid = proj._activeSessionId!
  return proj._sessions[sid]
}

beforeEach(() => {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    remoteSessions: {},
    _previousFocusedSession: null,
    harnessResources: { claude: null, codex: null, acp: null },
    initializedHarnesses: new Set(),
  })
  mockWorktreeState.pendingBaseBranch = null
  mockWorktreeState.pendingMode = 'branch'
  mockWorktreeState.pendingBranchName = ''
  mockWorktreeState.pendingCarryLocalChanges = false
  mockActivateWorktree.mockReset().mockResolvedValue({ ok: true, path: '/wt/feature-x' })
  mockSendMessage.mockReset().mockResolvedValue(undefined)
  mockRequestSessionRecap.mockReset().mockResolvedValue(true)
  mockSetActiveWorktree.mockReset()
  mockMiniAppAuthorize.mockReset().mockResolvedValue(undefined)
  mockResumeSession.mockReset().mockResolvedValue(null)
  mockCodexGetAuthStatus.mockReset().mockResolvedValue({ mode: 'auto', signedIn: false })
  mockRunCodexCommand.mockReset().mockResolvedValue(undefined)
  mockEnvGetSession.mockReset().mockResolvedValue(null)
  mockEnvCreateSession.mockReset().mockResolvedValue({
    sessionId: 'node-sid-1',
    title: 'New session',
    lastActiveAt: new Date().toISOString(),
    messageCount: 0,
  })
  mockEnvSendSessionMessage.mockReset().mockResolvedValue({
    sessionId: 'node-sid-1',
    status: 'idle',
    harnessId: 'codex',
    transcript: [
      { id: 'u1', role: 'user', text: 'hello', createdAt: Date.now() },
      { id: 'a1', role: 'assistant', text: '[codex] done', createdAt: Date.now() },
    ],
  })
  mockToastError.mockReset()
  mockMiniApps.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('sendMessageImpl: remote node', () => {
  const remotePath = 'remote:env-1:/work/app'

  it('materializes a node session when the active id is only a local draft', async () => {
    // Default preferredProvider is claude (Claude Code tab); must not force codex.
    seedProject(remotePath, 'local-draft-sid', {
      preferredProvider: 'claude',
      sessionProvider: null,
    })
    mockEnvSendSessionMessage.mockResolvedValueOnce({
      sessionId: 'node-sid-1',
      status: 'idle',
      harnessId: 'claude',
      transcript: [
        { id: 'u1', role: 'user', text: 'hello', createdAt: Date.now() },
        { id: 'a1', role: 'assistant', text: '[claude] done', createdAt: Date.now() },
      ],
    })

    await useChatStore.getState().sendMessage('hello')

    expect(mockEnvGetSession).toHaveBeenCalledWith('env-1', 'local-draft-sid')
    expect(mockEnvCreateSession).toHaveBeenCalledWith(
      'env-1',
      expect.objectContaining({ projectId: 'remote-project-1', harnessId: 'claude' }),
    )
    expect(mockEnvSendSessionMessage).toHaveBeenCalledWith(
      'env-1',
      expect.objectContaining({
        sessionId: 'node-sid-1',
        text: 'hello',
        projectPath: remotePath,
        providerId: 'claude',
      }),
    )
    expect(mockSendMessage).not.toHaveBeenCalled()

    const proj = useChatStore.getState().projectSessions[remotePath]
    expect(proj._activeSessionId).toBe('node-sid-1')
    const sess = proj._sessions['node-sid-1']
    expect(sess.awaitingAssistantReply).toBe(false)
    expect(sess.status).toBe('idle')
    expect(sess.messages.some((m) => m.role === 'assistant')).toBe(true)
  })

  it('uses preferredProvider claude when sessionProvider is still null', async () => {
    seedProject(remotePath, 'draft-claude', {
      preferredProvider: 'claude',
      sessionProvider: null,
    })
    mockEnvSendSessionMessage.mockResolvedValueOnce({
      sessionId: 'node-sid-1',
      status: 'idle',
      harnessId: 'claude',
      transcript: [],
    })

    await useChatStore.getState().sendMessage('hi claude')

    expect(mockEnvCreateSession).toHaveBeenCalledWith(
      'env-1',
      expect.objectContaining({ harnessId: 'claude' }),
    )
    expect(mockEnvSendSessionMessage).toHaveBeenCalledWith(
      'env-1',
      expect.objectContaining({ providerId: 'claude' }),
    )
  })

  it('passes selectedModel on remote claude send', async () => {
    seedProject(remotePath, 'node-model-sid', {
      preferredProvider: 'claude',
      sessionProvider: 'claude',
      selectedModel: 'claude-opus-4-1',
    })
    mockEnvGetSession.mockResolvedValueOnce({
      sessionId: 'node-model-sid',
      status: 'idle',
      transcript: [],
    })
    mockEnvSendSessionMessage.mockResolvedValueOnce({
      sessionId: 'node-model-sid',
      status: 'idle',
      harnessId: 'claude',
      transcript: [],
    })

    await useChatStore.getState().sendMessage('use opus')

    expect(mockEnvSendSessionMessage).toHaveBeenCalledWith(
      'env-1',
      expect.objectContaining({
        sessionId: 'node-model-sid',
        model: 'claude-opus-4-1',
        providerId: 'claude',
      }),
    )
  })

  it('intercepts /clear on remote without session.send', async () => {
    seedProject(remotePath, 'node-clear-sid', {
      preferredProvider: 'claude',
      sessionProvider: 'claude',
    })
    mockEnvGetSession.mockResolvedValueOnce({
      sessionId: 'node-clear-sid',
      status: 'idle',
      transcript: [],
    })

    await useChatStore.getState().sendMessage('/clear')

    expect(mockEnvSendSessionMessage).not.toHaveBeenCalled()
  })

  it('uses codex when the session is on the codex tab', async () => {
    seedProject(remotePath, 'draft-codex', {
      preferredProvider: 'codex',
      sessionProvider: 'codex',
    })

    await useChatStore.getState().sendMessage('hi codex')

    expect(mockEnvCreateSession).toHaveBeenCalledWith(
      'env-1',
      expect.objectContaining({ harnessId: 'codex' }),
    )
  })

  it('reuses an existing node session without creating another', async () => {
    seedProject(remotePath, 'node-sid-live')
    mockEnvGetSession.mockResolvedValueOnce({
      sessionId: 'node-sid-live',
      status: 'idle',
      transcript: [],
    })
    mockEnvSendSessionMessage.mockResolvedValueOnce({
      sessionId: 'node-sid-live',
      status: 'idle',
      harnessId: 'codex',
      transcript: [
        { id: 'u1', role: 'user', text: 'hi', createdAt: Date.now() },
        { id: 'a1', role: 'assistant', text: '[codex] done', createdAt: Date.now() },
      ],
    })

    await useChatStore.getState().sendMessage('hi')

    expect(mockEnvCreateSession).not.toHaveBeenCalled()
    expect(mockEnvSendSessionMessage).toHaveBeenCalledWith(
      'env-1',
      expect.objectContaining({
        sessionId: 'node-sid-live',
        text: 'hi',
        projectPath: remotePath,
      }),
    )
  })

  it('toasts and marks error when remote send fails (no silent swallow)', async () => {
    seedProject(remotePath, 'node-sid-fail', {
      preferredProvider: 'claude',
      sessionProvider: 'claude',
    })
    mockEnvGetSession.mockResolvedValueOnce({
      sessionId: 'node-sid-fail',
      status: 'idle',
      transcript: [],
    })
    mockEnvSendSessionMessage.mockRejectedValueOnce(new Error('rpc timeout: session.send'))

    await expect(useChatStore.getState().sendMessage('hello')).rejects.toThrow(/rpc timeout/)

    const sess = getActiveSession(remotePath)
    expect(sess.awaitingAssistantReply).toBe(false)
    expect(sess.status).toBe('error')
    expect(mockToastError).toHaveBeenCalledWith('remote-unavailable')
  })
})


describe('sendMessageImpl: worktree activation', () => {
  it('activates worktree, sets active worktree, and resets session state on success', async () => {
    seedProject('/proj', 'sid-1', { messages: [{ id: 'old', role: 'user', content: [{ type: 'text', text: 'old' }], status: 'complete', createdAt: '', providerId: 'claude' }] })
    mockWorktreeState.pendingBaseBranch = 'main'
    mockWorktreeState.pendingMode = 'branch'
    mockWorktreeState.pendingBranchName = 'feature-x'
    mockWorktreeState.pendingCarryLocalChanges = true

    await useChatStore.getState().sendMessage('hello')

    expect(mockActivateWorktree).toHaveBeenCalledWith('/proj', {
      baseBranch: 'main',
      mode: 'branch',
      branchName: 'feature-x',
      carryLocalChanges: true,
    })
    expect(mockSetActiveWorktree).toHaveBeenCalledWith('/proj', '/wt/feature-x')
    const sess = getActiveSession('/proj')
    expect(sess.cwd).toBe('/wt/feature-x')
    expect(sess._gitBranch).toBe('feature-x')
    expect(sess._worktreePath).toBe('/wt/feature-x')
    expect(sess.totalCostUsd).toBe(0)
    expect(sess.contextTokens).toBe(0)
    expect(mockSendMessage).toHaveBeenCalled()
  })

  it('records baseBranch as _gitBranch when mode is not branch', async () => {
    seedProject('/proj', 'sid-1')
    mockWorktreeState.pendingBaseBranch = 'develop'
    mockWorktreeState.pendingMode = 'in-place' as never
    mockActivateWorktree.mockResolvedValueOnce({ ok: true, path: '/proj' })

    await useChatStore.getState().sendMessage('hi')

    const sess = getActiveSession('/proj')
    expect(sess._gitBranch).toBe('develop')
  })

  it('returns early without IPC when branch mode is missing a branch name', async () => {
    seedProject('/proj', 'sid-1')
    mockWorktreeState.pendingBaseBranch = 'main'
    mockWorktreeState.pendingMode = 'branch'
    mockWorktreeState.pendingBranchName = '   '

    await useChatStore.getState().sendMessage('hello')

    expect(mockActivateWorktree).not.toHaveBeenCalled()
    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Branch mode requires a branch name'))
  })

  it('aborts when activateWorktree returns ok=false', async () => {
    seedProject('/proj', 'sid-1')
    mockWorktreeState.pendingBaseBranch = 'main'
    mockWorktreeState.pendingMode = 'branch'
    mockWorktreeState.pendingBranchName = 'feature-x'
    mockActivateWorktree.mockResolvedValueOnce({ ok: false, error: 'dirty tree' })

    await useChatStore.getState().sendMessage('hello')

    expect(mockSetActiveWorktree).not.toHaveBeenCalled()
    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to activate worktree'), 'dirty tree')
  })
})

describe('sendMessageImpl: early returns', () => {
  it('returns silently when activeProject is null', async () => {
    useChatStore.setState({ activeProject: null })
    await useChatStore.getState().sendMessage('hello')
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('returns silently when active session is a remote session', async () => {
    seedProject('/proj', 'sid-remote')
    useChatStore.setState({ remoteSessions: { '/proj': ['sid-remote'] } })

    await useChatStore.getState().sendMessage('hello')

    expect(mockSendMessage).not.toHaveBeenCalled()
  })
})

describe('sendMessageImpl: intercepted commands', () => {
  it('routes /clear through CLAUDE_INTERCEPTED_COMMANDS and skips IPC send', async () => {
    seedProject('/proj', 'sid-1', {
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'prev' }], status: 'complete', createdAt: '', providerId: 'claude' }],
    })

    await useChatStore.getState().sendMessage('/clear')

    expect(mockSendMessage).not.toHaveBeenCalled()
    const sess = getActiveSession('/proj')
    expect(sess.messages).toEqual([])
  })

  it('routes /provider to openProviderPopup and skips IPC send', async () => {
    seedProject('/proj', 'sid-1')

    await useChatStore.getState().sendMessage('/provider')

    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('routes Claude /workflows to openWorkflowsPopup and skips IPC send', async () => {
    seedProject('/proj', 'sid-1')

    await useChatStore.getState().sendMessage('/workflows')

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(getActiveSession('/proj').slashCommandOutput).toEqual({ command: 'workflows', content: '' })
    expect(getActiveSession('/proj').messages).toEqual([])
  })

  it('routes ACP /workflows to openWorkflowsPopup and skips IPC send', async () => {
    seedProject('/proj', 'sid-grok-wf', {
      sessionProvider: 'acp',
      preferredProvider: 'acp',
      acpAgentId: 'grok-build',
    })

    await useChatStore.getState().sendMessage('/workflows')

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(getActiveSession('/proj').slashCommandOutput).toEqual({ command: 'workflows', content: '' })
    expect(getActiveSession('/proj').messages).toEqual([])
  })

  it('opens the branch review picker without sending an invalid review request', async () => {
    seedProject('/proj', 'sid-1', { sessionProvider: 'codex', preferredProvider: 'codex' })

    await useChatStore.getState().sendMessage('/review branch')

    const project = useChatStore.getState().projectSessions['/proj']
    expect(project.showReviewPanel).toBe(true)
    expect(project.reviewPanelInitialMode).toBe('branch')
    expect(mockRunCodexCommand).not.toHaveBeenCalled()
  })

  it('intercepts Grok /recap and calls requestSessionRecap without sending a turn', async () => {
    mockRequestSessionRecap.mockClear()
    seedProject('/proj', 'sid-grok', {
      sessionProvider: 'acp',
      preferredProvider: 'acp',
      acpAgentId: 'grok-build',
    })

    await useChatStore.getState().sendMessage('/recap')

    expect(mockRequestSessionRecap).toHaveBeenCalledWith('sid-grok')
    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(getActiveSession('/proj').messages).toEqual([])
    // RPC resolved true — stay in generating state until session_recap arrives.
    expect(getActiveSession('/proj').isRecapping).toBe(true)
  })

  it('clears isRecapping when requestSessionRecap returns false', async () => {
    mockRequestSessionRecap.mockClear().mockResolvedValue(false)
    seedProject('/proj', 'sid-grok', {
      sessionProvider: 'acp',
      preferredProvider: 'acp',
      acpAgentId: 'grok-build',
    })

    await useChatStore.getState().sendMessage('/recap')

    expect(getActiveSession('/proj').isRecapping).toBe(false)
  })

  it('does not intercept /recap for non-Grok ACP agents', async () => {
    mockRequestSessionRecap.mockClear()
    seedProject('/proj', 'sid-other', {
      sessionProvider: 'acp',
      preferredProvider: 'acp',
      acpAgentId: 'opencode',
    })

    await useChatStore.getState().sendMessage('/recap')

    expect(mockRequestSessionRecap).not.toHaveBeenCalled()
    expect(mockSendMessage).toHaveBeenCalled()
  })
})

describe('sendMessageImpl: mosaic session scope', () => {
  function seedTwoSessions(
    activeSid: string,
    scopedSid: string,
    patches: {
      active?: Partial<ReturnType<typeof createDefaultPerSessionState>>
      scoped?: Partial<ReturnType<typeof createDefaultPerSessionState>>
    } = {},
  ) {
    const proj = createDefaultProjectState()
    proj._activeSessionId = activeSid
    proj._sessions = {
      [activeSid]: {
        ...createDefaultPerSessionState(),
        messages: [{ id: 'old', role: 'user', content: [{ type: 'text', text: 'from-old' }], status: 'complete', createdAt: '', providerId: 'claude' }],
        ...patches.active,
      },
      [scopedSid]: {
        ...createDefaultPerSessionState(),
        messages: [],
        ...patches.scoped,
      },
    }
    useChatStore.setState({
      projectSessions: { '/proj': proj },
      activeProject: '/proj',
      remoteSessions: {},
    })
  }

  it('routes the user message and IPC sessionId to the scoped tile, not the project-active session', async () => {
    // Mosaic: tile shows draft "sid-new" while project-active is still "sid-old" (focus switch in flight).
    seedTwoSessions('sid-old', 'sid-new')

    await useChatStore.getState().sendMessage(
      'hello from new tile',
      undefined,
      undefined,
      undefined,
      { projectPath: '/proj', sessionId: 'sid-new' },
    )

    const proj = useChatStore.getState().projectSessions['/proj']
    expect(proj._sessions['sid-old'].messages).toHaveLength(1)
    expect(proj._sessions['sid-old'].messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'from-old' }],
    })
    expect(proj._sessions['sid-new'].messages).toHaveLength(1)
    expect(proj._sessions['sid-new'].messages[0]).toMatchObject({
      role: 'user',
    })
    expect(proj._sessions['sid-new'].messages[0].content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'hello from new tile' })]),
    )
    expect(mockSendMessage).toHaveBeenCalledWith('/proj', expect.objectContaining({
      content: 'hello from new tile',
      sessionId: 'sid-new',
    }))
    // Active pointer may still be the old session — scoped send must not require it to have flipped first.
    expect(proj._activeSessionId).toBe('sid-old')
  })

  it('queues a scoped send onto the scoped session while the active session is streaming', async () => {
    seedTwoSessions('sid-old', 'sid-new', {
      scoped: {
        status: 'streaming',
        awaitingAssistantReply: true,
        sessionProvider: 'claude',
        preferredProvider: 'claude',
      },
    })

    await useChatStore.getState().sendMessage(
      'queued on new',
      undefined,
      undefined,
      undefined,
      { projectPath: '/proj', sessionId: 'sid-new' },
    )

    const proj = useChatStore.getState().projectSessions['/proj']
    expect(proj._sessions['sid-old'].queuedMessages).toHaveLength(0)
    expect(proj._sessions['sid-new'].queuedMessages).toHaveLength(1)
    expect(mockSendMessage).toHaveBeenCalledWith('/proj', expect.objectContaining({
      sessionId: 'sid-new',
      priority: 'next',
    }))
  })
})

describe('sendMessageImpl: IPC dispatch + rollback', () => {
  it('sends the first Claude message when the draft session is not persisted yet', async () => {
    seedProject('/proj', 'draft-sid', {
      sessionProvider: 'claude',
      preferredProvider: 'claude',
    })
    mockResumeSession.mockRejectedValueOnce(new Error('Session not found: draft-sid'))

    await useChatStore.getState().sendMessage('first message')

    expect(mockResumeSession).toHaveBeenCalledWith('/proj', 'draft-sid', '/proj')
    expect(mockSendMessage).toHaveBeenCalledWith('/proj', expect.objectContaining({
      content: 'first message',
      sessionId: 'draft-sid',
      provider: 'claude',
    }))
  })

  it('sends the per-session OpenCode agent selection', async () => {
    seedProject('/proj', 'sid-opencode', {
      sessionProvider: 'opencode',
      preferredProvider: 'opencode',
      selectedModel: 'openai/gpt-5',
      openCodeAgentId: 'general',
    })

    await useChatStore.getState().sendMessage('hello')

    expect(mockSendMessage).toHaveBeenCalledWith('/proj', expect.objectContaining({
      provider: 'opencode',
      agent: 'general',
    }))
  })

  it('rolls back awaitingAssistantReply and rethrows when sendMessage rejects', async () => {
    seedProject('/proj', 'sid-1')
    mockSendMessage.mockRejectedValueOnce(new Error('network down'))

    await expect(useChatStore.getState().sendMessage('hello')).rejects.toThrow('network down')

    const sess = getActiveSession('/proj')
    expect(sess.awaitingAssistantReply).toBe(false)
  })

  it('appends user message and sets awaitingAssistantReply on normal send', async () => {
    seedProject('/proj', 'sid-1')

    await useChatStore.getState().sendMessage('hello there')

    const sess = getActiveSession('/proj')
    expect(sess.messages).toHaveLength(1)
    expect(sess.messages[0].role).toBe('user')
    expect(sess.awaitingAssistantReply).toBe(true)
    expect(mockSendMessage).toHaveBeenCalledWith('/proj', expect.objectContaining({ content: 'hello there' }))
  })
})

describe('sendMessageImpl: queued send (streaming)', () => {
  it('queues the message with priority=next and does not rollback awaitingAssistantReply on failure', async () => {
    seedProject('/proj', 'sid-1', {
      status: 'streaming',
      awaitingAssistantReply: true,
      sessionProvider: 'claude',
      preferredProvider: 'claude',
    })
    mockSendMessage.mockRejectedValueOnce(new Error('boom'))

    await expect(useChatStore.getState().sendMessage('queued one')).rejects.toThrow('boom')

    expect(mockSendMessage).toHaveBeenCalledWith('/proj', expect.objectContaining({ priority: 'next' }))
    const sess = getActiveSession('/proj')
    expect(sess.awaitingAssistantReply).toBe(true)
    expect(sess.queuedMessages).toHaveLength(1)
    expect(sess.messages).toHaveLength(0)
  })
})

describe('sendMessageImpl: miniapp tool reminder', () => {
  const excalidrawApp = {
    id: 'excalidraw',
    manifest: {
      name: 'Excalidraw',
      toolSlug: 'excalidraw',
      tools: [
        { name: 'read_scene', description: 'Read the current canvas state' },
        { name: 'clear_canvas', description: 'Clear all elements from the canvas' },
      ],
    },
  }

  it('points codex at miniapp_call with tool names for the mentioned app', async () => {
    mockMiniApps.push(excalidrawApp)
    seedProject('/proj', 'sid-1', {
      preferredProvider: 'codex',
      sessionProvider: 'codex',
      mentions: [{ kind: 'miniapp', value: 'excalidraw', displayName: 'Excalidraw' }],
    })

    await useChatStore.getState().sendMessage('@Excalidraw redraw it')

    const { finalContent } = mockRunCodexCommand.mock.calls[0][2]
    expect(finalContent).toContain('mcp__superone.miniapp_call')
    expect(finalContent).toContain('appId="excalidraw"')
    expect(finalContent).toContain('read_scene')
    expect(finalContent).toContain('clear_canvas')
    expect(finalContent).not.toContain('mcp__superone.excalidraw__')
    expect(finalContent).not.toContain('Read the current canvas state')
  })

  it('points claude at miniapp_call with appId for the mentioned app', async () => {
    mockMiniApps.push(excalidrawApp)
    seedProject('/proj', 'sid-1', {
      mentions: [{ kind: 'miniapp', value: 'excalidraw', displayName: 'Excalidraw' }],
    })

    await useChatStore.getState().sendMessage('@Excalidraw redraw it')

    const content = mockSendMessage.mock.calls[0][1].content as string
    expect(content).toContain('mcp__superone__miniapp_call')
    expect(content).toContain('appId="excalidraw"')
    expect(content).toContain('miniapp_list')
    expect(content).not.toContain('mcp__superone__excalidraw__read_scene')
  })
})

describe('sendMessageImpl: built-in capability reminder', () => {
  it('injects English-only intent + Claude tool prefix even when chips were localized', async () => {
    seedProject('/proj', 'sid-1', {
      mentions: [
        { kind: 'browser', value: 'browser', displayName: 'Super浏览器' },
        { kind: 'collab', value: 'collab', displayName: '智能体协作' },
        { kind: 'computer', value: 'computer', displayName: '控制电脑' },
      ],
    })

    await useChatStore.getState().sendMessage(
      '<superone-capability><name>Super浏览器</name><id>browser</id></superone-capability> use these',
    )

    const content = mockSendMessage.mock.calls[0][1].content as string
    expect(content).toContain('<superone-capability-reminder>')
    expect(content).toContain('tools start with "mcp__superone__browser_"')
    expect(content).toContain('tools start with "mcp__superone__session_collab_"')
    expect(content).toContain('tools start with "mcp__superone__computer_"')
    expect(content).toContain('"Super Browser"')
    expect(content).toContain('"Agents Collaboration"')
    expect(content).toContain('"Computer Use"')
    expect(content).toContain('<name>Super Browser</name>')
    expect(content).not.toContain('Super浏览器')
    expect(content).not.toContain('智能体协作')
    expect(content).not.toContain('控制电脑')
    expect(content).toContain('automate the built-in browser')
    expect(content).toContain('spawn and coordinate child agent sessions')
    expect(content).toContain('control the desktop UI')
  })

  it('uses Codex-style tool prefixes (dot after server) for codex', async () => {
    seedProject('/proj', 'sid-1', {
      preferredProvider: 'codex',
      sessionProvider: 'codex',
      mentions: [{ kind: 'browser', value: 'browser', displayName: 'Super Browser' }],
    })

    await useChatStore.getState().sendMessage('browse it')

    const { finalContent } = mockRunCodexCommand.mock.calls[0][2]
    expect(finalContent).toContain('tools start with "mcp__superone.browser_"')
    expect(finalContent).not.toContain('mcp__superone__browser_')
  })

  it('dedupes repeated capability kinds in the reminder', async () => {
    seedProject('/proj', 'sid-1', {
      mentions: [
        { kind: 'browser', value: 'browser', displayName: 'Super Browser' },
        { kind: 'browser', value: 'browser', displayName: 'Super Browser' },
      ],
    })

    await useChatStore.getState().sendMessage('twice')

    const content = mockSendMessage.mock.calls[0][1].content as string
    const matches = content.match(/mcp__superone__browser_/g) ?? []
    expect(matches).toHaveLength(1)
  })
})

describe('sendMessageImpl: miniapp authorize', () => {
  it('does not abort the send when miniapp authorize rejects', async () => {
    seedProject('/proj', 'sid-1', {
      mentions: [{ kind: 'miniapp', value: 'app-a', displayName: 'App A' }],
    })
    mockMiniAppAuthorize.mockRejectedValueOnce(new Error('auth nope'))

    await useChatStore.getState().sendMessage('use miniapp')

    expect(mockMiniAppAuthorize).toHaveBeenCalledWith(['app-a'], '/proj', 'sid-1')
    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('miniapp authorize failed'), expect.any(Error))
  })

  it('authorizes against the freshly-created codex session id on the first codex turn (not the stale captured id)', async () => {
    // Fresh codex-preferred session that is not yet a codex session: the first send creates a
    // new local codex _activeSessionId via set(). Regression: authorize used the stale `project`
    // snapshot (still 'sid-1'/null), so it targeted the wrong session — or was skipped entirely.
    seedProject('/proj', 'sid-1', {
      preferredProvider: 'codex',
      sessionProvider: undefined,
      mentions: [{ kind: 'miniapp', value: 'excalidraw', displayName: 'Excalidraw' }],
    })

    await useChatStore.getState().sendMessage('@Excalidraw draw a cube')

    expect(mockMiniAppAuthorize).toHaveBeenCalledTimes(1)
    const [appIds, proj, sid] = mockMiniAppAuthorize.mock.calls[0]
    expect(appIds).toEqual(['excalidraw'])
    expect(proj).toBe('/proj')
    // The new codex session id, not the stale captured one (and not skipped entirely).
    expect(sid).not.toBe('sid-1')
    expect(typeof sid).toBe('string')
    expect(sid).toBeTruthy()
    // The authorized id matches the session the first codex turn actually runs on.
    expect(useChatStore.getState().projectSessions['/proj']._activeSessionId).toBe(sid)
  })
})
