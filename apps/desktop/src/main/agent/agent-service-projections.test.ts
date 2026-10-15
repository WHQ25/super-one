import { beforeEach, describe, expect, it, vi } from 'vitest'
// Register the host-boundary mocks before importing modules that retain them.
import {
  AgentService, dbSessions, appSettings, claudeModels, database, updateProjectMock,
  mockReaddir, mockMkdir, mcpMentionMocks, makeMockSession,
  external, usage, claudeAccounts, claudeAccountStore,
} from './agent-service.test-fixtures'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { LoadedClaudeCreds } from '@superone/runtime/usage'
import { claudeAccountProviderId, CLAUDE_CLI_ACCOUNT_PROVIDER_ID } from '@superone/shared/agent-types'
import { acquirePhoneControl, controlLeaseAuthority } from '../control-lease.test-fixtures'
import { createPhoneMethods } from '../remote/phone-methods'
import { ADMIN_PAIRING_SCOPES } from '@superone/shared/environment'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import type { RpcContext } from '@superone/runtime/server'
import { getSandboxCapability } from '../sandbox-platform'

const defaultSettings = appSettings.readAppSettings()
beforeEach(() => {
  vi.mocked(appSettings.readAppSettings).mockReturnValue(defaultSettings)
  vi.mocked(claudeModels.fetchModels).mockResolvedValue([])
  vi.mocked(database.getCachedHarnessResources).mockReturnValue(null)
  // Exercise the real credential catalog with an empty database, rather than
  // falling into remoteSystemInfo's catch because getDb() returned undefined.
  vi.mocked(database.getDb).mockReturnValue({ prepare: () => ({ all: () => [] }) } as never)
})

function accountCredentials(dir: string | null, token: string): LoadedClaudeCreds {
  return {
    credentialDir: dir, source: 'file', serviceName: null, account: null, fullData: {},
    oauth: { accessToken: token, scopes: ['user:profile'], subscriptionType: 'max' },
  }
}

function serveProfiles() {
  external.fetch.mockImplementation(async (url, init) => {
    expect(url).toBe('https://api.anthropic.com/api/oauth/profile')
    const token = (init?.headers as Record<string, string>).Authorization.replace('Bearer ', '')
    return new Response(JSON.stringify({
      account: { uuid: token, email: `${token}@example.test` },
      organization: { uuid: 'org', name: 'Fixture org' },
    }))
  })
}

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
    expect(payload.providers).toEqual([{ id: null, name: 'Claude', brand: 'claude' }])
    expect(payload.selectedProviderId).toBeNull()
    expect(usage.loadClaudeCredentials).toHaveBeenCalledWith(null, expect.any(Object))
    expect(external.fetch).not.toHaveBeenCalled()
    expect(usage.refreshClaudeToken).not.toHaveBeenCalled()
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

  it('get_system_info retains the credential domain for a single signed-in CLI account', async () => {
    vi.mocked(usage.loadClaudeCredentials).mockReturnValue(accountCredentials(null, 'cli'))
    serveProfiles()

    const info = await new AgentService().remoteSystemInfo('/p', 'claude')

    expect(info.providers).toEqual([
      { id: CLAUDE_CLI_ACCOUNT_PROVIDER_ID, name: 'Claude', brand: 'claude', keyName: 'cli@example.test' },
    ])
    expect(info.selectedProviderId).toBe(CLAUDE_CLI_ACCOUNT_PROVIDER_ID)
    expect(external.fetch).toHaveBeenCalledTimes(1)
    expect(usage.refreshClaudeToken).not.toHaveBeenCalled()
  })

  it('get_system_info preserves the selected managed account and excludes signed-out accounts', async () => {
    const store = claudeAccountStore()
    const managed = join(store.root, 'managed')
    const signedOut = join(store.root, 'signed-out')
    mkdirSync(managed, { recursive: true })
    mkdirSync(signedOut)
    const credentials = new Map([
      [null, accountCredentials(null, 'cli')],
      [managed, accountCredentials(managed, 'managed')],
    ])
    vi.mocked(usage.loadClaudeCredentials).mockImplementation((dir) => credentials.get(dir) ?? null)
    serveProfiles()
    await claudeAccounts.setDefaultAccount(managed)

    const info = await new AgentService().remoteSystemInfo('/p', 'claude')

    expect(info.providers).toEqual([
      { id: CLAUDE_CLI_ACCOUNT_PROVIDER_ID, name: 'Claude', brand: 'claude', keyName: 'cli@example.test' },
      { id: claudeAccountProviderId(managed), name: 'Claude', brand: 'claude', keyName: 'managed@example.test' },
    ])
    expect(info.selectedProviderId).toBe(claudeAccountProviderId(managed))
    expect(usage.loadClaudeCredentials).toHaveBeenCalledWith(signedOut, expect.any(Object))
    expect(info.defaults).toMatchObject({ model: null, effort: null, permissionMode: 'default' })
    expect(external.fetch).toHaveBeenCalledTimes(2)
  })

  it('get_system_info still answers defaults and the account choice during a profile outage', async () => {
    vi.mocked(usage.loadClaudeCredentials).mockReturnValue(accountCredentials(null, 'offline'))
    external.fetch.mockRejectedValue(new Error('Fixture profile offline'))

    const info = await new AgentService().remoteSystemInfo('/p', 'claude')

    expect(info.defaults).toMatchObject({ model: null, effort: null, permissionMode: 'default' })
    expect(info.providers).toEqual([{ id: CLAUDE_CLI_ACCOUNT_PROVIDER_ID, name: 'Claude', brand: 'claude' }])
    expect(info.selectedProviderId).toBe(CLAUDE_CLI_ACCOUNT_PROVIDER_ID)
    expect(external.fetch).toHaveBeenCalledTimes(1)
    expect(usage.refreshClaudeToken).not.toHaveBeenCalled()
  })

  it('get_system_info uses renewed credentials when the account token has expired', async () => {
    const credentials = accountCredentials(null, 'expired')
    credentials.oauth.expiresAt = 1
    credentials.oauth.refreshToken = 'fixture-refresh-token'
    vi.mocked(usage.loadClaudeCredentials).mockReturnValue(credentials)
    vi.mocked(usage.refreshClaudeToken).mockImplementation(async (loaded) => {
      loaded.oauth.accessToken = 'renewed'
      return 'renewed'
    })
    serveProfiles()

    const info = await new AgentService().remoteSystemInfo('/p', 'claude')

    expect(info.providers?.[0]).toMatchObject({ id: CLAUDE_CLI_ACCOUNT_PROVIDER_ID, keyName: 'renewed@example.test' })
    expect(usage.refreshClaudeToken).toHaveBeenCalledTimes(1)
    expect(usage.refreshClaudeToken).toHaveBeenCalledWith(credentials, expect.any(Object))
    expect(external.fetch).toHaveBeenCalledTimes(1)
    expect(external.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer renewed' }),
    }))
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
