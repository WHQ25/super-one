import { controlLeaseAuthority } from '../control-lease.test-fixtures'
import { afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionLease } from '../session/session-lease'

const external = vi.hoisted(() => ({ home: '', fetch: vi.fn<typeof fetch>() }))
vi.mock('../superone-home', () => ({ superoneHome: () => external.home }))

// Keep account discovery/profile/catalog logic real; replace only credential I/O.
vi.mock('@superone/runtime/usage', async (importOriginal) => ({
  ...await importOriginal<typeof import('@superone/runtime/usage')>(),
  loadClaudeCredentials: vi.fn(() => null),
  refreshClaudeToken: vi.fn(async () => { throw new Error('Unexpected credential refresh') }),
}))

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

vi.mock('./event-trace', () => ({ trace: vi.fn() }))

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
  platformDisplay: vi.fn((id: string) => ({ name: id })),
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

vi.mock('./remote-mention-search', () => ({
  searchRemoteMentions: vi.fn(async (_projectPath: string, cwd: string) => ({ cwd })),
}))

vi.mock('../session/session-repo', async (importOriginal) => ({
  ...await importOriginal<typeof import('../session/session-repo')>(),
  getSessionRecord: vi.fn(() => null),
}))

const { AgentService } = await import('./agent-service')
const sessionRepo = await import('../session/session-repo')
const { AgentIpcChannels } = await import('@superone/shared/agent-types')
const { ipcMain } = await import('electron')
const dbSessions = await import('../db-sessions')
const appSettings = await import('../app-settings-service')
const claudeModels = await import('./claude-models')
const database = await import('../database')
const claudeAccounts = await import('./claude-account-service')
const { claudeAccountStore } = await import('./claude-account-store')
const usage = await import('@superone/runtime/usage')
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
  external.home = mkdtempSync(join(tmpdir(), 'agent-service-test-'))
  if (claudeAccountStore().root !== join(external.home, 'claude-accounts')) {
    throw new Error('AgentService tests must use their temporary account registry')
  }
  external.fetch.mockReset().mockRejectedValue(new Error('Unexpected network request'))
  vi.stubGlobal('fetch', external.fetch)
  vi.mocked(usage.loadClaudeCredentials).mockReset().mockReturnValue(null)
  vi.mocked(usage.refreshClaudeToken).mockReset().mockRejectedValue(new Error('Unexpected credential refresh'))
  claudeAccounts.invalidateAccountListCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(external.home, { recursive: true, force: true })
})

function getRegisteredIpcHandler(channel: string) {
  const handleMock = ipcMain.handle as unknown as ReturnType<typeof vi.fn>
  const call = handleMock.mock.calls.find(([registered]) => registered === channel)
  const handler = call?.[1] as ((event: unknown, ...args: unknown[]) => unknown) | undefined
  return handler ? (event: unknown, ...args: unknown[]) => handler({ ...(event as object ?? {}), sender: (event as { sender?: unknown } | null)?.sender ?? { id: 99 } }, ...args) : undefined
}

// Shared setup keeps each AgentService scenario file on the same host boundaries.
export {
  AgentService, sessionRepo, AgentIpcChannels, dbSessions, appSettings, claudeModels,
  database, createdAgents, dshMcpMocks, remoteDshMcpMocks, gitRunMock, updateProjectMock,
  mockReaddir, mockMkdir, mockExistsSync, mcpMentionMocks, realtimeTimelineRepoMocks,
  forkSessionMock, draftStoreMock, makeMockSession, getRegisteredIpcHandler,
  external, usage, claudeAccounts, claudeAccountStore,
}
