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

vi.stubGlobal('window', {
  agent: {
    sendMessage: mockSendMessage,
    resetSession: vi.fn().mockResolvedValue(undefined),
    parkSession: vi.fn().mockResolvedValue(undefined),
    prewarm: vi.fn().mockResolvedValue(undefined),
  },
  app: {
    activateWorktree: mockActivateWorktree,
    resumeSession: mockResumeSession,
    trace: vi.fn(),
    getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }),
    codexGetAuthStatus: mockCodexGetAuthStatus,
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
    harnessResources: { claude: null, codex: null },
    initializedHarnesses: new Set(),
  })
  mockWorktreeState.pendingBaseBranch = null
  mockWorktreeState.pendingMode = 'branch'
  mockWorktreeState.pendingBranchName = ''
  mockWorktreeState.pendingCarryLocalChanges = false
  mockActivateWorktree.mockReset().mockResolvedValue({ ok: true, path: '/wt/feature-x' })
  mockSendMessage.mockReset().mockResolvedValue(undefined)
  mockSetActiveWorktree.mockReset()
  mockMiniAppAuthorize.mockReset().mockResolvedValue(undefined)
  mockResumeSession.mockReset().mockResolvedValue(null)
  mockCodexGetAuthStatus.mockReset().mockResolvedValue({ mode: 'auto', signedIn: false })
  mockRunCodexCommand.mockReset().mockResolvedValue(undefined)
  mockMiniApps.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
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
})

describe('sendMessageImpl: IPC dispatch + rollback', () => {
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

  it('enumerates each tool by exact full name for codex so it discovers them without tool search', async () => {
    mockMiniApps.push(excalidrawApp)
    seedProject('/proj', 'sid-1', {
      preferredProvider: 'codex',
      sessionProvider: 'codex',
      mentions: [{ kind: 'miniapp', value: 'excalidraw', displayName: 'Excalidraw' }],
    })

    await useChatStore.getState().sendMessage('@Excalidraw redraw it')

    const { finalContent } = mockRunCodexCommand.mock.calls[0][2]
    expect(finalContent).toContain('mcp__superone.excalidraw__read_scene')
    expect(finalContent).toContain('mcp__superone.excalidraw__clear_canvas')
    expect(finalContent).not.toContain('mcp__superone__excalidraw__')
    expect(finalContent).not.toContain('Read the current canvas state')
    expect(finalContent).not.toContain('tools start with')
  })

  it('keeps the prefix-hint reminder unchanged for claude', async () => {
    mockMiniApps.push(excalidrawApp)
    seedProject('/proj', 'sid-1', {
      mentions: [{ kind: 'miniapp', value: 'excalidraw', displayName: 'Excalidraw' }],
    })

    await useChatStore.getState().sendMessage('@Excalidraw redraw it')

    const content = mockSendMessage.mock.calls[0][1].content as string
    expect(content).toContain('tools start with "mcp__superone__excalidraw__"')
    expect(content).not.toContain('mcp__superone__excalidraw__read_scene')
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
