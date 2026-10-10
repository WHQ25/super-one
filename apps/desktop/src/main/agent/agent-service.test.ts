import { acquirePhoneControl, controlLeaseAuthority } from '../control-lease.test-fixtures'
import { createPhoneMethods } from '../remote/phone-methods'
import { ADMIN_PAIRING_SCOPES } from '@superone/shared/environment'
import type { RpcContext } from '@superone/runtime/server'
import { terminalLeaseAuthority } from '../terminal/terminal-lease.test-fixtures'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSandboxCapability } from '../sandbox-platform'
import { SessionLease } from '../session/session-lease'
import { enqueueSessionQueueOp } from '../session/session-queue'

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

const dshMcpMocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  toggle: vi.fn(),
  delete: vi.fn(),
}))

const remoteDshMcpMocks = vi.hoisted(() => ({
  host: {} as object,
  list: vi.fn(),
  save: vi.fn(),
  toggle: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('../environment/session-identity', () => ({
  localSessionEnvironmentId: () => 'test-environment',
}))

vi.mock('./fuzzy-file-search', () => ({
  searchFiles: vi.fn(),
  searchMentions: vi.fn(),
  EXCLUDED_DIRS: new Set<string>(),
}))

vi.mock('../db-sessions', () => ({
  listSessionsForFolder: vi.fn(),
  countMessagesForSessions: vi.fn(() => new Map()),
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
  readSessionHarnessId: vi.fn(() => null),
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
  readMcpMetaCache: vi.fn(() => ({})),
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
  readCodexSkillContent: vi.fn(),
  readCodexSkillFile: vi.fn(),
  deleteCodexSkill: vi.fn(),
}))

vi.mock('../codex/codex-skills-rpc-singleton', () => ({
  getSharedCodexSkillsService: () => ({
    list: vi.fn(async () => []),
    setEnabled: vi.fn(async () => {}),
  }),
}))

vi.mock('../codex-config-service', () => ({
  listCodexMcpConfigs: vi.fn(),
}))

const gitRunMock = vi.hoisted(() => vi.fn())
vi.mock('../git-run', () => ({ gitRun: gitRunMock }))

vi.mock('@superone/runtime/fs', () => ({
  listDshMcpConfigs: dshMcpMocks.list,
  saveDshMcpConfig: dshMcpMocks.save,
  toggleDshMcpConfig: dshMcpMocks.toggle,
  deleteDshMcpConfig: dshMcpMocks.delete,
}))

vi.mock('../environment', () => ({
  getEnvironmentHost: () => remoteDshMcpMocks.host,
}))

vi.mock('../environment/remote-resources', () => ({
  listRemoteManagedMcp: remoteDshMcpMocks.list,
  saveRemoteManagedMcp: remoteDshMcpMocks.save,
  toggleRemoteManagedMcp: remoteDshMcpMocks.toggle,
  deleteRemoteManagedMcp: remoteDshMcpMocks.delete,
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
  getGithubStars: vi.fn(),
  listGithubReposForOwner: vi.fn(async () => [
    { owner: 'vercel', name: 'next.js', fullName: 'vercel/next.js', description: null, private: false, stars: 1 },
  ]),
  searchGithubRepositories: vi.fn(async () => [
    { owner: 'expo', name: 'expo', fullName: 'expo/expo', description: null, private: false, stars: 2 },
  ]),
  listMyGithubRepos: vi.fn(async () => ({ repos: [], hasMore: false, unavailable: true })),
}))

vi.mock('../mcp-library-service', () => ({
  backupMcpServers: vi.fn(),
  listLibrary: vi.fn(),
  deleteLibraryEntry: vi.fn(),
}))

vi.mock('../mcp-server-icons', () => ({
  collectMcpServerIconMap: vi.fn(async () => ({ github: 'https://example.com/g.png' })),
  probeMcpIconsForAllHarnesses: vi.fn(async () => undefined),
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

vi.mock('../session/collaboration-mailbox', () => ({ spawnParentOf: () => null }))

const mcpMentionMocks = vi.hoisted(() => ({
  readMcpMentions: vi.fn(async (): Promise<unknown[]> => []),
  searchMcpMentions: vi.fn(async () => ({ sources: [] })),
}))
vi.mock('../mcp-apps/mention-search-ipc', () => mcpMentionMocks)

const realtimeTimelineRepoMocks = vi.hoisted(() => ({
  loadRealtimeTimeline: vi.fn(),
  reconcileRealtimeTimeline: vi.fn((_sessionId: string, timeline: unknown) => timeline),
}))
vi.mock('../session/realtime-timeline-repo', () => realtimeTimelineRepoMocks)

const forkSessionMock = vi.fn()
vi.mock('../session/session-fork', () => ({ forkSession: forkSessionMock }))

const draftStoreMock = { assertControl: vi.fn(), get: vi.fn() }
vi.mock('../db-drafts', () => ({ localDraftStore: () => draftStoreMock }))

vi.mock('../providers/resolver', () => ({
  resolveChatService: vi.fn(() => null),
  buildRemoteActiveService: vi.fn(() => null),
  buildClaudeEnv: vi.fn(() => ({})),
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
      codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '', realtimeVoice: '' },
      acp: { enabled: false, brandHue: null, tokenOverrides: {}, selectedAgentId: null },
    },
  })),
}))

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const updateProjectMock = vi.hoisted(() => vi.fn())
vi.mock('../recent-folders', () => ({
  getRecentFolders: vi.fn(() => [
    { path: '/projects/app-one', name: 'app-one', added_at: '2025-01-01' },
    { path: '/projects/app-two', name: 'app-two', added_at: '2025-01-02' },
  ]),
  addRecentFolder: vi.fn(),
  removeRecentFolder: vi.fn(),
  getProjectExtraDirs: vi.fn(() => []),
  updateProject: updateProjectMock,
}))

const mockReaddir = vi.fn()
const mockMkdir = vi.fn()
vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}))

const { mockExistsSync } = vi.hoisted(() => ({ mockExistsSync: vi.fn() }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  mockExistsSync.mockImplementation(actual.existsSync)
  return { ...actual, existsSync: (...args: unknown[]) => mockExistsSync(...args) }
})

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) }
})

vi.mock('../remote-control-service', () => ({
  stripMessagesForRemote: (messages: unknown[]) => messages,
  stripEventForRemote: (event: unknown) => event,
}))

vi.mock('../mcp/superone-mcp-server', () => ({
  clearProjectPendingCalls: vi.fn(),
}))

vi.mock('./resolve-cli', () => ({
  dedupePath: vi.fn((p: string) => p),
  getNodeRuntime: vi.fn(() => ({})),
}))

const { AgentService } = await import('./agent-service')
const { AgentIpcChannels } = await import('@superone/shared/agent-types')
const { ipcMain } = await import('electron')
const dbSessions = await import('../db-sessions')
const appSettings = await import('../app-settings-service')
const claudeModels = await import('./claude-models')
const database = await import('../database')
const { BASE_SESSION_PROVIDERS } = await import('@superone/shared/session-provider-definitions')
const { HARNESS_LAUNCH_OPTIONS } = await import('@superone/shared/launch-options')
type MockSessionExtras = { lease: SessionLease; onLifecycle: SessionLease['onLifecycle'] }
function makeMockSession<T extends Record<string, unknown>>(props: T): T & MockSessionExtras {
  const lease = new SessionLease(String(props.id ?? 'test-session'), controlLeaseAuthority())
  return { lease, onLifecycle: lease.onLifecycle.bind(lease), getReplayEvents: () => [] as unknown[],
    setAcpAgentId: vi.fn(), setApiProviderId: vi.fn(), ...props } as T & MockSessionExtras
}

beforeEach(() => {
  createdAgents.length = 0
  vi.clearAllMocks()
  vi.mocked(dbSessions.sessionBelongsToProject).mockReturnValue(true)
})

function getRegisteredIpcHandler(channel: string) {
  const handleMock = ipcMain.handle as unknown as ReturnType<typeof vi.fn>
  const call = handleMock.mock.calls.find(([registered]) => registered === channel)
  const handler = call?.[1] as ((event: unknown, ...args: unknown[]) => unknown) | undefined
  return handler ? (event: unknown, ...args: unknown[]) => handler({ ...(event as object ?? {}), sender: (event as { sender?: unknown } | null)?.sender ?? { id: 99 } }, ...args) : undefined
}

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

describe('AgentService SESSIONS_RESUME (cwd sync)', () => {
  it('surfaces cold resume failures to the renderer', async () => {
    const service = new AgentService()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => null),
      resumeSession: vi.fn(() => { throw new Error('Session not found: missing') }),
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.SESSIONS_RESUME)!

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
    const handler = getRegisteredIpcHandler(AgentIpcChannels.SESSIONS_RESUME)!
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
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.SESSIONS_RESUME)!
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
    const handler = getRegisteredIpcHandler(AgentIpcChannels.SESSIONS_RESUME)!

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

  it('a send hint goes to the session as a selection', async () => {
    const { service, switchCwd, applyWorktreeSelection } = conversationIn(WT)
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.SEND_MESSAGE)!

    await handler(null, '/repo/main', { content: 'hi', sessionId: 'sid-conv', worktreePath: '/repo/main/.worktrees/other' })

    expect(applyWorktreeSelection).toHaveBeenCalledWith('/repo/main/.worktrees/other', undefined)
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

  it('reconciles a provider timeline into the local snapshot', async () => {
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
  })

  /**
   * A live voice session keeps writing (transcript, generated title), and that write
   * path is an upsert — deleting only the row lets the next write INSERT it straight
   * back. The runtime has to be torn down first, and in that order.
   */
  it('tears down a live session before deleting its row so it cannot be resurrected', async () => {
    const service = new AgentService()
    const order: string[] = []
    const disposeSession = vi.fn(async () => { order.push('dispose') })
    const dbSessions = await import('../db-sessions')
    vi.mocked(dbSessions.deleteSession).mockImplementation(() => { order.push('delete') })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => makeMockSession({ id: 'sid-voice' })),
      disposeSession,
    }
    service.setup()

    const handler = getRegisteredIpcHandler(AgentIpcChannels.SESSIONS_DELETE)!
    await handler(null, 'sid-voice')

    expect(disposeSession).toHaveBeenCalledWith('sid-voice')
    expect(order).toEqual(['dispose', 'delete'])
  })

  it('creates a Codex session from the renderer draft before starting voice', async () => {
    const service = new AgentService()
    const startRealtimeVoice = vi.fn().mockResolvedValue(undefined)
    const created = makeMockSession({
      id: 'draft-voice',
      cwd: '/repo/main',
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
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.START_REALTIME_VOICE)!
    const request = { sdp: 'offer' }
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
      await handler(null, '/repo/main', 'draft-voice', request)

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

describe('AgentService SEND_MESSAGE', () => {
  it('refuses a remote project key instead of resuming or creating a local session', async () => {
    const service = new AgentService()
    const sessionManager = {
      getSession: vi.fn(() => null),
      getActiveSession: vi.fn(() => null),
      resumeSession: vi.fn(),
      createSession: vi.fn(),
    }
    ;(service as { sessionManager: unknown }).sessionManager = sessionManager
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.SEND_MESSAGE)!

    await expect(handler(null, 'remote:env-1:/work/app', { content: 'hi', clientMessageId: 'u1', sessionId: 'node-sid' }))
      .rejects.toThrow(/remote project/)
    expect(sessionManager.resumeSession).not.toHaveBeenCalled()
    expect(sessionManager.createSession).not.toHaveBeenCalled()
  })

  it('creates a Claude session with the renderer draft id before the first send', async () => {
    const service = new AgentService()
    const send = vi.fn().mockResolvedValue(undefined)
    const created = makeMockSession({
      id: 'draft-sid',
      cwd: '/repo/main',
      snapshot: { harnessId: 'claude', messages: [] },
      isStreaming: vi.fn(() => false),
      send,
    })
    const createSession = vi.fn(() => created)
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => null),
      getActiveSession: vi.fn(() => null),
      resumeSession: vi.fn(() => { throw new Error('Session not found: draft-sid') }),
      createSession,
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.SEND_MESSAGE)!
    const request = {
      content: 'first message',
      sessionId: 'draft-sid',
      provider: 'claude' as const,
    }

    await handler(null, '/repo/main', request)

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: '/repo/main',
      providerId: 'claude-base',
      id: 'draft-sid',
    }))
    expect(send).toHaveBeenCalledWith(request)
  })

  it('switches a prewarmed ACP session to the worktree cwd before send', async () => {
    const service = new AgentService()
    const applyWorktreeSelection = vi.fn().mockResolvedValue(undefined)
    const send = vi.fn().mockResolvedValue(undefined)
    const existing = makeMockSession({
      id: 'sid-acp',
      cwd: '/repo/main',
      snapshot: {
        id: 'sid-acp',
        harnessId: 'acp',
        messages: [],
        providerSessionId: 'acp-sess',
        status: 'idle',
      },
      isStreaming: vi.fn(() => false),
      applyWorktreeSelection,
      send,
    })
    Object.defineProperty(existing, 'cwd', {
      get: () => applyWorktreeSelection.mock.calls.length > 0 ? '/repo/main/.worktrees/feat' : '/repo/main',
      configurable: true,
    })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => existing),
      setActiveSession: vi.fn(),
      getActiveSession: vi.fn(() => existing),
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.SEND_MESSAGE)!
    mockExistsSync.mockReturnValue(true)

    await handler(null, '/repo/main', {
      content: 'hello',
      sessionId: 'sid-acp',
      provider: 'acp',
      worktreePath: '/repo/main/.worktrees/feat',
      gitBranch: 'feat',
    })

    expect(applyWorktreeSelection).toHaveBeenCalledWith('/repo/main/.worktrees/feat', 'feat')
    expect(send).toHaveBeenCalled()
  })

  it('creates an ACP session with acpAgentId so Grok persist keeps the brand', async () => {
    const service = new AgentService()
    const send = vi.fn().mockResolvedValue(undefined)
    const created = makeMockSession({
      id: 'sid-grok',
      cwd: '/repo/main',
      snapshot: { harnessId: 'acp', messages: [] },
      isStreaming: vi.fn(() => false),
      send,
    })
    const createSession = vi.fn(() => created)
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => null),
      getActiveSession: vi.fn(() => null),
      resumeSession: vi.fn(() => { throw new Error('Session not found: sid-grok') }),
      createSession,
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.SEND_MESSAGE)!

    await handler(null, '/repo/main', {
      content: 'hello grok',
      sessionId: 'sid-grok',
      provider: 'acp' as const,
      acpAgentId: 'grok-build',
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: '/repo/main',
      providerId: 'acp-base',
      id: 'sid-grok',
      acpAgentId: 'grok-build',
    }))
    expect(send).toHaveBeenCalled()
  })

  it('REQUEST_SESSION_RECAP calls session.requestSessionRecap(false)', async () => {
    const service = new AgentService()
    const requestSessionRecap = vi.fn().mockResolvedValue(true)
    const existing = makeMockSession({
      id: 'sid-grok',
      cwd: '/repo/main',
      snapshot: { harnessId: 'acp', messages: [] },
      requestSessionRecap,
    })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => existing),
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.REQUEST_SESSION_RECAP)!

    const ok = await handler(null, 'sid-grok')

    expect(ok).toBe(true)
    expect(requestSessionRecap).toHaveBeenCalledWith(false)
  })

  it('REQUEST_SESSION_RECAP returns false when session is missing', async () => {
    const service = new AgentService()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => null),
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.REQUEST_SESSION_RECAP)!

    await expect(handler(null, 'missing')).resolves.toBe(false)
  })

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

describe('AgentService phone projections', () => {
  it('get_mcp_icons returns the host brand-icon map', async () => {
    const respond = vi.fn()
    await captureValue(respond, 'mcp-icons', () => nativePhoneProjection(new AgentService(), 'mcp.icons', {}))
    expect(respond).toHaveBeenCalledWith('mcp-icons', { icons: { github: 'https://example.com/g.png' } })
  })

  it('list_directory returns sorted items with directories first', async () => {
    mockReaddir.mockResolvedValue([
      { name: 'zebra.txt', isDirectory: () => false },
      { name: 'src', isDirectory: () => true },
      { name: 'alpha.txt', isDirectory: () => false },
      { name: 'docs', isDirectory: () => true },
    ])
    const respond = vi.fn()
    const service = new AgentService()
    await captureValue(respond, 'r1', () => service.remoteListDirectory('/test', {}))
    expect(respond).toHaveBeenCalledWith('r1', {
      // Echoed so a client can tell an unfiltered answer from a host that
      // predates the option entirely.
      appliedIgnoreMode: 'none',
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
    await captureValue(respond, 'r2', () => service.remoteListDirectory('/test', {}))
    expect(respond).toHaveBeenCalledWith('r2', {
      appliedIgnoreMode: 'none',
      items: [{ name: 'src', isDirectory: true }],
    })
  })

  it('list_directory returns error for invalid path', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT: no such directory'))
    const respond = vi.fn()
    const service = new AgentService()
    await captureValue(respond, 'r3', () => service.remoteListDirectory('/nonexistent', {}))
    expect(respond).toHaveBeenCalledWith('r3', { error: 'ENOENT: no such directory' })
  })

  it('create_directory calls mkdir with correct path', async () => {
    mockMkdir.mockResolvedValue(undefined)
    const respond = vi.fn()
    const service = new AgentService()
    await captureValue(respond, 'r4', () => service.remoteCreateDirectory('/projects', 'new-app').then(() => ({ ok: true })))
    expect(mockMkdir).toHaveBeenCalledWith('/projects/new-app')
    expect(respond).toHaveBeenCalledWith('r4', { ok: true })
  })

  it('create_directory rejects names with path traversal', async () => {
    const respond = vi.fn()
    const service = new AgentService()
    await captureValue(respond, 'r5', () => service.remoteCreateDirectory('/projects', '../escape').then(() => ({ ok: true })))
    expect(mockMkdir).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith('r5', { error: 'Invalid directory name' })
  })

  it('create_directory rejects names with slashes', async () => {
    const respond = vi.fn()
    const service = new AgentService()
    await captureValue(respond, 'r6', () => service.remoteCreateDirectory('/projects', 'a/b').then(() => ({ ok: true })))
    expect(mockMkdir).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith('r6', { error: 'Invalid directory name' })
  })

  describe('status-bar facts a mobile client cannot replay from events', () => {
    function serviceWithSession(overrides: Record<string, unknown> = {}) {
      const service = new AgentService()
      const session = makeMockSession({
        id: 'sid-1',
        projectPath: '/p',
        isStreaming: () => false,
        getPendingInteractions: () => [],
        getQueuedMessagesEvent: () => null,
        getCurrentPermissionMode: () => 'default',
        getUiSettings: () => ({ ultracode: true }),
        getSessionGoal: () => ({ objective: 'ship it', status: 'paused' }),
        getCurrentSandboxInfo: () => ({ enabled: true, autoAllowBash: false }),
        setSandboxMode: vi.fn(async () => ({ enabled: true, autoAllowBash: true })),
        snapshot: {
          harnessId: 'claude',
          messages: [],
          isWorktree: false,
          worktreePath: null,
          gitBranch: null,
          contextTokens: 82_400,
          totalCostUsd: 0.4213,
        },
        ...overrides,
      })
      ;(service as { sessionManager: unknown }).sessionManager = {
        getSession: vi.fn(() => session),
        getActiveSession: vi.fn(() => session),
        forEachSession: (fn: (s: unknown) => void) => [session].forEach(fn),
      }
      return { service, session }
    }

    it('get_attachment serves the original behind a queued message thumbnail', async () => {
      const picture = { id: 'a1', name: 'shot.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' }
      const { service } = serviceWithSession({
        getQueuedMessagesEvent: () => ({
          type: 'queued_messages_changed',
          messages: [{ id: 'q1', role: 'user', status: 'complete', createdAt: '', providerId: 'local', content: [], attachments: [picture] }],
        }),
      })
      const respond = vi.fn()

      await captureValue(respond, 'r3', () => ({ attachment: service.remoteAttachment('sid-1', 'q1', { attachmentId: 'a1', name: 'shot.png' }) }))

      expect(respond).toHaveBeenCalledWith('r3', { attachment: picture })
    })
  })

  it('read_mcp_mentions answers with the mentioned resources\' text', async () => {
    const service = new AgentService()
    const activeSession = makeMockSession({ id: 'sid-1', projectPath: '/p' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => activeSession),
      getSession: vi.fn(() => activeSession),
      forEachSession: vi.fn(),
    }
    const resources = [{ server: 'bits', uri: 'cad://hex', text: 'hex' }]
    mcpMentionMocks.readMcpMentions.mockResolvedValueOnce(resources)
    const respond = vi.fn()
    const targets = [{ server: 'bits', uri: 'cad://hex' }]

    await captureValue(respond, 'r1', () => service.remoteReadMcpMentions('/p', 'sid-1', targets))

    expect(mcpMentionMocks.readMcpMentions).toHaveBeenCalledWith(activeSession, '/p', targets)
    expect(respond).toHaveBeenCalledWith('r1', { resources })
  })

  it('search_mcp_mentions answers with the session servers\' items', async () => {
    const service = new AgentService()
    const activeSession = makeMockSession({ id: 'sid-1', projectPath: '/p' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => activeSession),
      getSession: vi.fn(() => activeSession),
      forEachSession: vi.fn(),
    }
    const result = { sources: [{ server: 'bits', tool: 'search', title: 'Bits', items: [{ uri: 'cad://hex', label: 'Hex' }] }] }
    mcpMentionMocks.searchMcpMentions.mockResolvedValueOnce(result)
    const respond = vi.fn()

    await captureValue(respond, 'r1', () => service.remoteSearchMcpMentions('/p', 'sid-1', 'he'))

    expect(mcpMentionMocks.searchMcpMentions).toHaveBeenCalledWith(activeSession, '/p', 'he')
    expect(respond).toHaveBeenCalledWith('r1', result)
  })

  it('remote lock covers active remote-owned sessions without subscription', async () => {
    const service = new AgentService()
    const activeSession = makeMockSession({ id: 'sid-1', projectPath: '/p' })
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => activeSession),
      forEachSession: vi.fn(),
    }
    const authority = controlLeaseAuthority()
    activeSession.lease.bind(authority)
    acquirePhoneControl(authority, activeSession.id, 'mobile')

    const isLocked = () => (service as unknown as { isRemoteLockedSession: (p: string) => boolean }).isRemoteLockedSession('/p')

    expect(isLocked()).toBe(true)
  })

  function acpQueueSession(opts?: {
    send?: () => Promise<void>
    dispatchBackendCommand?: () => Promise<void>
  }) {
    const send = vi.fn(opts?.send ?? (async () => {}))
    const dispatchBackendCommand = vi.fn(opts?.dispatchBackendCommand ?? (async () => {}))
    const session = makeMockSession({
      id: 'sid-1',
      projectPath: '/p',
      snapshot: { harnessId: 'acp' },
      send,
      dispatchBackendCommand,
    })
    const service = new AgentService()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getActiveSession: vi.fn(() => session),
      getSession: vi.fn(() => session),
      resumeSession: vi.fn(() => session),
      forEachSession: vi.fn(),
    }
    return { service, session, send, dispatchBackendCommand }
  }

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

  it('restores cross-project pending summaries without subscribing to chats', async () => {
    const service = new AgentService()
    const session = {
      snapshot: { id: 'background', projectPath: '/other', harnessId: 'codex', status: 'ended' },
      activityStatus: () => 'background',
      realtimeActive: false,
      seenCompletedMessageId: null,
      getPendingInteractions: () => [{ type: 'ask_user_question', request: { requestId: 'q1', questions: [{ question: 'Which file?' }] } }],
    }
    ;(service as { sessionManager: unknown }).sessionManager = {
      forEachSession: (visit: (session: unknown) => void) => {
        visit(session)
        visit({ ...session, ephemeral: true })
      },
    }
    const respond = vi.fn()
    await captureValue(respond, 'activity', () => ({ sessions: service.remoteSessionActivity() }))
    expect(respond).toHaveBeenCalledWith('activity', { sessions: [expect.objectContaining({
      sessionId: 'background', projectPath: '/other', status: 'background', pendingCount: 1,
      pendingReason: { en: 'Which file?', zh: 'Which file?' },
    })] })
  })

  it('get_usage forwards the command to the harness usage reader and answers { usage }', async () => {
    const usage = { kind: 'claude', title: 'Claude', account: 'a@x.io', planType: 'Max', windows: [], extraUsage: null }
    const reader = vi.fn(async () => usage as never)
    const respond = vi.fn()
    const service = new AgentService()
    service.setHarnessUsageReader(reader)
    const command = { type: 'get_usage', requestId: 'u-1', projectPath: '/p', provider: 'claude', sessionId: 's1', apiProviderId: null, force: true }
    await captureValue(respond, 'u-1', () => service.remoteUsage({ projectPath: '/p', provider: 'claude', sessionId: 's1', apiProviderId: null, force: true }))

    expect(reader).toHaveBeenCalledWith({ projectPath: '/p', provider: 'claude', sessionId: 's1', apiProviderId: null, force: true })
    expect(respond).toHaveBeenCalledWith('u-1', { usage })
  })

  it('get_usage answers null without a reader and { error } when the reader throws', async () => {
    const respond = vi.fn()
    const service = new AgentService()
    await captureValue(respond, 'u-2', () => service.remoteUsage({ projectPath: '/p', provider: 'codex', sessionId: null, apiProviderId: null, force: false }))
    expect(respond).toHaveBeenCalledWith('u-2', { usage: null })

    service.setHarnessUsageReader(async () => { throw new Error('app-server down') })
    await captureValue(respond, 'u-3', () => service.remoteUsage({ projectPath: '/p', provider: 'codex', sessionId: null, apiProviderId: null, force: false }))
    expect(respond).toHaveBeenLastCalledWith('u-3', { error: 'app-server down' })
  })

  it('consume_rate_limit_reset redeems through the Codex service and answers { outcome }', async () => {
    const consume = vi.fn(async () => 'reset' as const)
    const respond = vi.fn()
    const service = new AgentService()
    service.setCodexConsumeRateLimitReset(consume)
    await captureValue(respond, 'r-1', () => service.remoteConsumeRateLimitReset('/p', null, 'rc-1'))
    expect(consume).toHaveBeenCalledWith('/p', null, 'rc-1')
    expect(respond).toHaveBeenCalledWith('r-1', { outcome: 'reset' })
  })

  it('get_system_info returns user agent defaults for claude', async () => {
    vi.mocked(appSettings.readAppSettings).mockReturnValue({
      analyticsEnabled: true,
      locale: '',
      agentPreference: {
        claude: {
          defaultModel: 'claude-opus-4-8',
          defaultEffort: 'high',
          defaultPermissionMode: 'acceptEdits',
          defaultSandboxMode: '',
        },
        codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '' },
      },
    })
    vi.mocked(claudeModels.fetchModels).mockResolvedValue([
      { id: 'claude-opus-4-8', name: 'Opus 4.8' },
      { id: 'claude-sonnet-4-5', name: 'Sonnet 4.5' },
    ] as never)

    const respond = vi.fn()
    const service = new AgentService()
    await captureValue(respond, 'sys-1', () => service.remoteSystemInfo('/p', 'claude', undefined))

    expect(respond).toHaveBeenCalledTimes(1)
    const [, payload] = respond.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.defaults).toEqual({
      model: 'claude-opus-4-8',
      effort: 'high',
      permissionMode: 'acceptEdits',
      // Unset preference, so the platform's own default answers — a remote client
      // configuring a session that does not exist yet has nothing else to read.
      sandboxMode: getSandboxCapability().defaultMode,
    })
    // Asserted against the shared table rather than a second copy of it: the
    // catalog and the launch surfaces read the same list now.
    expect(payload.permissionModes).toEqual(HARNESS_LAUNCH_OPTIONS.claude.permissionModes)
  })

  it('get_system_info resolves defaults when the user has set no preferences', async () => {
    vi.mocked(appSettings.readAppSettings).mockReturnValue({
      analyticsEnabled: true,
      locale: '',
      agentPreference: {
        claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
        codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '' },
      },
    })
    vi.mocked(claudeModels.fetchModels).mockResolvedValue([])

    const respond = vi.fn()
    const service = new AgentService()
    await captureValue(respond, 'sys-2', () => service.remoteSystemInfo('/p', 'claude', undefined))

    const [, payload] = respond.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.defaults).toEqual({
      model: null,
      effort: null,
      // Resolved, never null: an unconfigured harness answers with its own first
      // declared mode, which is what it would start in anyway.
      permissionMode: 'default',
      sandboxMode: getSandboxCapability().defaultMode,
    })
  })

  it('get_system_info hides Claude terminal-bound slash commands from remote clients', async () => {
    vi.mocked(appSettings.readAppSettings).mockReturnValue({
      analyticsEnabled: true,
      locale: '',
      agentPreference: {
        claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
        codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '' },
      },
    })
    vi.mocked(claudeModels.fetchModels).mockResolvedValue([])
    vi.mocked(database.getCachedHarnessResources).mockReturnValue({
      models: [],
      account: {},
      slashCommands: [
        { name: 'help', description: 'Help', argumentHint: '', isSkill: false },
        { name: 'exit', description: 'Exit', argumentHint: '', isSkill: false, terminalBound: true },
      ],
      skills: [],
      commands: [],
      agents: [],
      outputStyles: [],
    })

    const respond = vi.fn()
    const service = new AgentService()
    await captureValue(respond, 'sys-term', () => service.remoteSystemInfo('/p', 'claude', undefined))

    const [, payload] = respond.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.userSlashCommands).toEqual([
      { name: 'help', description: 'Help', argumentHint: '', isSkill: false },
    ])
  })

  it('get_system_info returns codex-flavored defaults for codex provider', async () => {
    vi.mocked(appSettings.readAppSettings).mockReturnValue({
      analyticsEnabled: true,
      locale: '',
      agentPreference: {
        claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
        codex: { defaultModel: 'gpt-5-codex', defaultReasoningEffort: 'high', defaultPermissionPreset: 'full-access' },
      },
    })

    const respond = vi.fn()
    const service = new AgentService()
    ;(service as unknown as { codexListModels: () => Promise<unknown[]> }).codexListModels = async () => []
    await captureValue(respond, 'sys-3', () => service.remoteSystemInfo('/p', 'codex', undefined))

    const [, payload] = respond.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload.defaults).toEqual({
      model: 'gpt-5-codex',
      effort: 'high',
      permissionMode: 'bypassPermissions',
      reasoningEffort: 'high',
      permissionPreset: 'full-access',
    })
    expect(payload.permissionModes).toEqual(['default', 'auto', 'bypassPermissions'])
    expect(payload.permissionPresets).toEqual(['read-only', 'default', 'auto-review', 'full-access'])
    expect(payload.slashCommands).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'help' }),
    ]))
  })

  it('get_project_resources reports the SuperOne project folders, whatever the harness', async () => {
    const respond = vi.fn()
    const service = new AgentService()

    await captureValue(respond, 'resources-codex', () => service.remoteProjectResources('/p', 'codex'))

    // One harness-neutral set now — no Codex config read at all.
    expect(respond).toHaveBeenCalledWith('resources-codex', expect.objectContaining({
      workspaceDirs: [],
      cwd: '/p',
    }))
  })

  it('routes a remote directory write to the SuperOne project, not a harness config', async () => {
    const respond = vi.fn()
    const service = new AgentService()
    ;(service as unknown as { validateAddDirCandidate: () => { ok: true; absolutePath: string } }).validateAddDirCandidate = () => ({
      ok: true,
      absolutePath: '/shared',
    })

    await captureValue(respond, 'add-codex-dir', () => service.remoteUpdateProjectDirs('/p', { addExtraDirs: ['/shared'] }))
    await captureValue(respond, 'remove-codex-dir', () => service.remoteUpdateProjectDirs('/p', { removeExtraDirs: ['/shared'] }))

    expect(updateProjectMock).toHaveBeenCalledWith({ path: '/p', extraDirs: ['/shared'] })
    expect(updateProjectMock).toHaveBeenLastCalledWith({ path: '/p', extraDirs: [] })
  })
})

describe('IPC queue control', () => {
  it('refuses dequeue admitted before a phone takes control while the queue is blocked', async () => {
    const authority = terminalLeaseAuthority()
    const lease = new SessionLease('sid-queue-control', authority)
    const dequeueMessage = vi.fn(async () => true)
    const session = makeMockSession({ id: lease.sessionId, lease, dequeueMessage })
    const service = new AgentService()
    ;(service as { sessionManager: unknown }).sessionManager = { getActiveSession: vi.fn(() => session) }
    service.setup()
    let release!: () => void
    const blocked = enqueueSessionQueueOp(session.id, () => new Promise<void>((resolve) => { release = resolve }))
    await Promise.resolve()
    const pending = getRegisteredIpcHandler(AgentIpcChannels.DEQUEUE_MESSAGE)!(null, '/p', 'queued-1')
    const rejected = expect(pending).rejects.toThrow('stale lease')
    expect(authority.leases.get(lease.resource)?.delegate).toBe('window:99')
    acquirePhoneControl(authority, lease.sessionId, 'phone-a')
    release()
    await blocked
    await rejected
    expect(dequeueMessage).not.toHaveBeenCalled()
    expect(authority.leases.get(lease.resource)?.delegate).toBe('phone:phone-a')
  })
})

describe('IPC interaction responses', () => {
  function setupServiceWithSession(session: ReturnType<typeof makeMockSession>) {
    const broadcasts: unknown[] = []
    const service = new AgentService()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => session),
      getActiveSession: vi.fn(() => session),
    }
    ;(service as unknown as { publishEnvironmentEvent: (e: unknown) => void }).publishEnvironmentEvent = (e) => { broadcasts.push(e) }
    service.setup()
    return { service, broadcasts }
  }

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

  // Each handler only delegates: `Session` announces `interaction_resolved`
  // (session.test.ts), so every caller gets it once.
  it('PERMISSION_RESPONSE delegates to the session and returns whether it was handled', async () => {
    const respondToPermission = vi.fn(() => true)
    const session = makeMockSession({
      id: 'sid-1',
      snapshot: { projectPath: '/p', harnessId: 'claude', messages: [] },
      respondToPermission,
    })
    const { broadcasts } = setupServiceWithSession(session)
    const handler = getRegisteredIpcHandler(AgentIpcChannels.PERMISSION_RESPONSE)!

    expect(await handler(null, 'sid-1', 'req-1', true, false)).toBe(true)

    expect(respondToPermission).toHaveBeenCalledWith('req-1', true, false, undefined, undefined, undefined, undefined)
    expect(broadcasts).toEqual([])
  })

  it('PERMISSION_RESPONSE answers false when the session is missing', async () => {
    const service = new AgentService()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: vi.fn(() => undefined),
      getActiveSession: vi.fn(() => undefined),
    }
    service.setup()
    const handler = getRegisteredIpcHandler(AgentIpcChannels.PERMISSION_RESPONSE)!

    expect(await handler(null, 'missing-sid', 'req-1', true, false)).toBe(false)
  })

  it('SET_PERMISSION_MODE applies only to the explicitly targeted session', async () => {
    const setPermissionMode = vi.fn().mockResolvedValue(undefined)
    const session = makeMockSession({
      id: 'sid-mode',
      snapshot: { projectPath: '/p-mode', harnessId: 'dsh', status: 'idle', messages: [] },
      setPermissionMode,
    })
    setupServiceWithSession(session)
    const handler = getRegisteredIpcHandler(AgentIpcChannels.SET_PERMISSION_MODE)!

    await expect(handler(null, '/p-mode', 'sid-mode', 'default')).resolves.toBe(true)

    expect(setPermissionMode).toHaveBeenCalledWith('default')
  })

  it('SET_PERMISSION_MODE treats a disposal race as a stale no-op', async () => {
    const snapshot = { projectPath: '/p', harnessId: 'dsh', status: 'idle', messages: [] }
    const setPermissionMode = vi.fn().mockImplementation(async () => {
      snapshot.status = 'disposed'
      throw new Error('disposed')
    })
    const session = makeMockSession({
      id: 'sid-disposed',
      snapshot,
      setPermissionMode,
    })
    setupServiceWithSession(session)
    const handler = getRegisteredIpcHandler(AgentIpcChannels.SET_PERMISSION_MODE)!

    await expect(handler(null, '/p', 'sid-disposed', 'default')).resolves.toBe(false)
  })

  it('ANSWER_QUESTION, DISMISS_QUESTION and RESPOND_PLAN_APPROVAL delegate to the session', async () => {
    const respondToQuestion = vi.fn()
    const dismissQuestion = vi.fn()
    const respondToPlanApproval = vi.fn()
    const session = makeMockSession({
      id: 'sid-2',
      snapshot: { projectPath: '/p2', harnessId: 'claude', messages: [] },
      respondToQuestion,
      dismissQuestion,
      respondToPlanApproval,
    })
    const { broadcasts } = setupServiceWithSession(session)

    await getRegisteredIpcHandler(AgentIpcChannels.ANSWER_QUESTION)!(null, 'sid-2', 'q-1', { foo: 'bar' })
    await getRegisteredIpcHandler(AgentIpcChannels.DISMISS_QUESTION)!(null, 'sid-2', 'q-2')
    await getRegisteredIpcHandler(AgentIpcChannels.RESPOND_PLAN_APPROVAL)!(null, 'sid-2', 'plan-1', false, 'looks risky')

    expect(respondToQuestion).toHaveBeenCalledWith('q-1', { foo: 'bar' }, undefined)
    expect(dismissQuestion).toHaveBeenCalledWith('q-2')
    expect(respondToPlanApproval).toHaveBeenCalledWith('plan-1', false, 'looks risky')
    expect(broadcasts).toEqual([])
  })
})

const fsForAddDirTests = await import('fs')
const osForAddDirTests = await import('os')
const pathForAddDirTests = await import('path')
const childProcessForAddDirTests = await import('child_process')

/**
 * A scoped write carries a renderer-supplied session id. Both the ownership and
 * the remote-lock check therefore have to read that session — reading the
 * project's active one answers a question about a different session and lets
 * the write through on the strength of it.
 */
describe('SET_SESSION_SETTINGS scoped writes', () => {
  const PROJECT = '/project-a'

  function makeSession(over: Partial<{ projectPath: string; phone: boolean }> = {}) {
    const authority = controlLeaseAuthority()
    const lease = new SessionLease('scoped', authority)
    if (over.phone) acquirePhoneControl(authority, 'scoped', 'other')
    return {
      lease,
      snapshot: { projectPath: over.projectPath ?? PROJECT },
      setSelectedSettings: vi.fn(),
      setAgentPreset: vi.fn(),
    }
  }

  function setup(sessions: Record<string, ReturnType<typeof makeSession>>, activeId: string) {
    const service = new AgentService()
    service.setup()
    ;(service as { sessionManager: unknown }).sessionManager = {
      getSession: (id: string) => sessions[id] ?? null,
      getActiveSession: () => sessions[activeId] ?? null,
    }
    return getRegisteredIpcHandler(AgentIpcChannels.SET_SESSION_SETTINGS)!
  }

  it('applies a scoped write to the addressed session, leaving the active one alone', async () => {
    const active = makeSession()
    const pane = makeSession()
    const handle = setup({ active, pane }, 'active')

    await handle({}, PROJECT, { model: 'opus-4-8' }, 'pane')

    expect(pane.setSelectedSettings).toHaveBeenCalledWith({ model: 'opus-4-8' })
    expect(active.setSelectedSettings).not.toHaveBeenCalled()
  })

  it('refuses a scoped write to a session owned by a remote device, even when the active session is free', async () => {
    const active = makeSession()
    const pane = makeSession({ phone: true })
    const handle = setup({ active, pane }, 'active')

    await handle({}, PROJECT, { model: 'opus-4-8' }, 'pane')

    expect(pane.setSelectedSettings).not.toHaveBeenCalled()
  })

  it('refuses a scoped write whose session belongs to a different project', async () => {
    const active = makeSession()
    const foreign = makeSession({ projectPath: '/project-b' })
    const handle = setup({ active, foreign }, 'active')

    await handle({}, PROJECT, { model: 'opus-4-8' }, 'foreign')

    expect(foreign.setSelectedSettings).not.toHaveBeenCalled()
  })

  it('still resolves the project active session when no id is supplied', async () => {
    const active = makeSession()
    const handle = setup({ active }, 'active')

    await handle({}, PROJECT, { model: 'opus-4-8' })

    expect(active.setSelectedSettings).toHaveBeenCalledWith({ model: 'opus-4-8' })
  })
})

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

/** Observe the projection value and its error independently of transport receipts. */
async function captureValue(observe: (id: string, value: unknown) => unknown, id: string, read: () => unknown): Promise<void> {
  try { observe(id, await read()) }
  catch (error) { observe(id, { error: error instanceof Error ? error.message : String(error) }) }
}
async function nativePhoneProjection(agent: AgentService, method: string, payload: Record<string, unknown>): Promise<unknown> {
  const ctx = { identity: { environmentId: 'test-environment' }, client: { clientSessionId: 'phone:test', scopes: [...ADMIN_PAIRING_SCOPES] }, projects: { get: (id: string) => ({ projectId: id, path: id }) } } as unknown as RpcContext
  const response = await createPhoneMethods({ agent }).dispatch(method, payload, ctx)
  if (!response) throw new Error('Missing phone method')
  if ('error' in response) throw Object.assign(new Error(response.error.message), response.error)
  return response.result
}
