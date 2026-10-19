import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentService, sessionRepo, AgentIpcChannels, appSettings, createdAgents,
  dshMcpMocks, remoteDshMcpMocks, mockExistsSync, makeMockSession,
  getRegisteredIpcHandler, realtimeTimelineRepoMocks,
} from './agent-service.test-fixtures'

describe('dsh MCP config IPC', () => {
  function setupHandlers() {
    const service = new AgentService()
    service.setup()
    return service
  }

  it('delegates local list, save, toggle, and delete to the dsh patch layer', async () => {
    dshMcpMocks.list.mockReturnValue([{ name: 'files', scope: 'user', type: 'stdio' }])
    setupHandlers()

    const list = getRegisteredIpcHandler(AgentIpcChannels.DSH_MCP_LIST_CONFIG)!
    const save = getRegisteredIpcHandler(AgentIpcChannels.DSH_MCP_SAVE_CONFIG)!
    const toggle = getRegisteredIpcHandler(AgentIpcChannels.DSH_MCP_TOGGLE_CONFIG)!
    const remove = getRegisteredIpcHandler(AgentIpcChannels.DSH_MCP_DELETE_CONFIG)!

    await expect(list(null, '/project')).resolves.toEqual([
      { name: 'files', scope: 'user', type: 'stdio' },
    ])
    await save(null, '/project', 'files', { type: 'stdio', command: 'node' }, 'user')
    await toggle(null, '/project', 'files', true, 'user')
    await remove(null, '/project', 'files', 'user')

    expect(dshMcpMocks.list).toHaveBeenCalledWith('/project')
    expect(dshMcpMocks.save).toHaveBeenCalledWith('files', { type: 'stdio', command: 'node' }, 'user', '/project')
    expect(dshMcpMocks.toggle).toHaveBeenCalledWith('files', true, 'user', '/project')
    expect(dshMcpMocks.delete).toHaveBeenCalledWith('files', 'user', '/project')
  })

  it('routes remote projects through the environment facade with provider dsh', async () => {
    remoteDshMcpMocks.list.mockResolvedValue([{ name: 'remote', scope: 'user' }])
    remoteDshMcpMocks.save.mockResolvedValue(true)
    remoteDshMcpMocks.toggle.mockResolvedValue(true)
    remoteDshMcpMocks.delete.mockResolvedValue(true)
    setupHandlers()

    const projectPath = 'remote:conn-1:/work/app'
    const list = getRegisteredIpcHandler(AgentIpcChannels.DSH_MCP_LIST_CONFIG)!
    const save = getRegisteredIpcHandler(AgentIpcChannels.DSH_MCP_SAVE_CONFIG)!
    const toggle = getRegisteredIpcHandler(AgentIpcChannels.DSH_MCP_TOGGLE_CONFIG)!
    const remove = getRegisteredIpcHandler(AgentIpcChannels.DSH_MCP_DELETE_CONFIG)!

    await expect(list(null, projectPath)).resolves.toEqual([{ name: 'remote', scope: 'user' }])
    await save(null, projectPath, 'remote', { type: 'http', url: 'https://example.com/mcp' }, 'user')
    await toggle(null, projectPath, 'remote', false, 'user')
    await remove(null, projectPath, 'remote', 'user')

    expect(remoteDshMcpMocks.list).toHaveBeenCalledWith(remoteDshMcpMocks.host, projectPath, 'dsh')
    expect(remoteDshMcpMocks.save).toHaveBeenCalledWith(remoteDshMcpMocks.host, projectPath, {
      provider: 'dsh',
      name: 'remote',
      scope: 'user',
      config: { type: 'http', url: 'https://example.com/mcp' },
    })
    expect(remoteDshMcpMocks.toggle).toHaveBeenCalledWith(remoteDshMcpMocks.host, projectPath, {
      provider: 'dsh', name: 'remote', scope: 'user', disabled: false,
    })
    expect(remoteDshMcpMocks.delete).toHaveBeenCalledWith(remoteDshMcpMocks.host, projectPath, {
      provider: 'dsh', name: 'remote', scope: 'user',
    })
  })

  it('rejects project-scope writes before touching local or remote storage', async () => {
    setupHandlers()
    const save = getRegisteredIpcHandler(AgentIpcChannels.DSH_MCP_SAVE_CONFIG)!
    const toggle = getRegisteredIpcHandler(AgentIpcChannels.DSH_MCP_TOGGLE_CONFIG)!
    const remove = getRegisteredIpcHandler(AgentIpcChannels.DSH_MCP_DELETE_CONFIG)!

    await expect(save(null, '/project', 'files', { type: 'stdio', command: 'node' }, 'project')).rejects.toThrow('only supports user scope')
    await expect(toggle(null, '/project', 'files', true, 'project')).rejects.toThrow('only supports user scope')
    await expect(remove(null, '/project', 'files', 'project')).rejects.toThrow('only supports user scope')
    expect(dshMcpMocks.save).not.toHaveBeenCalled()
    expect(dshMcpMocks.toggle).not.toHaveBeenCalled()
    expect(dshMcpMocks.delete).not.toHaveBeenCalled()
  })
})

describe('AgentService new session directory', () => {
  it('returns an unsent prewarmed session to main when the worktree selection is cleared', async () => {
    const service = new AgentService()
    const session = makeMockSession({
      id: 'draft', projectPath: '/repo/main', cwd: '/repo/main/.worktrees/previous',
      snapshot: { harnessId: 'codex', messages: [] },
      prewarm: vi.fn(), applyWorktreeSelection: vi.fn().mockResolvedValue(undefined),
    })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: () => session, getSession: () => session, setActiveSession: vi.fn(),
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.PREWARM)!
    mockExistsSync.mockReturnValueOnce(true)
    await handler(null, '/repo/main', { sessionId: 'draft', provider: 'codex', worktreePath: null })
    expect(session.applyWorktreeSelection).toHaveBeenCalledWith('/repo/main', undefined)
  })

  it.each([
    { channel: AgentIpcChannels.PREWARM, worktreePath: undefined },
    { channel: AgentIpcChannels.PREWARM, worktreePath: null },
  ])('starts a new main session at its project root via $channel with worktreePath=$worktreePath', async ({ channel, worktreePath }) => {
    const service = new AgentService()
    const previous = makeMockSession({ id: 'previous', cwd: '/repo/main/.worktrees/previous' })
    const createSession = vi.fn((opts: { id: string; cwd?: string; projectPath: string }) => makeMockSession({
      id: opts.id, cwd: opts.cwd ?? opts.projectPath,
      snapshot: { harnessId: 'codex', messages: [] },
      prewarm: vi.fn(), send: vi.fn().mockResolvedValue(undefined),
    }))
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: () => previous,
      getSession: () => undefined,
      resumeSession: () => { throw new Error('Session not found: new-main') },
      createSession,
    }
    service.setup()
    const handler = getRegisteredIpcHandler(channel)!

    await handler(null, '/repo/main', { sessionId: 'new-main', provider: 'codex', worktreePath, content: 'hello' })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-main', cwd: '/repo/main' }))
    expect(previous.cwd).toBe('/repo/main/.worktrees/previous')
  })
})

describe('AgentService prewarm', () => {
  it('skips local prewarm for a project hosted by a remote node', async () => {
    const service = new AgentService()
    const createSession = vi.fn()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => null),
      createSession,
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.PREWARM)!

    await handler(null, 'remote:env-1:/srv/project', {
      provider: 'claude',
    })

    expect(createSession).not.toHaveBeenCalled()
  })

  it('creates a Codex session for Codex prewarm hints instead of reusing an empty Claude draft', async () => {
    const service = new AgentService()
    const claudeSession = makeMockSession({
      id: 'sid-1',
      cwd: '/p',
      snapshot: { harnessId: 'claude', messages: [] },
      isStreaming: vi.fn(() => false),
      prewarm: vi.fn(),
    })
    const codexSession = makeMockSession({
      id: 'sid-1',
      cwd: '/p',
      snapshot: { harnessId: 'codex', messages: [] },
      isStreaming: vi.fn(() => false),
      prewarm: vi.fn(),
    })
    const disposeSession = vi.fn().mockResolvedValue(undefined)
    const createSession = vi.fn(() => codexSession)
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => claudeSession),
      getSession: vi.fn(() => claudeSession),
      setActiveSession: vi.fn(),
      disposeSession,
      createSession,
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.PREWARM)!

    await handler(null, '/p', { provider: 'codex', sessionId: 'sid-1', model: 'gpt-5.4' })

    expect(disposeSession).toHaveBeenCalledWith('sid-1')
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: '/p',
      providerId: 'codex-base',
      id: 'sid-1',
      model: 'gpt-5.4',
    }))
    expect(codexSession.prewarm).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'codex',
      sessionId: 'sid-1',
      model: 'gpt-5.4',
    }))
    expect(claudeSession.prewarm).not.toHaveBeenCalled()
  })

  it('uses hint.worktreePath as cwd when attaching an existing worktree to a not-yet-instantiated session', async () => {
    const service = new AgentService()
    const otherActive = makeMockSession({
      id: 'sid-other',
      cwd: '/repo/main',
      snapshot: { harnessId: 'claude', messages: [] },
      isStreaming: vi.fn(() => false),
      prewarm: vi.fn(),
    })
    const newSession = makeMockSession({
      id: 'sid-new',
      cwd: '/repo/feat',
      snapshot: { harnessId: 'claude', messages: [] },
      isStreaming: vi.fn(() => false),
      prewarm: vi.fn(),
    })
    const createSession = vi.fn(() => newSession)
    const resumeSession = vi.fn(() => {
      throw new Error('Session not found: sid-new')
    })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => otherActive),
      getSession: vi.fn(() => undefined),
      setActiveSession: vi.fn(),
      disposeSession: vi.fn().mockResolvedValue(undefined),
      createSession,
      resumeSession,
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.PREWARM)!

    await handler(null, '/repo/main', {
      provider: 'claude',
      sessionId: 'sid-new',
      worktreePath: '/repo/feat',
    })

    expect(resumeSession).toHaveBeenCalledWith('sid-new', { passive: true })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: '/repo/main',
      providerId: 'claude-base',
      id: 'sid-new',
      cwd: '/repo/feat',
    }))
    expect(newSession.prewarm).toHaveBeenCalled()
    expect(otherActive.prewarm).not.toHaveBeenCalled()
  })

  it('resumes a disposed session from DB so providerSessionId is restored for ACP load', async () => {
    const service = new AgentService()
    const resumed = makeMockSession({
      id: 'sid-grok',
      cwd: '/p',
      snapshot: {
        harnessId: 'acp',
        messages: [{ id: 'm1', role: 'user', content: [] }],
        providerSessionId: 'prior-grok-session',
      },
      isStreaming: vi.fn(() => false),
      prewarm: vi.fn(),
    })
    const resumeSession = vi.fn(() => resumed)
    const createSession = vi.fn()
    const setActiveSession = vi.fn()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => null),
      getSession: vi.fn(() => undefined),
      setActiveSession,
      disposeSession: vi.fn().mockResolvedValue(undefined),
      createSession,
      resumeSession,
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.PREWARM)!

    await handler(null, '/p', { provider: 'acp', sessionId: 'sid-grok', acpAgentId: 'grok-build' })

    expect(resumeSession).toHaveBeenCalledWith('sid-grok', { passive: true })
    expect(setActiveSession).toHaveBeenCalledWith('/p', 'sid-grok')
    expect(createSession).not.toHaveBeenCalled()
    expect(resumed.prewarm).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'acp',
      sessionId: 'sid-grok',
      acpAgentId: 'grok-build',
    }))
  })
})

describe('AgentService ACTIVATE_SESSION (cwd sync)', () => {
  it('surfaces cold resume failures to the renderer', async () => {
    const service = new AgentService()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => null),
      resumeSession: vi.fn(() => { throw new Error('Session not found: missing') }),
    }
    vi.mocked((await import('../db-sessions')).readSessionHarnessId).mockReturnValueOnce('claude')
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.ACTIVATE_SESSION)!

    await expect(handler(null, '/repo/main', 'missing')).rejects.toThrow('Session not found: missing')
  })

  it('switches the existing session cwd to the worktree cwd when the renderer resumes with a worktreePath that differs from the live session cwd', async () => {
    const service = new AgentService()
    const applyWorktreeSelection = vi.fn().mockResolvedValue(undefined)
    const existing = makeMockSession({
      id: 'sid-existing',
      cwd: '/repo/main',
      snapshot: { harnessId: 'claude', messages: [] },
      isStreaming: vi.fn(() => false),
      applyWorktreeSelection,
      setPermissionMode: vi.fn().mockResolvedValue(undefined),
      getCurrentPermissionMode: vi.fn(() => 'default' as const),
      getCurrentSandboxInfo: vi.fn(() => ({ enabled: true, autoAllowBash: false })),
    })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => existing),
      setActiveSession: vi.fn(),
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.ACTIVATE_SESSION)!
    mockExistsSync.mockReturnValueOnce(true)

    await handler(null, '/repo/main', 'sid-existing', '/repo/main/.worktrees/feat-x')

    expect(applyWorktreeSelection).toHaveBeenCalledWith('/repo/main/.worktrees/feat-x')
  })

  it('does NOT switch cwd to a worktree path that no longer exists — keeps the resolved fallback so the read-only signal survives', async () => {
    const service = new AgentService()
    const applyWorktreeSelection = vi.fn().mockResolvedValue(undefined)
    const resumed = makeMockSession({
      id: 'sid-cold',
      cwd: '/repo/main',
      snapshot: { harnessId: 'claude', messages: [] },
      isStreaming: vi.fn(() => false),
      applyWorktreeSelection,
      getCurrentPermissionMode: vi.fn(() => 'default' as const),
      getCurrentSandboxInfo: vi.fn(() => ({ enabled: true, autoAllowBash: false })),
    })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => null),
      resumeSession: vi.fn(() => resumed),
      setActiveSession: vi.fn(),
    }
    vi.mocked((await import('../db-sessions')).readSessionHarnessId).mockReturnValueOnce('claude')
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.ACTIVATE_SESSION)!
    mockExistsSync.mockReturnValueOnce(false)

    await handler(null, '/repo/main', 'sid-cold', '/repo/main/.worktrees/vanished')

    expect(applyWorktreeSelection).not.toHaveBeenCalled()
  })
})

describe('AgentService routes every worktree pick through the session', () => {
  // `Session.applyWorktreeSelection` owns the rule that a conversation keeps its
  // directory; a raw `switchCwd` from an entry point would bypass it.
  const WT = '/repo/main/.worktrees/feat'
  let realExistsSync: ((...args: unknown[]) => unknown) | undefined
  beforeEach(() => { realExistsSync = mockExistsSync.getMockImplementation() })
  afterEach(() => { if (realExistsSync) mockExistsSync.mockImplementation(realExistsSync) })

  function conversationIn(cwd: string) {
    const switchCwd = vi.fn().mockResolvedValue(undefined)
    const applyWorktreeSelection = vi.fn().mockResolvedValue(undefined)
    const send = vi.fn().mockResolvedValue(undefined)
    const session = makeMockSession({
      id: 'sid-conv',
      cwd,
      snapshot: { harnessId: 'claude', messages: [{ id: 'u1', role: 'user', content: [] }], gitBranch: 'feat/x' },
      isStreaming: vi.fn(() => false),
      switchCwd,
      applyWorktreeSelection,
      send,
      getCurrentPermissionMode: vi.fn(() => 'default' as const),
      getCurrentSandboxInfo: vi.fn(() => ({ enabled: true, autoAllowBash: false })),
    })
    const service = new AgentService()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => session),
      getActiveSession: vi.fn(() => session),
      setActiveSession: vi.fn(),
    }
    mockExistsSync.mockReturnValue(true)
    return { service, switchCwd, applyWorktreeSelection }
  }

  it('resume hands the renderer view to the session instead of moving it', async () => {
    // A phone-created session reached the renderer before its row existed, so the
    // renderer falls back to the project root when it opens the conversation.
    const { service, switchCwd, applyWorktreeSelection } = conversationIn(WT)
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.ACTIVATE_SESSION)!

    await handler(null, '/repo/main', 'sid-conv', '/repo/main')

    expect(applyWorktreeSelection).toHaveBeenCalledWith('/repo/main')
    expect(switchCwd).not.toHaveBeenCalled()
  })

  it('a project-level pick goes to the session main has active as a selection', async () => {
    const { service, switchCwd, applyWorktreeSelection } = conversationIn(WT)

    await service.applyWorktreeSelection('/repo/main', '/repo/main', null)

    expect(applyWorktreeSelection).toHaveBeenCalledWith('/repo/main', null)
    expect(switchCwd).not.toHaveBeenCalled()
  })


})

describe('AgentService Realtime Voice', () => {
  it('loads the local realtime timeline without starting a session runtime', async () => {
    const service = new AgentService()
    const local = {
      segments: [{ id: 'local-1', realtimeSessionId: 'rt-1', role: 'user', text: 'cached' }],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }
    realtimeTimelineRepoMocks.loadRealtimeTimeline.mockReturnValue(local)
    ;(service as { sessionManager: unknown }).sessionManager = { getSession: vi.fn() }
    service.setup()

    const handler = getRegisteredIpcHandler(AgentIpcChannels.LOAD_REALTIME_TIMELINE)!
    expect(handler(null, 'sid-voice')).toEqual(local)
    expect(realtimeTimelineRepoMocks.loadRealtimeTimeline).toHaveBeenCalledWith('sid-voice')
  })

  it('reconciles a provider timeline into the local snapshot without taking the session', async () => {
    const service = new AgentService()
    const timeline = {
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }
    const getRealtimeTimeline = vi.fn(async () => timeline)
    const existing = makeMockSession({
      id: 'sid-voice',
      cwd: '/repo/main',
      snapshot: { projectPath: '/repo/main', harnessId: 'codex', messages: [] },
      getRealtimeTimeline,
    })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => existing),
      getActiveSession: vi.fn(() => existing),
      setActiveSession: vi.fn(),
    }
    service.setup()

    const handler = getRegisteredIpcHandler(AgentIpcChannels.GET_REALTIME_TIMELINE)!
    await expect(handler(null, '/repo/main', 'sid-voice')).resolves.toEqual(timeline)
    expect(realtimeTimelineRepoMocks.reconcileRealtimeTimeline).toHaveBeenCalledWith('sid-voice', timeline)
    expect(existing.lease.current).toBeNull()
  })

  it('does not mint a local session when the project is a remote key', async () => {
    const service = new AgentService()
    const createSession = vi.fn()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => null),
      getActiveSession: vi.fn(() => null),
      createSession,
    }
    service.setup()

    const handler = getRegisteredIpcHandler(AgentIpcChannels.GET_REALTIME_TIMELINE)!
    await expect(handler(null, 'remote:env-1:/work/app', 'sid-voice')).resolves.toEqual({
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: false,
    })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('creates a Codex session from the renderer draft before starting voice', async () => {
    const service = new AgentService()
    const startRealtimeVoice = vi.fn().mockResolvedValue(undefined)
    const created = makeMockSession({
      id: 'draft-voice',
      cwd: '/repo/main',
      projectPath: '/repo/main',
      snapshot: { harnessId: 'codex', messages: [] },
      isStreaming: vi.fn(() => false),
      startRealtimeVoice,
    })
    const createSession = vi.fn(() => created)
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => null),
      getActiveSession: vi.fn(() => null),
      resumeSession: vi.fn(() => { throw new Error('Session not found: draft-voice') }),
      createSession,
      realtimeVoice: { start: vi.fn((_session, _endpoint, _attempt, request) => startRealtimeVoice(request)) },
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.START_REALTIME_VOICE)!
    const request = { sdp: 'v=0\na=offer', attemptId: 'draft-attempt' }
    const currentSettings = appSettings.readAppSettings()
    // Not `...Once`: creating the session reads the settings too, now that every
    // harness resolves its own defaults, and a one-shot would be spent there.
    vi.mocked(appSettings.readAppSettings).mockReturnValue({
      ...currentSettings,
      agentPreference: {
        ...currentSettings.agentPreference,
        codex: { ...currentSettings.agentPreference.codex, realtimeVoice: 'juniper' },
      },
    })

    try {
      await handler({ sender: { id: 1 } }, '/repo/main', 'draft-voice', request)

      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
        projectPath: '/repo/main',
        providerId: 'codex-base',
        id: 'draft-voice',
      }))
      expect(startRealtimeVoice).toHaveBeenCalledWith({ ...request, voice: 'juniper' })
    } finally {
      vi.mocked(appSettings.readAppSettings).mockReturnValue(currentSettings)
    }
  })
})

describe('AgentService prewarm worktree', () => {
  it('prewarm switches existing session cwd when worktreePath differs', async () => {
    const service = new AgentService()
    const applyWorktreeSelection = vi.fn().mockResolvedValue(undefined)
    const prewarm = vi.fn()
    const existing = makeMockSession({
      id: 'sid-acp',
      cwd: '/repo/main',
      snapshot: { harnessId: 'acp', messages: [] },
      isStreaming: vi.fn(() => false),
      applyWorktreeSelection,
      prewarm,
    })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => existing),
      setActiveSession: vi.fn(),
      getActiveSession: vi.fn(() => existing),
      disposeSession: vi.fn().mockResolvedValue(undefined),
      createSession: vi.fn(),
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.PREWARM)!
    mockExistsSync.mockReturnValue(true)

    await handler(null, '/repo/main', {
      provider: 'acp',
      sessionId: 'sid-acp',
      worktreePath: '/repo/main/.worktrees/feat',
      acpAgentId: 'grok-build',
    })

    expect(applyWorktreeSelection).toHaveBeenCalledWith('/repo/main/.worktrees/feat', undefined)
    expect(prewarm).toHaveBeenCalled()
  })
})

describe('AgentService.resumeSession', () => {
  it.skip('recreates the active agent when resuming a local session from a worktree cwd', async () => {
    const service = new AgentService()
    const currentAgent = {
      dispose: vi.fn().mockResolvedValue(undefined),
      getCwd: vi.fn(() => '/tmp/project-worktree'),
      getSessionId: vi.fn(() => 'worktree-session'),
      isStreaming: vi.fn(() => false),
      resumeSession: vi.fn().mockResolvedValue(undefined),
    }

    ;(service as any).agents.set('/project', currentAgent)

    await service.resumeSession('/project', 'local-session')

    expect(currentAgent.dispose).toHaveBeenCalledTimes(1)
    expect(currentAgent.resumeSession).not.toHaveBeenCalled()
    expect(createdAgents).toHaveLength(1)
    expect(createdAgents[0].initialize).toHaveBeenCalledWith(
      { cwd: '/project' },
      expect.any(Function),
      'local-session',
      undefined,
    )
  })
})

describe('AgentService.resolveInteractionSession', () => {
  it('returns the session matching sessionId when it belongs to the project', () => {
    const service = new AgentService()
    const session = { id: 'sid-a', projectPath: '/p' }
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn((id: string) => (id === 'sid-a' ? session : null)),
      getActiveSession: vi.fn(() => null),
    }
    const got = (service as unknown as { resolveInteractionSession: (p: string, s: string | undefined) => unknown })
      .resolveInteractionSession('/p', 'sid-a')
    expect(got).toBe(session)
  })

  it('returns null (does NOT fall back to active) when sessionId given but not found — avoids routing response to wrong session', () => {
    const service = new AgentService()
    const activeSession = makeMockSession({ id: 'sid-active', projectPath: '/p' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => null),
      getActiveSession: vi.fn(() => activeSession),
    }
    const got = (service as unknown as { resolveInteractionSession: (p: string, s: string | undefined) => unknown })
      .resolveInteractionSession('/p', 'sid-missing')
    expect(got).toBeNull()
  })

  it('returns null when sessionId belongs to a different project', () => {
    const service = new AgentService()
    const session = { id: 'sid-a', projectPath: '/other' }
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => session),
      getActiveSession: vi.fn(() => null),
    }
    const got = (service as unknown as { resolveInteractionSession: (p: string, s: string | undefined) => unknown })
      .resolveInteractionSession('/p', 'sid-a')
    expect(got).toBeNull()
  })

  it('falls back to active session only when sessionId is undefined (legacy callers)', () => {
    const service = new AgentService()
    const activeSession = makeMockSession({ id: 'sid-active', projectPath: '/p' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => null),
      getActiveSession: vi.fn((p: string) => (p === '/p' ? activeSession : null)),
    }
    const got = (service as unknown as { resolveInteractionSession: (p: string, s: string | undefined) => unknown })
      .resolveInteractionSession('/p', undefined)
    expect(got).toBe(activeSession)
  })
})

describe('IPC interaction responses', () => {
  it('publishes environment events through the injected publisher only', () => {
    const published: unknown[] = []
    const subscribed: unknown[] = []
    const service = new AgentService()
    service.setEnvironmentEventPublisher((e) => { published.push(e) })
    service.addEventSubscriber((e) => { subscribed.push(e) })
    const event = { type: 'provider_changed', harnessId: 'claude', provider: null }
    ;(service as unknown as { publishEnvironmentEvent: (e: unknown) => void }).publishEnvironmentEvent(event)

    expect(published).toEqual([event])
    expect(subscribed).toEqual([])
  })

})

const fsForAddDirTests = await import('fs')
const osForAddDirTests = await import('os')
const pathForAddDirTests = await import('path')
const childProcessForAddDirTests = await import('child_process')

describe('add-dir IPC handlers', () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = fsForAddDirTests
  const { tmpdir, homedir } = osForAddDirTests
  const { join, basename } = pathForAddDirTests
  const childProcess = childProcessForAddDirTests

  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'addir-test-'))
    vi.mocked(childProcess.execFileSync).mockReset()
    vi.mocked(childProcess.execFileSync).mockImplementation(((..._args: unknown[]) => {
      throw new Error('not a git repo')
    }) as unknown as typeof childProcess.execFileSync)
  })

  afterEach(() => {
    try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* noop */ }
  })

  describe('validate-add-dir', () => {
    it('rejects a candidate that does not exist on disk with not-found', async () => {
      const service = new AgentService()
      service.setup()
      const handler = getRegisteredIpcHandler(AgentIpcChannels.VALIDATE_ADD_DIR)!
      const res = await handler({}, '/some/project', join(tmpRoot, 'nonexistent-xyz'))
      expect(res).toEqual({ ok: false, reason: 'not-found' })
    })

    it('rejects a candidate that points at a regular file with not-directory', async () => {
      const file = join(tmpRoot, 'a-file.txt')
      writeFileSync(file, '')
      const service = new AgentService()
      service.setup()
      const handler = getRegisteredIpcHandler(AgentIpcChannels.VALIDATE_ADD_DIR)!
      const res = await handler({}, tmpRoot, file)
      expect(res).toEqual({ ok: false, reason: 'not-directory' })
    })

    it('rejects when candidate equals the project path itself with same-as-project', async () => {
      const proj = join(tmpRoot, 'proj')
      mkdirSync(proj)
      const service = new AgentService()
      service.setup()
      const handler = getRegisteredIpcHandler(AgentIpcChannels.VALIDATE_ADD_DIR)!
      const res = await handler({}, proj, proj)
      expect(res).toEqual({ ok: false, reason: 'same-as-project' })
    })

    it('rejects worktree of the same git repository as the project with same-repo', async () => {
      const proj = join(tmpRoot, 'main-repo'); mkdirSync(proj)
      const wt = join(tmpRoot, 'worktree'); mkdirSync(wt)
      const sharedGitDir = join(tmpRoot, '.git-shared')
      vi.mocked(childProcess.execFileSync).mockImplementation(((..._args: unknown[]) => sharedGitDir) as unknown as typeof childProcess.execFileSync)

      const service = new AgentService()
      service.setup()
      const handler = getRegisteredIpcHandler(AgentIpcChannels.VALIDATE_ADD_DIR)!
      const res = await handler({}, proj, wt)
      expect(res).toEqual({ ok: false, reason: 'same-repo' })
    })

    it('accepts an unrelated valid directory with ok', async () => {
      const proj = join(tmpRoot, 'proj'); mkdirSync(proj)
      const other = join(tmpRoot, 'other'); mkdirSync(other)
      vi.mocked(childProcess.execFileSync).mockImplementation(((_cmd: string, _args: string[], opts: { cwd?: string }) => {
        return opts.cwd === proj ? join(tmpRoot, '.git-proj') : join(tmpRoot, '.git-other')
      }) as unknown as typeof childProcess.execFileSync)

      const service = new AgentService()
      service.setup()
      const handler = getRegisteredIpcHandler(AgentIpcChannels.VALIDATE_ADD_DIR)!
      const res = await handler({}, proj, other)
      expect(res).toEqual({ ok: true })
    })
  })

  describe('list-directory-for-add-dir', () => {
    it('lists entries of the absolute path directly without cwd sandboxing', async () => {
      const target = join(tmpRoot, 'outside')
      mkdirSync(target)
      mkdirSync(join(target, 'a-dir'))
      writeFileSync(join(target, 'b-file.txt'), '')

      const service = new AgentService()
      service.setup()
      const handler = getRegisteredIpcHandler(AgentIpcChannels.LIST_DIRECTORY_FOR_ADD_DIR)!
      const res = await handler({}, '/some/unrelated/project', target) as { absolutePath: string; entries: Array<{ name: string; isDirectory: boolean }> }

      expect(res.absolutePath).toBe(target)
      expect(res.entries.find((e) => e.name === 'a-dir')?.isDirectory).toBe(true)
      expect(res.entries.find((e) => e.name === 'b-file.txt')?.isDirectory).toBe(false)
    })

    it('expands ~ to the user home directory', async () => {
      const service = new AgentService()
      service.setup()
      const handler = getRegisteredIpcHandler(AgentIpcChannels.LIST_DIRECTORY_FOR_ADD_DIR)!
      const res = await handler({}, '/some/project', '~') as { absolutePath: string }
      expect(res.absolutePath).toBe(homedir())
    })

    it('returns empty entries when the resolved path does not exist', async () => {
      const service = new AgentService()
      service.setup()
      const handler = getRegisteredIpcHandler(AgentIpcChannels.LIST_DIRECTORY_FOR_ADD_DIR)!
      const res = await handler({}, tmpRoot, 'definitely-not-here-xyz') as { entries: unknown[] }
      expect(res.entries).toEqual([])
    })

    it('returns empty entries when the path resolves to a file', async () => {
      const file = join(tmpRoot, 'a-file.txt')
      writeFileSync(file, '')
      const service = new AgentService()
      service.setup()
      const handler = getRegisteredIpcHandler(AgentIpcChannels.LIST_DIRECTORY_FOR_ADD_DIR)!
      const res = await handler({}, tmpRoot, basename(file)) as { entries: unknown[] }
      expect(res.entries).toEqual([])
    })
  })
})

describe('AgentService remote @ mention search', () => {
  // The project's active session is whichever chat the desktop last focused;
  // a phone in another checkout must still search its own.
  let realExistsSync: ((...args: unknown[]) => unknown) | undefined
  beforeEach(() => { realExistsSync = mockExistsSync.getMockImplementation() })
  afterEach(() => { if (realExistsSync) mockExistsSync.mockImplementation(realExistsSync) })

  function serviceWith(live: Record<string, unknown> | null) {
    const focused = { id: 'sid-focused', projectPath: '/repo/main', cwd: '/repo/main/.worktrees/focused', getAdditionalDirectoriesSnapshot: () => ['/extra/focused'] }
    const service = new AgentService()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn((id: string) => (live?.id === id ? live : null)),
      getActiveSession: vi.fn(() => focused),
    }
    return service
  }

  it('searches the asking session\'s checkout, not the project\'s active one', async () => {
    const service = serviceWith({ id: 'sid-phone', projectPath: '/repo/main', cwd: '/repo/main/.worktrees/phone', getAdditionalDirectoriesSnapshot: () => ['/extra/phone'] })
    const { searchRemoteMentions } = await import('./remote-mention-search')

    await expect(service.remoteSearchMentions('/repo/main', 'new', { sessionId: 'sid-phone' })).resolves.toEqual({ cwd: '/repo/main/.worktrees/phone' })
    expect(searchRemoteMentions).toHaveBeenLastCalledWith('/repo/main', '/repo/main/.worktrees/phone', 'new', { additionalDirs: ['/extra/phone'] })
  })

  it('reads an unloaded session\'s checkout from its row', async () => {
    vi.mocked(sessionRepo.getSessionRecord).mockReturnValueOnce({ projectPath: '/repo/main', worktreePath: '/repo/main/.worktrees/cold' } as never)

    await expect(serviceWith(null).remoteSearchMentions('/repo/main', '', { sessionId: 'sid-cold' })).resolves.toEqual({ cwd: '/repo/main/.worktrees/cold' })
  })

  it('searches the project, or a live worktree the draft picked, before the chat exists', async () => {
    const service = serviceWith(null)

    await expect(service.remoteSearchMentions('/repo/main', '', {})).resolves.toEqual({ cwd: '/repo/main' })
    mockExistsSync.mockImplementationOnce(() => false)
    await expect(service.remoteSearchMentions('/repo/main', '', { worktreePath: '/worktrees/gone' })).resolves.toEqual({ cwd: '/repo/main' })
    mockExistsSync.mockImplementation(() => true)
    await expect(service.remoteSearchMentions('/repo/main', '', { worktreePath: '/worktrees/picked' })).resolves.toEqual({ cwd: '/worktrees/picked' })
  })

  it('ignores a session that belongs to another project', async () => {
    const service = serviceWith({ id: 'sid-other', projectPath: '/repo/other', cwd: '/repo/other', getAdditionalDirectoriesSnapshot: () => [] })

    await expect(service.remoteSearchMentions('/repo/main', '', { sessionId: 'sid-other' })).resolves.toEqual({ cwd: '/repo/main' })
  })
})
