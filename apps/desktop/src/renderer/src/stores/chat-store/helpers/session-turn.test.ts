/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/stores/app', () => ({
  useAppStore: {
    getState: () => ({
      getWorktreeState: () => ({ pendingBaseBranch: null }),
      setActiveWorktree: vi.fn(),
      sandboxCapability: null,
    }),
  },
}))
vi.mock('@/stores/activity-view-state', () => ({
  useActivityViewStateStore: { getState: () => ({ seedFromCurrent: vi.fn() }) },
}))
vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: { getState: () => ({ apps: [], openApps: {} }), setState: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const getSession = vi.fn()
const createSession = vi.fn()
const removeSession = vi.fn()
const listProjects = vi.fn()
const activateSession = vi.fn()

vi.stubGlobal('window', {
  agent: {
    activateSession,
    resetSession: vi.fn().mockResolvedValue(undefined),
    parkSession: vi.fn().mockResolvedValue(undefined),
    prewarm: vi.fn().mockResolvedValue(undefined),
  },
  app: {
    trace: vi.fn(),
    getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }),
  },
  environment: { getSession, createSession, removeSession, listProjects },
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})

const { useChatStore } = await import('../index')
const { createDefaultPerSessionState, createDefaultProjectState } = await import('../defaults')
const { ensureHostSession, sessionTurnRequest } = await import('./session-turn')
const { createSendWriteScope } = await import('./send-write-scope')

type SessionPatch = Partial<ReturnType<typeof createDefaultPerSessionState>>

const LOCAL = '/proj'
const NODE = 'remote:env-1:/work/app'

const historyMessage = { id: 'u0', role: 'user' as const, status: 'complete' as const, content: [{ type: 'text' as const, text: 'earlier' }], createdAt: '', providerId: 'claude' as const }

function seed(path: string, sessionId: string, patch: SessionPatch = {}, projectPatch: Record<string, unknown> = {}) {
  const project = { ...createDefaultProjectState(), ...projectPatch }
  project._activeSessionId = sessionId
  project._sessions = { [sessionId]: { ...createDefaultPerSessionState(), ...patch } }
  useChatStore.setState({ projectSessions: { [path]: project }, activeProject: path, remoteSessions: {} })
}

function project(path: string) {
  return useChatStore.getState().projectSessions[path]
}

function ensure(path: string) {
  const scope = createSendWriteScope(useChatStore.setState, useChatStore.getState, path)
  return { scope, done: ensureHostSession(useChatStore.setState, useChatStore.getState, path, scope) }
}

/** A promise held open until the test releases it. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  useChatStore.setState({ projectSessions: {}, activeProject: null, remoteSessions: {}, disabledSkills: [] })
  getSession.mockReset().mockResolvedValue(null)
  // This desktop's host keeps the draft's id; a node names its own.
  createSession.mockReset().mockImplementation(async (_connectionId: string, input: { selections?: { sessionId?: string } }) =>
    ({ sessionId: input.selections?.sessionId ?? 'node-new', title: null, lastActiveAt: '', messageCount: 0 }))
  removeSession.mockReset().mockResolvedValue(undefined)
  listProjects.mockReset().mockImplementation(async (connectionId: string) => connectionId === 'local'
    ? [{ projectId: 'local-project', path: '/proj/' }]
    : [{ projectId: 'node-project', path: '/work/app' }])
  activateSession.mockReset().mockResolvedValue(undefined)
})

describe('ensureHostSession', () => {
  it("creates a local draft on this desktop's host under the draft's id, with the draft's settings", async () => {
    seed(LOCAL, 'draft-1', {
      preferredProvider: 'claude',
      selectedModel: 'sonnet',
      selectedEffort: 'high',
      permissionMode: 'plan',
      _worktreePath: '/proj/.wt/a',
    })

    const { scope, done } = ensure(LOCAL)
    await expect(done).resolves.toBe('draft-1')

    expect(getSession).toHaveBeenCalledWith('local', 'draft-1')
    expect(createSession).toHaveBeenCalledWith('local', {
      projectId: 'local-project',
      harnessId: 'claude',
      settings: expect.objectContaining({ permissionMode: 'plan', model: 'sonnet', effort: 'high', ultracode: false }),
      cwd: '/proj/.wt/a',
      selections: { sessionId: 'draft-1' },
    })
    const p = project(LOCAL)
    expect(p._activeSessionId).toBe('draft-1')
    expect(Object.keys(p._sessions)).toEqual(['draft-1'])
    expect(p._sessions['draft-1']).toMatchObject({ hostSessionOwned: true, sessionProvider: 'claude', preferredProvider: 'claude' })
    expect(scope.target).toEqual({ projectPath: LOCAL, sessionId: 'draft-1' })
    expect(activateSession).toHaveBeenCalledWith(LOCAL, 'draft-1', '/proj/.wt/a')
    expect(removeSession).not.toHaveBeenCalled()
  })

  it("names an ACP agent in a local draft's selections", async () => {
    seed(LOCAL, 'draft-acp', { preferredProvider: 'acp', acpAgentId: 'grok-build' })

    await ensure(LOCAL).done

    expect(createSession).toHaveBeenCalledWith('local', expect.objectContaining({
      harnessId: 'acp',
      selections: { sessionId: 'draft-acp', acpAgentId: 'grok-build' },
    }))
  })

  it("creates a node draft under the node's own id and moves the store entry there", async () => {
    seed(NODE, 'draft-1', { preferredProvider: 'claude', draftText: 'kept', selectedModel: 'opus' })

    const { scope, done } = ensure(NODE)
    await expect(done).resolves.toBe('node-new')

    expect(getSession).toHaveBeenCalledWith('env-1', 'draft-1')
    expect(createSession).toHaveBeenCalledTimes(1)
    const [connectionId, input] = createSession.mock.calls[0]
    expect(connectionId).toBe('env-1')
    expect(input).toMatchObject({ projectId: 'node-project', harnessId: 'claude', settings: { model: 'opus' } })
    expect(input).not.toHaveProperty('selections')
    // Harness-specific settings only this desktop's host keeps.
    expect(input.settings).not.toHaveProperty('ultracode')

    const p = project(NODE)
    expect(p._activeSessionId).toBe('node-new')
    expect(Object.keys(p._sessions)).toEqual(['node-new'])
    expect(p._sessions['node-new']).toMatchObject({ draftText: 'kept', hostSessionOwned: true })
    expect(scope.target).toEqual({ projectPath: NODE, sessionId: 'node-new' })
    expect(removeSession).not.toHaveBeenCalled()
    expect(activateSession).toHaveBeenCalledWith(NODE, 'node-new', NODE)
  })

  it('removes an empty local session on another harness before creating its replacement under the same id', async () => {
    seed(LOCAL, 'sid-1', { preferredProvider: 'claude' })
    getSession.mockResolvedValueOnce({ sessionId: 'sid-1', harnessId: 'codex' })
    const removal = deferred<void>()
    removeSession.mockReturnValueOnce(removal.promise)

    const { done } = ensure(LOCAL)
    await vi.waitFor(() => expect(removeSession).toHaveBeenCalledWith('local', 'sid-1'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The host keeps the draft's id, so the prewarmed runtime must be gone first.
    expect(createSession).not.toHaveBeenCalled()

    removal.resolve()
    await expect(done).resolves.toBe('sid-1')
    expect(createSession).toHaveBeenCalledWith('local', expect.objectContaining({ harnessId: 'claude', selections: { sessionId: 'sid-1' } }))
    expect(project(LOCAL)._activeSessionId).toBe('sid-1')
  })

  it('replaces an empty node session on another harness with a new one and removes the old', async () => {
    seed(NODE, 'node-old', { preferredProvider: 'claude' })
    getSession.mockResolvedValueOnce({ sessionId: 'node-old', harnessId: 'codex' })

    await expect(ensure(NODE).done).resolves.toBe('node-new')

    expect(createSession).toHaveBeenCalledWith('env-1', expect.objectContaining({ harnessId: 'claude' }))
    expect(removeSession).toHaveBeenCalledWith('env-1', 'node-old')
    expect(createSession.mock.invocationCallOrder[0]).toBeLessThan(removeSession.mock.invocationCallOrder[0])
    const p = project(NODE)
    expect(p._activeSessionId).toBe('node-new')
    expect(Object.keys(p._sessions)).toEqual(['node-new'])
  })

  it('keeps an empty session the host already runs on the same harness', async () => {
    seed(NODE, 'node-live', { preferredProvider: 'claude' })
    getSession.mockResolvedValueOnce({ sessionId: 'node-live', harnessId: 'claude' })

    await expect(ensure(NODE).done).resolves.toBe('node-live')

    expect(createSession).not.toHaveBeenCalled()
    expect(removeSession).not.toHaveBeenCalled()
    expect(project(NODE)._sessions['node-live'].hostSessionOwned).toBe(true)
  })

  it('neither looks up nor creates a session that has carried a turn', async () => {
    seed(LOCAL, 'sid-history', { sessionProvider: 'claude', messages: [historyMessage] })

    await expect(ensure(LOCAL).done).resolves.toBe('sid-history')

    expect(getSession).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
    expect(listProjects).not.toHaveBeenCalled()
    expect(project(LOCAL)._sessions['sid-history'].hostSessionOwned).toBe(true)
    expect(activateSession).toHaveBeenCalledWith(LOCAL, 'sid-history', LOCAL)
  })

  it('explains a create the host refuses because the harness is not ready', async () => {
    seed(NODE, 'draft-1', { preferredProvider: 'claude' })
    createSession.mockRejectedValueOnce(new Error('harness not ready: claude'))

    await expect(ensure(NODE).done).rejects.toThrow(
      'The claude harness is not ready where this session runs. Enable it there, or switch the chat to a ready harness. (harness not ready: claude)',
    )
    expect(project(NODE)._sessions['draft-1'].hostSessionOwned).toBe(false)
  })

  it('passes any other create failure through unchanged', async () => {
    seed(LOCAL, 'draft-1')
    createSession.mockRejectedValueOnce(new Error('lease denied'))

    await expect(ensure(LOCAL).done).rejects.toThrow(/^lease denied$/)
  })
})

describe('sessionTurnRequest', () => {
  const turn = { text: 'hello', clientMessageId: 'u1' }

  function codexSession(path: string) {
    seed(path, 'codex-sid', {
      sessionProvider: 'codex',
      selectedCodexPermissionPreset: 'auto-review',
      selectedCodexServiceTier: 'fast',
      _providerSessionId: 'thread-1',
    })
  }

  it("carries this desktop's own choices to its host", () => {
    codexSession(LOCAL)

    const request = sessionTurnRequest(useChatStore.getState(), LOCAL, 'codex-sid', {
      ...turn,
      queued: true,
      inputRequest: { requestId: 'form-1', values: { note: 'x' } },
    })

    expect(request).toMatchObject({
      sessionId: 'codex-sid',
      projectPath: LOCAL,
      providerId: 'codex',
      text: 'hello',
      clientMessageId: 'u1',
      turnKind: 'run',
      additionalDirectories: [],
      priority: 'next',
      inputRequest: { requestId: 'form-1', values: { note: 'x' } },
      permissionPreset: 'auto-review',
      serviceTier: 'fast',
      threadId: 'thread-1',
    })
  })

  it('leaves the choices a node refuses out of its turns', () => {
    codexSession(NODE)

    const request = sessionTurnRequest(useChatStore.getState(), NODE, 'codex-sid', {
      ...turn,
      queued: true,
      inputRequest: { requestId: 'form-1', values: {} },
    })

    expect(request).toMatchObject({ sessionId: 'codex-sid', projectPath: NODE, providerId: 'codex', turnKind: 'run', additionalDirectories: [] })
    for (const key of ['priority', 'inputRequest', 'permissionPreset', 'serviceTier', 'threadId', 'agent', 'modelParams']) {
      expect(request).not.toHaveProperty(key)
    }
  })

  it('names the OpenCode agent and Cursor parameters only to this desktop', () => {
    seed(LOCAL, 'oc', { sessionProvider: 'opencode', openCodeAgentId: 'general' })
    expect(sessionTurnRequest(useChatStore.getState(), LOCAL, 'oc', turn)).toMatchObject({ agent: 'general' })
    seed(NODE, 'oc', { sessionProvider: 'opencode', openCodeAgentId: 'general' })
    expect(sessionTurnRequest(useChatStore.getState(), NODE, 'oc', turn)).not.toHaveProperty('agent')

    seed(LOCAL, 'cur', { sessionProvider: 'cursor', cursorModelParams: { thinking: 'on' } })
    expect(sessionTurnRequest(useChatStore.getState(), LOCAL, 'cur', turn)).toMatchObject({ modelParams: { thinking: 'on' } })
  })

  it('sends permission and sandbox only with the first turn', () => {
    seed(LOCAL, 'sid', { sessionProvider: 'claude', permissionMode: 'acceptEdits', sandboxInfo: { enabled: true, autoAllowBash: false } })

    const first = sessionTurnRequest(useChatStore.getState(), LOCAL, 'sid', { ...turn, firstTurn: true })
    expect(first).toMatchObject({ permissionMode: 'acceptEdits', sandboxMode: 'on' })

    const later = sessionTurnRequest(useChatStore.getState(), LOCAL, 'sid', turn)
    expect(later).not.toHaveProperty('permissionMode')
    expect(later).not.toHaveProperty('sandboxMode')
  })

  it("falls back to the project's sandbox, and leaves an unknown sandbox to the host", () => {
    seed(LOCAL, 'sid', { sessionProvider: 'claude' }, { sandboxInfo: { enabled: true, autoAllowBash: true } })
    expect(sessionTurnRequest(useChatStore.getState(), LOCAL, 'sid', { ...turn, firstTurn: true })).toMatchObject({ sandboxMode: 'auto' })

    seed(LOCAL, 'sid', { sessionProvider: 'claude', sandboxInfo: null }, { sandboxInfo: null })
    const request = sessionTurnRequest(useChatStore.getState(), LOCAL, 'sid', { ...turn, firstTurn: true })
    expect(request).toMatchObject({ permissionMode: 'default' })
    expect(request).not.toHaveProperty('sandboxMode')
  })

  it("sends the session's model, provider account and folders to a node every turn", () => {
    seed(NODE, 'sid', { sessionProvider: 'claude', selectedModel: 'opus', selectedEffort: 'max', apiProviderId: 'acct', additionalDirs: ['/a', '/a', '/b'] })
    expect(sessionTurnRequest(useChatStore.getState(), NODE, 'sid', turn)).toMatchObject({
      model: 'opus', effort: 'max', apiProviderId: 'acct', ultracode: false, additionalDirectories: ['/a', '/b'],
    })
  })
})
