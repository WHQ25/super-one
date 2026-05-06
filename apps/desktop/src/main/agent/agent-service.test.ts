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
  readScopedAdditionalDirs: vi.fn(() => ({ user: [], projectShared: [], projectLocal: [] })),
  readProjectAdditionalDirs: vi.fn(() => []),
  addProjectAdditionalDir: vi.fn(),
  removeProjectAdditionalDir: vi.fn(),
}))

vi.mock('./fuzzy-file-search', () => ({
  searchFiles: vi.fn(),
  searchMentions: vi.fn(),
  EXCLUDED_DIRS: new Set<string>(),
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
  listSkills: vi.fn(() => []),
  readSkillContent: vi.fn(),
  readSkillFile: vi.fn(),
  installSkill: vi.fn(),
  deleteSkill: vi.fn(),
  listCodexSkills: vi.fn(() => []),
  readCodexSkillContent: vi.fn(),
  readCodexSkillFile: vi.fn(),
  deleteCodexSkill: vi.fn(),
}))

vi.mock('../codex-config-service', () => ({
  listCodexMcpConfigs: vi.fn(),
}))

vi.mock('./discover-resources', () => ({
  discoverAllAgents: vi.fn(() => []),
  discoverProjectCommands: vi.fn(() => []),
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
  getCachedHarnessResources: vi.fn(() => null),
  getActiveProviderRaw: vi.fn(() => null),
  getDb: vi.fn(),
}))

vi.mock('./claude-models', () => ({
  fetchModels: vi.fn(async () => []),
}))

vi.mock('../app-settings-service', () => ({
  readAppSettings: vi.fn(() => ({
    analyticsEnabled: true,
    locale: '',
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultModel: '', defaultReasoningEffort: '' },
    },
  })),
}))

vi.mock('../../shared/provider-utils', () => ({
  buildRemoteActiveProvider: vi.fn(() => null),
  resolveProviderKey: vi.fn(() => null),
  PRESET_PROVIDER_KEY: {},
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

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) }
})

vi.mock('../remote-control-service', () => ({}))

vi.mock('../mcp/superone-mcp-server', () => ({
  clearAllPendingCalls: vi.fn(),
}))

vi.mock('./resolve-cli', () => ({
  fixPath: vi.fn(),
  dedupePath: vi.fn((p: string) => p),
  getNodeRuntime: vi.fn(() => ({})),
}))

const { AgentService } = await import('./agent-service')
const { SessionClaimConflictError } = await import('../session/types')
const { AgentIpcChannels } = await import('@superone/shared/agent-types')
const { ipcMain } = await import('electron')
const dbSessions = await import('../db-sessions')
const appSettings = await import('../app-settings-service')
const claudeModels = await import('./claude-models')
type MockSessionExtras = {
  owner: { kind: 'local' } | { kind: 'remote'; deviceId: string }
  subscribers: Set<string>
  claim: (o: { kind: 'local' } | { kind: 'remote'; deviceId: string }) => void
  release: (deviceId: string) => void
  subscribe: (deviceId: string) => void
  unsubscribe: (deviceId: string) => void
  onLifecycle: (handler: (event: unknown) => void) => () => void
}
function makeMockSession<T extends Record<string, unknown>>(props: T): T & MockSessionExtras {
  const subscribers = new Set<string>()
  const lifecycleListeners = new Set<(event: unknown) => void>()
  const s = {
    getReplayEvents: () => [] as unknown[],
    ...props,
    owner: { kind: 'local' as const },
    subscribers,
    claim(o: { kind: 'local' } | { kind: 'remote'; deviceId: string }) {
      const cur = (s as { owner: { kind: 'local' } | { kind: 'remote'; deviceId: string } }).owner
      if (o.kind === 'remote') {
        if (cur.kind === 'remote' && cur.deviceId !== o.deviceId) {
          throw new SessionClaimConflictError(String((s as { id: unknown }).id), cur.deviceId, o.deviceId)
        }
        for (const sub of subscribers) {
          if (sub !== o.deviceId) {
            throw new SessionClaimConflictError(String((s as { id: unknown }).id), sub, o.deviceId)
          }
        }
      }
      (s as { owner: unknown }).owner = o
    },
    release(deviceId: string) {
      const o = (s as { owner: { kind: 'local' } | { kind: 'remote'; deviceId: string } }).owner
      if (o.kind === 'remote' && o.deviceId === deviceId) (s as { owner: unknown }).owner = { kind: 'local' }
    },
    subscribe(deviceId: string) {
      if (subscribers.has(deviceId)) return
      const cur = (s as { owner: { kind: 'local' } | { kind: 'remote'; deviceId: string } }).owner
      if (cur.kind === 'remote' && cur.deviceId !== deviceId) {
        throw new SessionClaimConflictError(String((s as { id: unknown }).id), cur.deviceId, deviceId)
      }
      for (const sub of subscribers) {
        if (sub !== deviceId) {
          throw new SessionClaimConflictError(String((s as { id: unknown }).id), sub, deviceId)
        }
      }
      subscribers.add(deviceId)
    },
    unsubscribe(deviceId: string) { subscribers.delete(deviceId) },
    onLifecycle(handler: (event: unknown) => void) {
      lifecycleListeners.add(handler)
      return () => { lifecycleListeners.delete(handler) }
    },
  } as T & MockSessionExtras
  return s
}

beforeEach(() => {
  createdAgents.length = 0
  vi.clearAllMocks()
  vi.mocked(dbSessions.sessionBelongsToProject).mockReturnValue(true)
})

function getRegisteredIpcHandler(channel: string) {
  const handleMock = ipcMain.handle as unknown as ReturnType<typeof vi.fn>
  const call = handleMock.mock.calls.find(([registered]) => registered === channel)
  return call?.[1] as ((event: unknown, ...args: unknown[]) => unknown) | undefined
}

describe('AgentService prewarm', () => {
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

  it('remote lock follows mobile subscribed state — releases when mobile unsubscribes without disconnecting', async () => {
    const service = new AgentService()
    const activeSession = makeMockSession({ id: 'sid-1', projectPath: '/p' })
    const sessions = [activeSession]
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => activeSession),
      getSession: vi.fn(() => activeSession),
      forEachSession: (fn: (s: unknown) => void) => sessions.forEach(fn),
    }
    service.setDeviceRegistry({
      handleDeviceDisconnected: vi.fn(),
      unsubscribeAll: (deviceId: string) => sessions.forEach((s) => (s as { unsubscribe: (d: string) => void }).unsubscribe(deviceId)),
      releaseAll: vi.fn(),
    } as never)

    const isLocked = () => (service as unknown as { isRemoteLockedSession: (p: string) => boolean }).isRemoteLockedSession('/p')

    expect(isLocked()).toBe(false)

    await service.handleRemoteCommand({ type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-1' } as never)
    expect(isLocked()).toBe(true)

    await service.handleRemoteCommand({ type: 'unsubscribe_session', projectPath: '/p', sessionId: 'sid-1' } as never)
    expect(isLocked()).toBe(false)
  })

  it('unsubscribe_session with sessionId only releases that session, not other subscribed sessions on the same device', async () => {
    const service = new AgentService()
    const sessionA = makeMockSession({ id: 'sid-A', projectPath: '/p' })
    const sessionB = makeMockSession({ id: 'sid-B', projectPath: '/p' })
    const sessions = [sessionA, sessionB]
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => sessionA),
      getSession: vi.fn((id: string) => sessions.find((s) => s.id === id)),
      forEachSession: (fn: (s: unknown) => void) => sessions.forEach(fn),
    }
    sessionA.subscribe('device-1')
    sessionB.subscribe('device-1')
    expect(sessionA.subscribers.has('device-1')).toBe(true)
    expect(sessionB.subscribers.has('device-1')).toBe(true)

    await service.handleRemoteCommand(
      { type: 'unsubscribe_session', sessionId: 'sid-A' } as never,
      undefined,
      { deviceId: 'device-1', transport: 'lan' },
    )

    expect(sessionA.subscribers.has('device-1')).toBe(false)
    expect(sessionB.subscribers.has('device-1')).toBe(true)
  })

  it('unsubscribe_session without sessionId releases all subscriptions for that device', async () => {
    const service = new AgentService()
    const sessionA = makeMockSession({ id: 'sid-A', projectPath: '/p' })
    const sessionB = makeMockSession({ id: 'sid-B', projectPath: '/p' })
    const sessions = [sessionA, sessionB]
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => sessionA),
      getSession: vi.fn((id: string) => sessions.find((s) => s.id === id)),
      forEachSession: (fn: (s: unknown) => void) => sessions.forEach(fn),
    }
    service.setDeviceRegistry({
      handleDeviceDisconnected: vi.fn(),
      unsubscribeAll: (deviceId: string) => sessions.forEach((s) => (s as { unsubscribe: (d: string) => void }).unsubscribe(deviceId)),
      releaseAll: vi.fn(),
    } as never)
    sessionA.subscribe('device-1')
    sessionB.subscribe('device-1')

    await service.handleRemoteCommand(
      { type: 'unsubscribe_session' } as never,
      undefined,
      { deviceId: 'device-1', transport: 'lan' },
    )

    expect(sessionA.subscribers.has('device-1')).toBe(false)
    expect(sessionB.subscribers.has('device-1')).toBe(false)
  })

  it('after claude remote turn, mobile leave_session releases ownership and desktop is no longer locked', async () => {
    const service = new AgentService()
    const send = vi.fn().mockResolvedValue(undefined)
    const activeSession = makeMockSession({ id: 'sid-1', projectPath: '/p', send, snapshot: { harnessId: 'claude' } })
    const sessions = [activeSession]
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => activeSession),
      getSession: vi.fn(() => activeSession),
      forEachSession: (fn: (s: unknown) => void) => sessions.forEach(fn),
    }
    ;(service as unknown as { broadcastEventToRenderer: (event: unknown) => void }).broadcastEventToRenderer = () => {}
    service.setDeviceRegistry({
      handleDeviceDisconnected: vi.fn(),
      unsubscribeAll: (deviceId: string) => sessions.forEach((s) => (s as { unsubscribe: (d: string) => void }).unsubscribe(deviceId)),
      releaseAll: vi.fn(),
    } as never)

    await service.handleRemoteCommand({
      type: 'send_message',
      content: 'hello',
      projectPath: '/p',
      sessionId: 'sid-1',
    } as never, undefined, { deviceId: 'mobile-A', transport: 'lan' })

    expect((service as unknown as { isRemoteLockedSession: (p: string) => boolean }).isRemoteLockedSession('/p')).toBe(true)

    await service.handleRemoteCommand(
      { type: 'leave_session', sessionId: 'sid-1' } as never,
      undefined,
      { deviceId: 'mobile-A', transport: 'lan' },
    )

    expect(activeSession.owner.kind).toBe('local')
    expect((service as unknown as { isRemoteLockedSession: (p: string) => boolean }).isRemoteLockedSession('/p')).toBe(false)
  })

  it('remote lock covers active remote-owned sessions without subscription', async () => {
    const service = new AgentService()
    const activeSession = makeMockSession({ id: 'sid-1', projectPath: '/p' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => activeSession),
      forEachSession: vi.fn(),
    }
    activeSession.claim({ kind: 'remote', deviceId: 'mobile' })

    const isLocked = () => (service as unknown as { isRemoteLockedSession: (p: string) => boolean }).isRemoteLockedSession('/p')

    expect(isLocked()).toBe(true)
  })

  it('send_message claims ownership and holds it past the send for claude remote-owned sessions', async () => {
    const service = new AgentService()
    const send = vi.fn().mockResolvedValue(undefined)
    const ownerSequence: string[] = []
    const activeSession = makeMockSession({ id: 'sid-1', projectPath: '/p', send })
    const realClaim = activeSession.claim
    const realRelease = activeSession.release
    activeSession.claim = (o) => { realClaim(o); ownerSequence.push(activeSession.owner.kind) }
    activeSession.release = (d) => { realRelease(d); ownerSequence.push(activeSession.owner.kind) }
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => activeSession),
      getSession: vi.fn(() => activeSession),
      forEachSession: vi.fn(),
    }

    await service.handleRemoteCommand({
      type: 'send_message',
      content: 'hello',
      projectPath: '/p',
      sessionId: 'sid-1',
    } as never)

    expect(activeSession.owner.kind).toBe('remote')
    expect(ownerSequence).toEqual(['remote'])
    expect(send).toHaveBeenCalledWith({
      content: 'hello',
      model: undefined,
      effort: undefined,
      images: undefined,
      priority: undefined,
      clientMessageId: undefined,
    }, { providerOrigin: 'remote' })
  })

  it('codex remote turn claims ownership and holds it past the turn', async () => {
    const service = new AgentService()
    const send = vi.fn().mockResolvedValue(undefined)
    const ownerSequence: string[] = []
    const activeSession = makeMockSession({ id: 'sid-1', projectPath: '/p', snapshot: { harnessId: 'codex' }, send })
    const realClaim = activeSession.claim
    const realRelease = activeSession.release
    activeSession.claim = (o) => { realClaim(o); ownerSequence.push(activeSession.owner.kind) }
    activeSession.release = (d) => { realRelease(d); ownerSequence.push(activeSession.owner.kind) }
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => activeSession),
      getSession: vi.fn(() => activeSession),
      forEachSession: vi.fn(),
    }
    service.setRemoteControlService({
      sendAgentEvent: vi.fn(),
    } as never)

    await service.handleRemoteCommand({
      type: 'send_message',
      content: 'hello',
      projectPath: '/p',
      sessionId: 'sid-1',
      provider: 'codex',
    } as never)

    expect(activeSession.owner.kind).toBe('remote')
    expect((service as unknown as { isRemoteLockedSession: (p: string) => boolean }).isRemoteLockedSession('/p')).toBe(true)
    expect(ownerSequence).toEqual(['remote'])
  })

  it('send_message rejects a second mobile and notifies it with session_locked_by_other_device', async () => {
    const service = new AgentService()
    const send = vi.fn().mockResolvedValue(undefined)
    const activeSession = makeMockSession({ id: 'sid-1', projectPath: '/p', send })
    activeSession.claim({ kind: 'remote', deviceId: 'mobile-A' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => activeSession),
      getSession: vi.fn(() => activeSession),
      forEachSession: vi.fn(),
    }
    const sendEventToMobile = vi.fn().mockResolvedValue(undefined)
    service.setRemoteControlService({ sendEventToMobile, sendAgentEvent: vi.fn() } as never)

    await service.handleRemoteCommand({
      type: 'send_message',
      content: 'hi',
      projectPath: '/p',
      sessionId: 'sid-1',
    } as never, undefined, { deviceId: 'mobile-B', transport: 'lan' })

    expect(send).not.toHaveBeenCalled()
    expect(activeSession.owner).toEqual({ kind: 'remote', deviceId: 'mobile-A' })
    expect(sendEventToMobile).toHaveBeenCalledWith(
      { type: 'session_locked_by_other_device', sessionId: 'sid-1', ownerDeviceId: 'mobile-A' },
      ['mobile-B'],
    )
    expect(SessionClaimConflictError).toBeDefined()
  })

  it('subscribe_session (legacy fire-and-forget) notifies via session_locked_by_other_device on conflict', async () => {
    const service = new AgentService()
    const session = makeMockSession({ id: 'sid-1', projectPath: '/p' })
    session.claim({ kind: 'remote', deviceId: 'mobile-A' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => session),
      getSession: vi.fn(() => session),
      forEachSession: vi.fn(),
    }
    const sendEventToMobile = vi.fn().mockResolvedValue(undefined)
    service.setRemoteControlService({ sendEventToMobile, sendAgentEvent: vi.fn() } as never)

    await service.handleRemoteCommand(
      { type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-1' } as never,
      undefined,
      { deviceId: 'mobile-B', transport: 'lan' },
    )

    expect(session.subscribers.has('mobile-B')).toBe(false)
    expect(sendEventToMobile).toHaveBeenCalledWith(
      { type: 'session_locked_by_other_device', sessionId: 'sid-1', ownerDeviceId: 'mobile-A' },
      ['mobile-B'],
    )
  })

  it('subscribe_session (with requestId) responds with session_locked error synchronously', async () => {
    const service = new AgentService()
    const session = makeMockSession({ id: 'sid-1', projectPath: '/p' })
    session.claim({ kind: 'remote', deviceId: 'mobile-A' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => session),
      getSession: vi.fn(() => session),
      forEachSession: vi.fn(),
    }
    const sendEventToMobile = vi.fn().mockResolvedValue(undefined)
    service.setRemoteControlService({ sendEventToMobile, sendAgentEvent: vi.fn() } as never)
    const respond = vi.fn().mockResolvedValue(undefined)

    await service.handleRemoteCommand(
      { type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-1', requestId: 'req-1' } as never,
      respond,
      { deviceId: 'mobile-B', transport: 'lan' },
    )

    expect(respond).toHaveBeenCalledWith('req-1', { error: 'session_locked', ownerDeviceId: 'mobile-A' })
    expect(sendEventToMobile).not.toHaveBeenCalled()
    expect(session.subscribers.has('mobile-B')).toBe(false)
  })

  it('subscribe_session (with requestId) responds ok on success', async () => {
    const service = new AgentService()
    const session = makeMockSession({ id: 'sid-1', projectPath: '/p' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => session),
      getSession: vi.fn(() => session),
      forEachSession: vi.fn(),
    }
    const respond = vi.fn().mockResolvedValue(undefined)

    await service.handleRemoteCommand(
      { type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-1', requestId: 'req-2' } as never,
      respond,
      { deviceId: 'mobile-A', transport: 'lan' },
    )

    expect(respond).toHaveBeenCalledWith('req-2', { ok: true })
    expect(session.subscribers.has('mobile-A')).toBe(true)
  })

  it('subscribe_session releases the device from any other session it was on', async () => {
    const service = new AgentService()
    const sessionA = makeMockSession({ id: 'sid-A', projectPath: '/p' })
    const sessionB = makeMockSession({ id: 'sid-B', projectPath: '/p' })
    sessionA.subscribe('mobile-1')
    const sessions = [sessionA, sessionB]
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => null),
      getSession: vi.fn((id: string) => sessions.find((s) => s.id === id) ?? null),
      forEachSession: (fn: (s: unknown) => void) => sessions.forEach(fn),
    }
    const respond = vi.fn().mockResolvedValue(undefined)

    await service.handleRemoteCommand(
      { type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-B', requestId: 'req-X' } as never,
      respond,
      { deviceId: 'mobile-1', transport: 'lan' },
    )

    expect(respond).toHaveBeenCalledWith('req-X', { ok: true })
    expect(sessionB.subscribers.has('mobile-1')).toBe(true)
    expect(sessionA.subscribers.has('mobile-1')).toBe(false)
  })

  it('subscribe_session does NOT release device from the new session itself', async () => {
    const service = new AgentService()
    const session = makeMockSession({ id: 'sid-A', projectPath: '/p' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => null),
      getSession: vi.fn(() => session),
      forEachSession: (fn: (s: unknown) => void) => [session].forEach(fn),
    }
    const respond = vi.fn().mockResolvedValue(undefined)

    await service.handleRemoteCommand(
      { type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-A', requestId: 'req-Y' } as never,
      respond,
      { deviceId: 'mobile-1', transport: 'lan' },
    )

    expect(respond).toHaveBeenCalledWith('req-Y', { ok: true })
    expect(session.subscribers.has('mobile-1')).toBe(true)
  })

  it('subscribe_session releases ownership held by the device on a different session', async () => {
    const service = new AgentService()
    const sessionA = makeMockSession({ id: 'sid-A', projectPath: '/p' })
    const sessionB = makeMockSession({ id: 'sid-B', projectPath: '/p' })
    sessionA.claim({ kind: 'remote', deviceId: 'mobile-1' })
    const sessions = [sessionA, sessionB]
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => null),
      getSession: vi.fn((id: string) => sessions.find((s) => s.id === id) ?? null),
      forEachSession: (fn: (s: unknown) => void) => sessions.forEach(fn),
    }
    const respond = vi.fn().mockResolvedValue(undefined)

    await service.handleRemoteCommand(
      { type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-B', requestId: 'req-Z' } as never,
      respond,
      { deviceId: 'mobile-1', transport: 'lan' },
    )

    expect(respond).toHaveBeenCalledWith('req-Z', { ok: true })
    expect(sessionA.owner.kind).toBe('local')
    expect(sessionB.subscribers.has('mobile-1')).toBe(true)
  })

  it('subscribe_session resumes a cold session that is not active in memory', async () => {
    const service = new AgentService()
    const resumed = makeMockSession({ id: 'sid-1', projectPath: '/p' })
    const resumeSession = vi.fn(() => resumed)
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => null),
      getSession: vi.fn(() => null),
      resumeSession,
      forEachSession: vi.fn(),
    }
    const respond = vi.fn().mockResolvedValue(undefined)

    await service.handleRemoteCommand(
      { type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-1', requestId: 'req-3' } as never,
      respond,
      { deviceId: 'mobile-A', transport: 'lan' },
    )

    expect(resumeSession).toHaveBeenCalledWith('sid-1', { passive: true })
    expect(respond).toHaveBeenCalledWith('req-3', { ok: true })
    expect(resumed.subscribers.has('mobile-A')).toBe(true)
  })

  it('subscribe_session replays cached init events to the new subscriber so first-time mobile sees session metadata', async () => {
    const service = new AgentService()
    const initReady = { type: 'init_ready', sessionId: 'sid-1', projectPath: '/p', cwd: '/p' }
    const worktreeMissing = { type: 'worktree_missing', sessionId: 'sid-1', projectPath: '/p', worktreePath: '/wt', fallbackCwd: '/p' }
    const session = makeMockSession({
      id: 'sid-1',
      projectPath: '/p',
      getReplayEvents: vi.fn(() => [initReady, worktreeMissing]),
    })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => session),
      getSession: vi.fn(() => session),
      forEachSession: vi.fn(),
    }
    const sendAgentEvent = vi.fn().mockResolvedValue(undefined)
    service.setRemoteControlService({ sendEventToMobile: vi.fn(), sendAgentEvent } as never)
    const respond = vi.fn().mockResolvedValue(undefined)

    await service.handleRemoteCommand(
      { type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-1', requestId: 'req-replay-1' } as never,
      respond,
      { deviceId: 'mobile-A', transport: 'lan' },
    )

    expect(respond).toHaveBeenCalledWith('req-replay-1', { ok: true })
    expect(session.subscribers.has('mobile-A')).toBe(true)
    expect(sendAgentEvent).toHaveBeenCalledWith(initReady, ['mobile-A'])
    expect(sendAgentEvent).toHaveBeenCalledWith(worktreeMissing, ['mobile-A'])
  })

  it('subscribe_session on a cold session replays init_ready that was cached during resume', async () => {
    const service = new AgentService()
    const initReady = { type: 'init_ready', sessionId: 'sid-1', projectPath: '/p', cwd: '/p' }
    const resumed = makeMockSession({
      id: 'sid-1',
      projectPath: '/p',
      getReplayEvents: vi.fn(() => [initReady]),
    })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => null),
      getSession: vi.fn(() => null),
      resumeSession: vi.fn(() => resumed),
      forEachSession: vi.fn(),
    }
    const sendAgentEvent = vi.fn().mockResolvedValue(undefined)
    service.setRemoteControlService({ sendEventToMobile: vi.fn(), sendAgentEvent } as never)
    const respond = vi.fn().mockResolvedValue(undefined)

    await service.handleRemoteCommand(
      { type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-1', requestId: 'req-replay-cold' } as never,
      respond,
      { deviceId: 'mobile-A', transport: 'lan' },
    )

    expect(respond).toHaveBeenCalledWith('req-replay-cold', { ok: true })
    expect(sendAgentEvent).toHaveBeenCalledWith(initReady, ['mobile-A'])
  })

  it('subscribe_session does not call sendAgentEvent when there are no cached events to replay', async () => {
    const service = new AgentService()
    const session = makeMockSession({
      id: 'sid-1',
      projectPath: '/p',
      getReplayEvents: vi.fn(() => []),
    })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => session),
      getSession: vi.fn(() => session),
      forEachSession: vi.fn(),
    }
    const sendAgentEvent = vi.fn().mockResolvedValue(undefined)
    service.setRemoteControlService({ sendEventToMobile: vi.fn(), sendAgentEvent } as never)
    const respond = vi.fn().mockResolvedValue(undefined)

    await service.handleRemoteCommand(
      { type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-1', requestId: 'req-replay-empty' } as never,
      respond,
      { deviceId: 'mobile-A', transport: 'lan' },
    )

    expect(respond).toHaveBeenCalledWith('req-replay-empty', { ok: true })
    expect(sendAgentEvent).not.toHaveBeenCalled()
  })

  it('subscribe_session does not replay cached events when the subscribe call is rejected with session_locked', async () => {
    const service = new AgentService()
    const session = makeMockSession({
      id: 'sid-1',
      projectPath: '/p',
      getReplayEvents: vi.fn(() => [{ type: 'init_ready', sessionId: 'sid-1' }]),
    })
    session.claim({ kind: 'remote', deviceId: 'mobile-A' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => session),
      getSession: vi.fn(() => session),
      forEachSession: vi.fn(),
    }
    const sendAgentEvent = vi.fn().mockResolvedValue(undefined)
    service.setRemoteControlService({ sendEventToMobile: vi.fn(), sendAgentEvent } as never)
    const respond = vi.fn().mockResolvedValue(undefined)

    await service.handleRemoteCommand(
      { type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-1', requestId: 'req-locked' } as never,
      respond,
      { deviceId: 'mobile-B', transport: 'lan' },
    )

    expect(respond).toHaveBeenCalledWith('req-locked', { error: 'session_locked', ownerDeviceId: 'mobile-A' })
    expect(sendAgentEvent).not.toHaveBeenCalled()
  })

  it('subscribe_session responds with session_not_found when resume fails', async () => {
    const service = new AgentService()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => null),
      getSession: vi.fn(() => null),
      resumeSession: vi.fn(() => { throw new Error('not in DB') }),
      forEachSession: vi.fn(),
    }
    const respond = vi.fn().mockResolvedValue(undefined)

    await service.handleRemoteCommand(
      { type: 'subscribe_session', projectPath: '/p', sessionId: 'sid-ghost', requestId: 'req-4' } as never,
      respond,
      { deviceId: 'mobile-A', transport: 'lan' },
    )

    expect(respond).toHaveBeenCalledWith('req-4', { error: 'session_not_found' })
  })

  it('remote interrupt command does not unsubscribe mobile subscribers', async () => {
    const service = new AgentService()
    const interrupt = vi.fn().mockResolvedValue(undefined)
    const session = makeMockSession({ id: 'sid-1', projectPath: '/p', interrupt })
    session.subscribe('mobile-A')
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => session),
      getSession: vi.fn(() => session),
      forEachSession: (fn: (s: unknown) => void) => [session].forEach(fn),
    }
    vi.mocked(dbSessions.sessionBelongsToProject).mockReturnValue(true)
    ;(service as unknown as { findSessionBySid: (p: string, s: string) => unknown }).findSessionBySid = () => session

    await service.handleRemoteCommand(
      { type: 'interrupt', projectPath: '/p', sessionId: 'sid-1' } as never,
      undefined,
      { deviceId: 'mobile-A', transport: 'lan' },
    )

    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(session.subscribers.has('mobile-A')).toBe(true)
  })

  it('leave_session releases ownership held by that device', async () => {
    const service = new AgentService()
    const session = makeMockSession({ id: 'sid-1', projectPath: '/p' })
    session.claim({ kind: 'remote', deviceId: 'mobile-A' })
    session.subscribe('mobile-A')
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => session),
      getSession: vi.fn(() => session),
      forEachSession: vi.fn(),
    }

    await service.handleRemoteCommand(
      { type: 'leave_session', sessionId: 'sid-1' } as never,
      undefined,
      { deviceId: 'mobile-A', transport: 'lan' },
    )

    expect(session.owner.kind).toBe('local')
    expect(session.subscribers.size).toBe(0)
  })

  it('leave_session is a no-op for a different device', async () => {
    const service = new AgentService()
    const session = makeMockSession({ id: 'sid-1', projectPath: '/p' })
    session.claim({ kind: 'remote', deviceId: 'mobile-A' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => session),
      getSession: vi.fn(() => session),
      forEachSession: vi.fn(),
    }

    await service.handleRemoteCommand(
      { type: 'leave_session', sessionId: 'sid-1' } as never,
      undefined,
      { deviceId: 'mobile-B', transport: 'lan' },
    )

    expect(session.owner).toEqual({ kind: 'remote', deviceId: 'mobile-A' })
  })

  it('respond_permission falls back to subscribed session when projectPath is missing', async () => {
    const respondToPermission = vi.fn(() => true)
    const activeSession = makeMockSession({ id: 'sid-1', projectPath: '/p', respondToPermission })
    const broadcasts: unknown[] = []

    const service = new AgentService()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => activeSession),
      getSession: vi.fn(() => activeSession),
    }
    ;(service as unknown as { broadcastEventToRenderer: (e: unknown) => void }).broadcastEventToRenderer = (e) => { broadcasts.push(e) }

    const fakeRemote = {
      getSubscribedSession: () => ({ projectPath: '/p', sessionId: 'sid-1' }),
      setRemoteSessionFilter: vi.fn(),
      clearRemoteSessionFilter: vi.fn(),
    }
    service.setRemoteControlService(fakeRemote as never)

    await service.handleRemoteCommand({ type: 'respond_permission', requestId: 'req-1', decision: true, sessionId: 'sid-1' } as never)

    expect(respondToPermission).toHaveBeenCalledWith('req-1', true, undefined, undefined, undefined)
    expect(broadcasts).toContainEqual({
      type: 'interaction_resolved', interactionType: 'permission', requestId: 'req-1', projectPath: '/p', sessionId: 'sid-1',
    })
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

  it('get_system_info returns user agent defaults for claude', async () => {
    vi.mocked(appSettings.readAppSettings).mockReturnValue({
      analyticsEnabled: true,
      locale: '',
      agentPreference: {
        claude: {
          defaultModel: 'claude-opus-4-7',
          defaultEffort: 'high',
          defaultPermissionMode: 'acceptEdits',
          defaultSandboxMode: '',
        },
        codex: { defaultModel: '', defaultReasoningEffort: '' },
      },
    })
    vi.mocked(claudeModels.fetchModels).mockResolvedValue([
      { id: 'claude-opus-4-7', name: 'Opus 4.7' },
      { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
    ] as never)

    const respond = vi.fn()
    const service = new AgentService()
    await service.handleRemoteCommand(
      { type: 'get_system_info', requestId: 'sys-1', projectPath: '/p', provider: 'claude' } as never,
      respond,
    )

    expect(respond).toHaveBeenCalledTimes(1)
    const [, payload] = respond.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.defaults).toEqual({
      model: 'claude-opus-4-7',
      effort: 'high',
      permissionMode: 'acceptEdits',
    })
    expect(payload.permissionModes).toEqual([
      'default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions', 'dontAsk',
    ])
  })

  it('get_system_info returns null defaults when user has no preferences set', async () => {
    vi.mocked(appSettings.readAppSettings).mockReturnValue({
      analyticsEnabled: true,
      locale: '',
      agentPreference: {
        claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
        codex: { defaultModel: '', defaultReasoningEffort: '' },
      },
    })
    vi.mocked(claudeModels.fetchModels).mockResolvedValue([])

    const respond = vi.fn()
    const service = new AgentService()
    await service.handleRemoteCommand(
      { type: 'get_system_info', requestId: 'sys-2', projectPath: '/p', provider: 'claude' } as never,
      respond,
    )

    const [, payload] = respond.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.defaults).toEqual({ model: null, effort: null, permissionMode: null })
  })

  it('get_system_info returns codex-flavored defaults for codex provider', async () => {
    vi.mocked(appSettings.readAppSettings).mockReturnValue({
      analyticsEnabled: true,
      locale: '',
      agentPreference: {
        claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
        codex: { defaultModel: 'gpt-5-codex', defaultReasoningEffort: 'high' },
      },
    })

    const respond = vi.fn()
    const service = new AgentService()
    ;(service as unknown as { codexListModels: () => Promise<unknown[]> }).codexListModels = async () => []
    await service.handleRemoteCommand(
      { type: 'get_system_info', requestId: 'sys-3', projectPath: '/p', provider: 'codex' } as never,
      respond,
    )

    const [, payload] = respond.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.defaults).toEqual({ model: 'gpt-5-codex', reasoningEffort: 'high' })
    expect(payload.permissionPresets).toEqual(['default', 'full-access'])
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
