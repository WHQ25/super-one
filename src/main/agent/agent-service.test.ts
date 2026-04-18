import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createdAgents } = vi.hoisted(() => ({
  createdAgents: [] as Array<{
    cwd: string
    sessionId: string
    initialize: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    getCwd: ReturnType<typeof vi.fn>
    isReady: ReturnType<typeof vi.fn>
    isStreaming: ReturnType<typeof vi.fn>
    resumeSession: ReturnType<typeof vi.fn>
    getSessionId: ReturnType<typeof vi.fn>
    sendMessage: ReturnType<typeof vi.fn>
    updateEventEmitter: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('./project-additional-dirs', () => ({
  readProjectAdditionalDirs: vi.fn(),
  writeProjectAdditionalDirs: vi.fn(),
}))

vi.mock('./fuzzy-file-search', () => ({
  searchFiles: vi.fn(),
  searchMentions: vi.fn(),
}))

vi.mock('../db-sessions', () => ({
  listSessionsForFolder: vi.fn(),
  createSession: vi.fn(),
  renameSession: vi.fn(),
  saveSessionState: vi.fn(),
  loadSessionState: vi.fn(),
  sessionBelongsToProject: vi.fn(),
  deleteSession: vi.fn(),
  deleteSessionsOlderThan: vi.fn(),
  pinSession: vi.fn(),
  hideSession: vi.fn(),
  listPinnedSessions: vi.fn(),
}))

vi.mock('../session-history', () => ({
  loadSessionMessages: vi.fn(),
}))

vi.mock('../mcp-config-service', () => ({
  listMcpConfigs: vi.fn(),
  saveMcpConfig: vi.fn(),
  deleteMcpConfig: vi.fn(),
  toggleMcpConfig: vi.fn(),
}))

vi.mock('../mcp-probe-service', () => ({
  checkMcpServers: vi.fn(),
}))

vi.mock('../mcp-oauth', () => ({
  authorizeHttpMcpServer: vi.fn(),
}))

vi.mock('../skills-service', () => ({
  listSkills: vi.fn(),
  readSkillContent: vi.fn(),
  readSkillFile: vi.fn(),
  installSkill: vi.fn(),
  deleteSkill: vi.fn(),
  listCodexSkills: vi.fn(),
  readCodexSkillContent: vi.fn(),
  readCodexSkillFile: vi.fn(),
  deleteCodexSkill: vi.fn(),
}))

vi.mock('../codex-config-service', () => ({
  listCodexMcpConfigs: vi.fn(),
}))

vi.mock('./discover-resources', () => ({
  discoverAllAgents: vi.fn(),
  readAgentFile: vi.fn(),
}))

vi.mock('../plugins-service', () => ({
  listPlugins: vi.fn(),
  readPluginContent: vi.fn(),
  readPluginFile: vi.fn(),
  deletePlugin: vi.fn(),
  listMarketplacePlugins: vi.fn(),
  installPlugin: vi.fn(),
  updatePlugin: vi.fn(),
  updateMarketplace: vi.fn(),
}))

vi.mock('../mcp-library-service', () => ({
  backupMcpServers: vi.fn(),
  listLibrary: vi.fn(),
  deleteLibraryEntry: vi.fn(),
}))

vi.mock('../database', () => ({
  getAllProviders: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  activateProvider: vi.fn(),
  deactivateAllProviders: vi.fn(),
}))

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../recent-folders', () => ({
  getRecentFolders: vi.fn(() => [
    { path: '/projects/app-one', name: 'app-one', added_at: '2025-01-01' },
    { path: '/projects/app-two', name: 'app-two', added_at: '2025-01-02' },
  ]),
  addRecentFolder: vi.fn(),
  removeRecentFolder: vi.fn(),
}))

const mockReaddir = vi.fn()
const mockMkdir = vi.fn()
vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}))

vi.mock('../remote-control-service', () => ({}))

vi.mock('../mcp/superone-mcp-server', () => ({
  clearAllPendingCalls: vi.fn(),
}))

vi.mock('./resolve-cli', () => ({
  fixPath: vi.fn(),
  findSystemClaude: vi.fn(),
  resolveSdkCli: vi.fn(),
  clearCliCache: vi.fn(),
  getClaudeCliPath: vi.fn(),
  getNodeRuntime: vi.fn(() => ({ path: 'node', args: [] })),
}))

const { AgentService } = await import('./agent-service')
const dbSessions = await import('../db-sessions')

beforeEach(() => {
  createdAgents.length = 0
  vi.clearAllMocks()
  vi.mocked(dbSessions.sessionBelongsToProject).mockReturnValue(true)
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

describe('AgentService.handleRemoteCommand', () => {
  it('list_directory returns sorted items with directories first', async () => {
    mockReaddir.mockResolvedValue([
      { name: 'zebra.txt', isDirectory: () => false },
      { name: 'src', isDirectory: () => true },
      { name: 'alpha.txt', isDirectory: () => false },
      { name: 'docs', isDirectory: () => true },
    ])
    const respond = vi.fn()
    const service = new AgentService()
    await service.handleRemoteCommand({ type: 'list_directory', requestId: 'r1', path: '/test' }, respond)
    expect(respond).toHaveBeenCalledWith('r1', {
      items: [
        { name: 'docs', isDirectory: true },
        { name: 'src', isDirectory: true },
        { name: 'alpha.txt', isDirectory: false },
        { name: 'zebra.txt', isDirectory: false },
      ],
    })
  })

  it('list_directory filters dotfiles', async () => {
    mockReaddir.mockResolvedValue([
      { name: '.git', isDirectory: () => true },
      { name: 'src', isDirectory: () => true },
    ])
    const respond = vi.fn()
    const service = new AgentService()
    await service.handleRemoteCommand({ type: 'list_directory', requestId: 'r2', path: '/test' }, respond)
    expect(respond).toHaveBeenCalledWith('r2', {
      items: [{ name: 'src', isDirectory: true }],
    })
  })

  it('list_directory returns error for invalid path', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT: no such directory'))
    const respond = vi.fn()
    const service = new AgentService()
    await service.handleRemoteCommand({ type: 'list_directory', requestId: 'r3', path: '/nonexistent' }, respond)
    expect(respond).toHaveBeenCalledWith('r3', { error: 'ENOENT: no such directory' })
  })

  it('create_directory calls mkdir with correct path', async () => {
    mockMkdir.mockResolvedValue(undefined)
    const respond = vi.fn()
    const service = new AgentService()
    await service.handleRemoteCommand({ type: 'create_directory', requestId: 'r4', path: '/projects', name: 'new-app' }, respond)
    expect(mockMkdir).toHaveBeenCalledWith('/projects/new-app')
    expect(respond).toHaveBeenCalledWith('r4', { success: true })
  })

  it('create_directory rejects names with path traversal', async () => {
    const respond = vi.fn()
    const service = new AgentService()
    await service.handleRemoteCommand({ type: 'create_directory', requestId: 'r5', path: '/projects', name: '../escape' }, respond)
    expect(mockMkdir).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith('r5', { error: 'Invalid directory name' })
  })

  it('create_directory rejects names with slashes', async () => {
    const respond = vi.fn()
    const service = new AgentService()
    await service.handleRemoteCommand({ type: 'create_directory', requestId: 'r6', path: '/projects', name: 'a/b' }, respond)
    expect(mockMkdir).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith('r6', { error: 'Invalid directory name' })
  })

  it('list_projects returns formatted project list', async () => {
    const respond = vi.fn()
    const service = new AgentService()
    await service.handleRemoteCommand({ type: 'list_projects', requestId: 'r7' }, respond)
    expect(respond).toHaveBeenCalledWith('r7', {
      projects: [
        { path: '/projects/app-one', name: 'app-one' },
        { path: '/projects/app-two', name: 'app-two' },
      ],
    })
  })

  it('send_message does not throw when no active agent', async () => {
    const service = new AgentService()
    await expect(
      service.handleRemoteCommand({ type: 'send_message', content: 'hello' }),
    ).resolves.toBeUndefined()
  })

  it.skip('send_message creates remote agent when sessionId differs from desktop agent', async () => {
    vi.mocked(dbSessions.loadSessionState).mockReturnValue(null)
    const service = new AgentService()
    const desktopSendMessage = vi.fn().mockResolvedValue(undefined)
    const currentAgent = {
      isReady: vi.fn(() => true),
      getSessionId: vi.fn(() => 'session-A'),
      sendMessage: desktopSendMessage,
      getCwd: vi.fn(() => '/project'),
      isStreaming: vi.fn(() => false),
    }
    ;(service as any).agents.set('/project', currentAgent)
    ;(service as any).remoteControlService = {
      setRemoteSessionFilter: vi.fn(),
      clearRemoteSessionFilter: vi.fn(),
    }

    await service.handleRemoteCommand({
      type: 'send_message',
      content: 'hello',
      projectPath: '/project',
      sessionId: 'session-B',
    })

    expect(createdAgents).toHaveLength(1)
    expect(createdAgents[0].initialize).toHaveBeenCalledWith(
      { cwd: '/project' },
      expect.any(Function),
      'session-B',
    )
    expect(desktopSendMessage).not.toHaveBeenCalled()
    expect((service as any).remoteSession).not.toBeNull()
    expect((service as any).remoteSession.agent).toBe(createdAgents[0])
  })

  it.skip('send_message persists merged history from main runtime instead of renderer snapshots', async () => {
    vi.mocked(dbSessions.loadSessionState).mockReturnValue({
      messages: [
        { id: 'old-msg', role: 'assistant', content: [{ type: 'text', text: 'old' }], status: 'complete', createdAt: '', providerId: 'claude' },
      ] as never[],
      totalCostUsd: 1,
      contextTokens: 2,
      isWorktree: false,
      gitBranch: null,
      worktreePath: null,
      provider: 'claude',
    })
    const service = new AgentService()
    const sendMessage = vi.fn().mockResolvedValue(undefined)
    const currentAgent = {
      isReady: vi.fn(() => true),
      getSessionId: vi.fn(() => 'session-A'),
      sendMessage,
      getCwd: vi.fn(() => '/project'),
      isStreaming: vi.fn(() => false),
    }
    ;(service as any).agents.set('/project', currentAgent)

    await service.handleRemoteCommand({
      type: 'send_message',
      content: 'hello',
      projectPath: '/project',
      sessionId: 'session-A',
    })

    expect(dbSessions.saveSessionState).toHaveBeenCalledWith(
      'session-A',
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ id: 'old-msg' }),
          expect.objectContaining({ role: 'user', providerId: 'remote' }),
        ]),
        totalCostUsd: 1,
        contextTokens: 2,
        provider: 'claude',
      }),
    )
  })

  it.skip('session_init moves a just-appended user message into the rekeyed session', () => {
    vi.mocked(dbSessions.loadSessionState).mockImplementation((sessionId: string) => {
      if (sessionId !== 'session-old') return null
      return {
        messages: [
          { id: 'user-old', role: 'user', content: [{ type: 'text', text: 'old title' }], status: 'complete', createdAt: '', providerId: 'local' },
          { id: 'assistant-old', role: 'assistant', content: [{ type: 'text', text: 'old reply' }], status: 'complete', createdAt: '', providerId: 'claude' },
        ] as never[],
        totalCostUsd: 1,
        contextTokens: 2,
        isWorktree: false,
        gitBranch: null,
        worktreePath: null,
        provider: 'claude',
      }
    })

    const service = new AgentService()
    const userMessage = (service as any).appendClaudeUserMessage(
      '/project',
      { content: 'follow up', clientMessageId: 'user-new' },
      'remote',
      'session-old',
    )
    ;(service as any).trackClaudeSessionRekey('/project', 'session-old', userMessage.id)

    ;(service as any).recordClaudeEvent({
      type: 'session_init',
      projectPath: '/project',
      session: {
        sessionId: 'session-new',
        model: 'claude',
        tools: [],
        mcpServers: [],
        permissionMode: 'default',
        slashCommands: [],
        skills: [],
        claudeCodeVersion: '1.0.0',
        cwd: '/project',
      },
    })

    const saveCalls = vi.mocked(dbSessions.saveSessionState).mock.calls
    const oldCall = saveCalls.filter(([sessionId]) => sessionId === 'session-old').at(-1)
    const newCall = saveCalls.filter(([sessionId]) => sessionId === 'session-new').at(-1)

    expect(oldCall?.[1]).toEqual(expect.objectContaining({
      messages: [
        expect.objectContaining({ id: 'user-old' }),
        expect.objectContaining({ id: 'assistant-old' }),
      ],
      title: 'old title',
      provider: 'claude',
    }))
    expect(newCall?.[1]).toEqual(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ id: 'user-old' }),
        expect.objectContaining({ id: 'assistant-old' }),
        expect.objectContaining({ id: 'user-new', role: 'user', providerId: 'remote' }),
      ]),
      title: 'old title',
      provider: 'claude',
    }))
  })

  it.skip('session_init keeps concurrent draft runtimes isolated by draftSessionId', () => {
    const service = new AgentService()

    ;(service as any).recordClaudeEvent({
      type: 'message_start',
      projectPath: '/project',
      draftSessionId: 'draft-a',
      message: {
        id: 'assistant-a',
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: '',
        providerId: 'claude',
      },
    })
    ;(service as any).recordClaudeEvent({
      type: 'message_start',
      projectPath: '/project',
      draftSessionId: 'draft-b',
      message: {
        id: 'assistant-b',
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: '',
        providerId: 'claude',
      },
    })

    ;(service as any).recordClaudeEvent({
      type: 'session_init',
      projectPath: '/project',
      draftSessionId: 'draft-a',
      session: {
        sessionId: 'session-a',
        model: 'claude',
        tools: [],
        mcpServers: [],
        permissionMode: 'default',
        slashCommands: [],
        skills: [],
        claudeCodeVersion: '1.0.0',
        cwd: '/project',
      },
    })
    ;(service as any).recordClaudeEvent({
      type: 'session_init',
      projectPath: '/project',
      draftSessionId: 'draft-b',
      session: {
        sessionId: 'session-b',
        model: 'claude',
        tools: [],
        mcpServers: [],
        permissionMode: 'default',
        slashCommands: [],
        skills: [],
        claudeCodeVersion: '1.0.0',
        cwd: '/project',
      },
    })

    const saveCalls = vi.mocked(dbSessions.saveSessionState).mock.calls
    const callA = saveCalls.filter(([sessionId]) => sessionId === 'session-a').at(-1)
    const callB = saveCalls.filter(([sessionId]) => sessionId === 'session-b').at(-1)

    expect(callA?.[1]).toEqual(expect.objectContaining({
      messages: [expect.objectContaining({ id: 'assistant-a' })],
      provider: 'claude',
    }))
    expect(callB?.[1]).toEqual(expect.objectContaining({
      messages: [expect.objectContaining({ id: 'assistant-b' })],
      provider: 'claude',
    }))
  })

  it.skip('rekeys active pending runtime from project path to draftSessionId before session_init', () => {
    const service = new AgentService()

    ;(service as any).appendClaudeUserMessage(
      '/project',
      { content: 'second draft', clientMessageId: 'user-draft-2' },
      'local',
    )

    ;(service as any).recordClaudeEvent({
      type: 'status_change',
      projectPath: '/project',
      draftSessionId: 'draft-b',
      status: 'streaming',
    })
    ;(service as any).recordClaudeEvent({
      type: 'message_start',
      projectPath: '/project',
      draftSessionId: 'draft-b',
      message: {
        id: 'assistant-b',
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: '',
        providerId: 'claude',
      },
    })
    ;(service as any).recordClaudeEvent({
      type: 'session_init',
      projectPath: '/project',
      draftSessionId: 'draft-b',
      session: {
        sessionId: 'session-b',
        model: 'claude',
        tools: [],
        mcpServers: [],
        permissionMode: 'default',
        slashCommands: [],
        skills: [],
        claudeCodeVersion: '1.0.0',
        cwd: '/project',
      },
    })

    const saveCalls = vi.mocked(dbSessions.saveSessionState).mock.calls
    const callB = saveCalls.filter(([sessionId]) => sessionId === 'session-b').at(-1)

    expect(callB?.[1]).toEqual(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ id: 'user-draft-2', role: 'user' }),
        expect.objectContaining({ id: 'assistant-b', role: 'assistant' }),
      ]),
      provider: 'claude',
    }))
  })


  it.skip('send_message skips resume when sessionId matches current agent', async () => {
    const service = new AgentService()
    const sendMessage = vi.fn().mockResolvedValue(undefined)
    const currentAgent = {
      isReady: vi.fn(() => true),
      getSessionId: vi.fn(() => 'session-A'),
      sendMessage,
      getCwd: vi.fn(() => '/project'),
      isStreaming: vi.fn(() => false),
    }
    ;(service as any).agents.set('/project', currentAgent)

    await service.handleRemoteCommand({
      type: 'send_message',
      content: 'hello',
      projectPath: '/project',
      sessionId: 'session-A',
    })

    expect(createdAgents).toHaveLength(0)
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'hello' }),
    )
  })

  it.skip('send_message ignores session ids that do not belong to the project', async () => {
    vi.mocked(dbSessions.sessionBelongsToProject).mockReturnValue(false)
    const service = new AgentService()
    const sendMessage = vi.fn().mockResolvedValue(undefined)
    const currentAgent = {
      isReady: vi.fn(() => true),
      getSessionId: vi.fn(() => 'session-A'),
      sendMessage,
      getCwd: vi.fn(() => '/project'),
      isStreaming: vi.fn(() => false),
    }
    ;(service as any).agents.set('/project', currentAgent)

    await service.handleRemoteCommand({
      type: 'send_message',
      content: 'hello',
      projectPath: '/project',
      sessionId: 'session-B',
    })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(createdAgents).toHaveLength(0)
  })

  it.skip('send_message with sessionId creates remote session instead of resuming desktop agent', async () => {
    vi.mocked(dbSessions.loadSessionState).mockReturnValue(null)
    const service = new AgentService()
    const desktopAgent = {
      isReady: vi.fn(() => true),
      getSessionId: vi.fn(() => 'desktop-session'),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getCwd: vi.fn(() => '/project'),
      isStreaming: vi.fn(() => false),
    }
    ;(service as any).agents.set('/project', desktopAgent)

    const setFilter = vi.fn()
    const clearFilter = vi.fn()
    ;(service as any).remoteControlService = {
      setRemoteSessionFilter: setFilter,
      clearRemoteSessionFilter: clearFilter,
    }

    await service.handleRemoteCommand({
      type: 'send_message',
      content: 'hello from mobile',
      projectPath: '/project',
      sessionId: 'old-session-from-db',
    })

    expect(createdAgents).toHaveLength(1)
    expect(createdAgents[0].initialize).toHaveBeenCalledWith(
      { cwd: '/project' },
      expect.any(Function),
      'old-session-from-db',
    )

    const remoteSession = (service as any).remoteSession
    expect(remoteSession).not.toBeNull()
    expect(remoteSession.projectPath).toBe('/project')
    expect(remoteSession.agent).toBe(createdAgents[0])

    expect(clearFilter).toHaveBeenCalled()
    expect(setFilter).toHaveBeenCalledWith('/project', 'old-session-from-db')

    expect(desktopAgent.sendMessage).not.toHaveBeenCalled()
    expect(desktopAgent.getSessionId()).toBe('desktop-session')
  })

  it.skip('send_message with sessionId uses worktree cwd from saved state', async () => {
    vi.mocked(dbSessions.loadSessionState).mockReturnValue({
      messages: [],
      worktreePath: '/tmp/worktree-abc',
    } as never)
    const service = new AgentService()
    ;(service as any).agents.set('/project', {
      isReady: vi.fn(() => true),
      getSessionId: vi.fn(() => 'desktop-session'),
      sendMessage: vi.fn(),
      getCwd: vi.fn(() => '/project'),
      isStreaming: vi.fn(() => false),
    })
    ;(service as any).remoteControlService = {
      setRemoteSessionFilter: vi.fn(),
      clearRemoteSessionFilter: vi.fn(),
    }

    await service.handleRemoteCommand({
      type: 'send_message',
      content: 'hello',
      projectPath: '/project',
      sessionId: 'worktree-session',
    })

    expect(createdAgents).toHaveLength(1)
    expect(createdAgents[0].initialize).toHaveBeenCalledWith(
      { cwd: '/tmp/worktree-abc' },
      expect.any(Function),
      'worktree-session',
    )
  })

  it.skip('send_message with sessionId disposes existing remote session before creating new one', async () => {
    vi.mocked(dbSessions.loadSessionState).mockReturnValue(null)
    const service = new AgentService()
    ;(service as any).agents.set('/project', {
      isReady: vi.fn(() => true),
      getSessionId: vi.fn(() => 'desktop-session'),
      sendMessage: vi.fn(),
      getCwd: vi.fn(() => '/project'),
      isStreaming: vi.fn(() => false),
    })

    const oldRemoteDispose = vi.fn().mockResolvedValue(undefined)
    ;(service as any).remoteSession = {
      projectPath: '/project',
      agent: { dispose: oldRemoteDispose, getSessionId: vi.fn(() => 'prev-remote') },
      bufferForRenderer: vi.fn(),
    }
    ;(service as any).remoteControlService = {
      setRemoteSessionFilter: vi.fn(),
      clearRemoteSessionFilter: vi.fn(),
    }

    await service.handleRemoteCommand({
      type: 'send_message',
      content: 'hello',
      projectPath: '/project',
      sessionId: 'new-old-session',
    })

    expect(oldRemoteDispose).toHaveBeenCalled()
    expect(createdAgents).toHaveLength(1)
    const remoteSession = (service as any).remoteSession
    expect(remoteSession.agent).toBe(createdAgents[0])
  })

  it.skip('interrupt targets active agent when sessionId matches', async () => {
    const service = new AgentService()
    const interrupt = vi.fn().mockResolvedValue(undefined)
    ;(service as any).agents.set('/project', {
      getSessionId: vi.fn(() => 'session-A'),
      interrupt,
    })

    await service.handleRemoteCommand({ type: 'interrupt', projectPath: '/project', sessionId: 'session-A' })
    expect(interrupt).toHaveBeenCalledTimes(1)
  })

  it.skip('interrupt targets background agent when sessionId is in bgAgents', async () => {
    const service = new AgentService()
    const bgInterrupt = vi.fn().mockResolvedValue(undefined)
    ;(service as any).agents.set('/project', {
      getSessionId: vi.fn(() => 'session-A'),
      interrupt: vi.fn(),
    })
    ;(service as any).bgAgents.set('session-B', {
      agent: { getSessionId: vi.fn(() => 'session-B'), interrupt: bgInterrupt },
      projectPath: '/project',
      gitRoot: '/project',
    })

    await service.handleRemoteCommand({ type: 'interrupt', projectPath: '/project', sessionId: 'session-B' })
    expect(bgInterrupt).toHaveBeenCalledTimes(1)
  })

  it.skip('interrupt is no-op when sessionId not found in active or bg', async () => {
    const service = new AgentService()
    const interrupt = vi.fn().mockResolvedValue(undefined)
    ;(service as any).agents.set('/project', {
      getSessionId: vi.fn(() => 'session-A'),
      interrupt,
    })

    await service.handleRemoteCommand({ type: 'interrupt', projectPath: '/project', sessionId: 'session-X' })
    expect(interrupt).not.toHaveBeenCalled()
  })

  it.skip('respond_permission routes to background agent by sessionId', async () => {
    const service = new AgentService()
    const bgRespond = vi.fn()
    ;(service as any).agents.set('/project', {
      getSessionId: vi.fn(() => 'session-A'),
      respondToPermission: vi.fn(),
    })
    ;(service as any).bgAgents.set('session-B', {
      agent: { getSessionId: vi.fn(() => 'session-B'), respondToPermission: bgRespond },
      projectPath: '/project',
      gitRoot: '/project',
    })

    await service.handleRemoteCommand({
      type: 'respond_permission',
      requestId: 'req-1',
      decision: true,
      projectPath: '/project',
      sessionId: 'session-B',
    })
    expect(bgRespond).toHaveBeenCalledWith('req-1', true, undefined, undefined, undefined)
  })

  it.skip('respond_permission is no-op when sessionId not found', async () => {
    const service = new AgentService()
    const respond = vi.fn()
    ;(service as any).agents.set('/project', {
      getSessionId: vi.fn(() => 'session-A'),
      respondToPermission: respond,
    })

    await service.handleRemoteCommand({
      type: 'respond_permission',
      requestId: 'req-1',
      decision: true,
      projectPath: '/project',
      sessionId: 'session-X',
    })
    expect(respond).not.toHaveBeenCalled()
  })

  it.skip('respond_permission passes reason to agent', async () => {
    const service = new AgentService()
    const respond = vi.fn()
    ;(service as any).agents.set('/project', {
      getSessionId: vi.fn(() => 'session-A'),
      respondToPermission: respond,
    })

    await service.handleRemoteCommand({
      type: 'respond_permission',
      requestId: 'req-1',
      decision: false,
      reason: 'not needed',
      projectPath: '/project',
      sessionId: 'session-A',
    })
    expect(respond).toHaveBeenCalledWith('req-1', false, undefined, 'not needed', undefined)
  })

  it.skip('answer_question routes to agent by sessionId', async () => {
    const service = new AgentService()
    const respond = vi.fn()
    ;(service as any).agents.set('/project', {
      getSessionId: vi.fn(() => 'session-A'),
      respondToQuestion: respond,
    })

    await service.handleRemoteCommand({
      type: 'answer_question',
      requestId: 'ask-1',
      answers: { 'Which?': 'Option A' },
      projectPath: '/project',
      sessionId: 'session-A',
    })
    expect(respond).toHaveBeenCalledWith('ask-1', { 'Which?': 'Option A' }, undefined)
  })

  it.skip('dismiss_question routes to agent by sessionId', async () => {
    const service = new AgentService()
    const dismiss = vi.fn()
    ;(service as any).agents.set('/project', {
      getSessionId: vi.fn(() => 'session-A'),
      dismissQuestion: dismiss,
    })

    await service.handleRemoteCommand({
      type: 'dismiss_question',
      requestId: 'ask-1',
      projectPath: '/project',
      sessionId: 'session-A',
    })
    expect(dismiss).toHaveBeenCalledWith('ask-1')
  })

  it.skip('respond_plan_approval routes to agent by sessionId', async () => {
    const service = new AgentService()
    const respond = vi.fn()
    ;(service as any).agents.set('/project', {
      getSessionId: vi.fn(() => 'session-A'),
      respondToPlanApproval: respond,
    })

    await service.handleRemoteCommand({
      type: 'respond_plan_approval',
      requestId: 'plan-1',
      approved: true,
      projectPath: '/project',
      sessionId: 'session-A',
    })
    expect(respond).toHaveBeenCalledWith('plan-1', true, undefined)
  })

  it.skip('respond_plan_approval passes feedback', async () => {
    const service = new AgentService()
    const respond = vi.fn()
    ;(service as any).agents.set('/project', {
      getSessionId: vi.fn(() => 'session-A'),
      respondToPlanApproval: respond,
    })

    await service.handleRemoteCommand({
      type: 'respond_plan_approval',
      requestId: 'plan-1',
      approved: false,
      feedback: 'needs more detail',
      projectPath: '/project',
      sessionId: 'session-A',
    })
    expect(respond).toHaveBeenCalledWith('plan-1', false, 'needs more detail')
  })

  it('load_session_messages returns an error when session does not belong to the project', async () => {
    vi.mocked(dbSessions.sessionBelongsToProject).mockReturnValue(false)
    const respond = vi.fn()
    const service = new AgentService()

    await service.handleRemoteCommand({
      type: 'load_session_messages',
      requestId: 'r9',
      projectPath: '/project',
      sessionId: 'session-X',
    }, respond)

    expect(respond).toHaveBeenCalledWith('r9', {
      error: 'Session session-X does not belong to project /project',
    })
  })

  it('add_project calls addRecentFolder and openFolder', async () => {
    const { addRecentFolder } = await import('../recent-folders')
    const respond = vi.fn()
    const service = new AgentService()
    await service.handleRemoteCommand({ type: 'add_project', requestId: 'r8', path: '/projects/new' }, respond)
    expect(addRecentFolder).toHaveBeenCalledWith('/projects/new')
    expect(respond).toHaveBeenCalledWith('r8', { success: true })
  })
})
