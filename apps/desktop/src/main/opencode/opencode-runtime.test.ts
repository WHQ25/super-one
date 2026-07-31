import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(async () => ({ id: 'oc-session' })),
  updatePermission: vi.fn(async () => undefined),
  updateSessionTitle: vi.fn(async () => undefined),
  promptAsync: vi.fn(async () => undefined),
  command: vi.fn(async () => undefined),
  shell: vi.fn(async () => undefined),
  initSession: vi.fn(async () => undefined),
  summarize: vi.fn(async () => undefined),
  shareSession: vi.fn(async () => 'https://opncd.ai/share/demo'),
  unshareSession: vi.fn(async () => undefined),
  todos: vi.fn(async () => [{ content: 'Resume work', status: 'pending', priority: 'high' }]),
  pendingInteractions: vi.fn(async () => ({
    permissions: [{ id: 'permission-1', sessionID: 'oc-session', action: 'bash', resources: ['git status'] }],
    questions: [{ id: 'question-1', sessionID: 'oc-session', questions: [{ question: 'Continue?', header: 'Continue', options: [] }] }],
  })),
  contextUsage: vi.fn(async () => ({
    categories: [{ name: 'Input', tokens: 12, color: '#22c55e' }],
    totalTokens: 12,
    maxTokens: 400_000,
    percentage: 0.003,
    model: 'openai/gpt-5',
  })),
  diff: vi.fn(async () => [{ file: 'src/app.ts', additions: 3, deletions: 1, status: 'modified' }] as const),
  revert: vi.fn(async () => undefined),
  mcpStatus: vi.fn(async () => [{ name: 'github', status: 'connected' }]),
  authenticateMcp: vi.fn(async () => undefined),
  connectMcp: vi.fn(async () => undefined),
  disconnectMcp: vi.fn(async () => undefined),
  addMcp: vi.fn(async () => undefined),
  abort: vi.fn(async () => undefined),
  permissionReply: vi.fn(async () => undefined),
  questionReply: vi.fn(async () => undefined),
  questionReject: vi.fn(async () => undefined),
  closeServer: vi.fn(async () => undefined),
  events: [] as unknown[],
  mcpConfigs: [{ name: 'project-tools', type: 'stdio', command: 'tools-server' }],
}))

vi.mock('../logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('./opencode-client', () => ({
  OpenCodeClient: class {
    providerList = async () => ({ connected: [], default: {}, all: [] })
    agents = async () => [{ name: 'build', mode: 'primary', hidden: false }]
    commands = async () => [{ name: 'review', source: 'command', hints: [], template: '' }]
    createSession = mocks.createSession
    updatePermission = mocks.updatePermission
    updateSessionTitle = mocks.updateSessionTitle
    promptAsync = mocks.promptAsync
    command = mocks.command
    shell = mocks.shell
    initSession = mocks.initSession
    summarize = mocks.summarize
    shareSession = mocks.shareSession
    unshareSession = mocks.unshareSession
    todos = mocks.todos
    pendingInteractions = mocks.pendingInteractions
    contextUsage = mocks.contextUsage
    diff = mocks.diff
    revert = mocks.revert
    mcpStatus = mocks.mcpStatus
    authenticateMcp = mocks.authenticateMcp
    connectMcp = mocks.connectMcp
    disconnectMcp = mocks.disconnectMcp
    addMcp = mocks.addMcp
    abort = mocks.abort
    permissionReply = mocks.permissionReply
    questionReply = mocks.questionReply
    questionReject = mocks.questionReject
    eventStream = async (signal: AbortSignal) => (async function* () {
      for (const event of mocks.events) yield event
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    })()
  },
  parseModels: () => [{ id: 'openai/gpt-5', name: 'GPT-5', description: '', contextWindow: 400_000 }],
  parseOpenCodeAgents: () => [{ id: 'build', name: 'build' }],
  parseOpenCodeCommands: () => [{ name: 'review', description: '', argumentHint: '', isSkill: false }],
  withOpenCodeLocalCommands: (commands: unknown[]) => [...commands, {
    name: 'init', description: 'Create AGENTS.md', argumentHint: '', isSkill: false,
  }, {
    name: 'compact', description: 'Compact context', argumentHint: '', isSkill: false,
  }, {
    name: 'share', description: 'Share session', argumentHint: '', isSkill: false,
  }, {
    name: 'unshare', description: 'Unshare session', argumentHint: '', isSkill: false,
  }],
  startOpenCodeServer: async () => ({
    url: 'http://127.0.0.1:4000',
    exited: null,
    close: mocks.closeServer,
  }),
  toOpenCodeMcpConfig: (config: { command?: string; disabled?: boolean }) => config.command
    ? { type: 'local', command: [config.command], enabled: !config.disabled }
    : null,
}))

vi.mock('../mcp-config-service', () => ({
  listMcpConfigs: () => mocks.mcpConfigs,
}))

vi.mock('../mcp/superone-mcp-stdio-state', () => ({
  getSuperoneMcpHttpConfig: () => ({
    url: 'http://127.0.0.1:3210/mcp',
    headers: {
      Authorization: 'Bearer tok',
      'X-SuperOne-Session-Id': 'superone-session',
    },
  }),
  getSuperoneMcpStdioConfig: () => ({
    command: 'node',
    args: ['/bridge.js'],
    env: { SUPERONE_MCP_SESSION_ID: 'superone-session' },
  }),
}))

import {
  setComputerUseEnabledForTests,
} from '../computer-use/tools'
import { buildOpenCodePermissionRules, createOpenCodeRuntime } from './opencode-runtime'

describe('opencode-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setComputerUseEnabledForTests(null)
    mocks.addMcp.mockResolvedValue(undefined)
    mocks.events = []
    mocks.mcpConfigs = [{ name: 'project-tools', type: 'stdio', command: 'tools-server' }]
  })

  afterEach(() => {
    setComputerUseEnabledForTests(null)
  })

  afterEach(() => {
    mocks.events = []
  })

  it('uses plan agent and updates live permission rules', async () => {
    const runtime = await createOpenCodeRuntime({
      sessionId: 'superone-session',
      cwd: '/project',
      config: {},
      permissionMode: 'plan',
      onEvent: vi.fn(),
    })

    await runtime.prompt('Plan this', 'openai/gpt-5', 'high', undefined, 'build')
    expect(mocks.promptAsync).toHaveBeenCalledWith('oc-session', {
      text: 'Plan this',
      model: 'openai/gpt-5',
      variant: 'high',
      images: undefined,
      agent: 'plan',
    })
    expect(mocks.addMcp).toHaveBeenCalledWith('superone', {
      type: 'remote',
      url: 'http://127.0.0.1:3210/mcp',
      headers: {
        Authorization: 'Bearer tok',
        'X-SuperOne-Session-Id': 'superone-session',
      },
      enabled: true,
    })

    await runtime.setPermissionMode('bypassPermissions')
    expect(mocks.updatePermission).toHaveBeenCalledWith('oc-session', [
      { permission: '*', pattern: '*', action: 'allow' },
    ])

    await runtime.prompt('Build this', 'openai/gpt-5')
    expect(mocks.promptAsync).toHaveBeenLastCalledWith('oc-session', {
      text: 'Build this',
      model: 'openai/gpt-5',
      variant: undefined,
      images: undefined,
      agent: undefined,
    })
    expect(runtime.commands).toEqual([
      { name: 'review', description: '', argumentHint: '', isSkill: false },
      { name: 'init', description: 'Create AGENTS.md', argumentHint: '', isSkill: false },
      { name: 'compact', description: 'Compact context', argumentHint: '', isSkill: false },
      { name: 'share', description: 'Share session', argumentHint: '', isSkill: false },
      { name: 'unshare', description: 'Unshare session', argumentHint: '', isSkill: false },
    ])
    expect(runtime.initialTodos).toEqual([{ content: 'Resume work', status: 'pending', priority: 'high' }])
    expect(runtime.pendingPermissions).toEqual([expect.objectContaining({ id: 'permission-1' })])
    expect(runtime.pendingQuestions).toEqual([expect.objectContaining({ id: 'question-1' })])
    await runtime.setTitle('Renamed session')
    expect(mocks.updateSessionTitle).toHaveBeenCalledWith('oc-session', 'Renamed session')
    await runtime.command('review', 'working tree', 'openai/gpt-5', 'high', undefined, 'general')
    expect(mocks.command).toHaveBeenCalledWith('oc-session', {
      command: 'review',
      arguments: 'working tree',
      model: 'openai/gpt-5',
      variant: 'high',
      images: undefined,
      agent: 'general',
    })
    await runtime.setPermissionMode('plan')
    await runtime.shell('git status', 'openai/gpt-5', 'general')
    expect(mocks.shell).toHaveBeenCalledWith('oc-session', {
      command: 'git status', model: 'openai/gpt-5', agent: 'plan',
    })
    expect(await runtime.getMcpServerStatus()).toEqual([{ name: 'github', status: 'connected' }])
    await runtime.authenticateMcp('github')
    expect(mocks.authenticateMcp).toHaveBeenCalledWith('github')
    await runtime.reconnectMcp('github')
    expect(mocks.disconnectMcp).toHaveBeenCalledWith('github')
    expect(mocks.connectMcp).toHaveBeenCalledWith('github')
    await runtime.toggleMcpServer('github', false)
    expect(mocks.disconnectMcp).toHaveBeenCalledTimes(2)
    await runtime.reloadMcpServers()
    expect(mocks.addMcp).toHaveBeenCalledWith('project-tools', {
      type: 'local', command: ['tools-server'], enabled: true,
    })
    expect(await runtime.getContextUsage()).toEqual(expect.objectContaining({ maxTokens: 400_000 }))
    await runtime.init('openai/gpt-5')
    expect(mocks.initSession).toHaveBeenCalledWith('oc-session', 'openai/gpt-5')
    await runtime.compact('openai/gpt-5')
    expect(mocks.summarize).toHaveBeenCalledWith('oc-session', 'openai/gpt-5')
    expect(await runtime.share()).toBe('https://opncd.ai/share/demo')
    await runtime.unshare()
    expect(mocks.shareSession).toHaveBeenCalledWith('oc-session')
    expect(mocks.unshareSession).toHaveBeenCalledWith('oc-session')
    expect(await runtime.diff('user-message')).toHaveLength(1)
    await runtime.revert('user-message')
    expect(mocks.revert).toHaveBeenCalledWith('oc-session', 'user-message')
    await runtime.close()
    expect(mocks.closeServer).toHaveBeenCalledOnce()
  })

  it('rejects MCP OAuth when the OpenCode server is remote', async () => {
    const runtime = await createOpenCodeRuntime({
      sessionId: 'superone-session',
      cwd: '/project',
      config: { serverUrl: 'https://opencode.example.com' },
      permissionMode: 'default',
      onEvent: vi.fn(),
    })

    await expect(runtime.authenticateMcp('github')).rejects.toThrow(/local OpenCode runtime/)
    expect(mocks.authenticateMcp).not.toHaveBeenCalled()
    await runtime.close()
  })

  it('falls back to stdio when shared HTTP MCP registration fails', async () => {
    mocks.addMcp.mockImplementation(async (name: string, config: { type?: string }) => {
      if (name === 'superone' && config.type === 'remote') throw new Error('remote MCP unsupported')
    })

    const runtime = await createOpenCodeRuntime({
      sessionId: 'superone-session',
      cwd: '/project',
      config: {},
      permissionMode: 'default',
      onEvent: vi.fn(),
    })

    expect(mocks.addMcp).toHaveBeenCalledWith('superone', expect.objectContaining({ type: 'remote' }))
    expect(mocks.addMcp).toHaveBeenCalledWith('superone', {
      type: 'local',
      command: ['node', '/bridge.js'],
      environment: { SUPERONE_MCP_SESSION_ID: 'superone-session' },
      enabled: true,
      timeout: 60_000,
    })
    await runtime.close()
  })

  it('reserves the superone MCP name for the built-in server', async () => {
    mocks.mcpConfigs = [
      { name: 'superone', type: 'stdio', command: 'user-superone' },
      { name: 'project-tools', type: 'stdio', command: 'tools-server' },
    ]

    const runtime = await createOpenCodeRuntime({
      sessionId: 'superone-session',
      cwd: '/project',
      config: {},
      permissionMode: 'default',
      onEvent: vi.fn(),
    })

    expect(mocks.addMcp).not.toHaveBeenCalledWith('superone', expect.objectContaining({
      command: ['user-superone'],
    }))
    expect(mocks.addMcp).toHaveBeenCalledWith('superone', expect.objectContaining({ type: 'remote' }))
    await runtime.close()
  })

  it('forwards only events for its provider session', async () => {
    mocks.events = [
      { type: 'session.idle', properties: { sessionID: 'other-session' } },
      { type: 'mcp.tools.changed', properties: { server: 'superone' } },
      { type: 'session.idle', properties: { sessionID: 'oc-session' } },
    ]
    const onEvent = vi.fn()
    const runtime = await createOpenCodeRuntime({
      sessionId: 'superone-session',
      cwd: '/project',
      config: {},
      permissionMode: 'default',
      onEvent,
    })
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2))
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(['mcp.tools.changed', 'session.idle'])
    await runtime.close()
  })

  it('builds deny and accept-edits rules without disabling questions', () => {
    const denyRules = buildOpenCodePermissionRules('dontAsk')
    expect(denyRules).toContainEqual({ permission: '*', pattern: '*', action: 'deny' })
    expect(denyRules).toContainEqual({ permission: 'question', pattern: '*', action: 'allow' })
    expect(denyRules).toContainEqual({ permission: 'superone_session_rename', pattern: '*', action: 'allow' })
    expect(buildOpenCodePermissionRules('acceptEdits')).toContainEqual({
      permission: 'edit',
      pattern: '*',
      action: 'allow',
    })
  })

  it('auto-allows SuperOne computer-use tools when the feature is enabled', () => {
    setComputerUseEnabledForTests(true)
    const rules = buildOpenCodePermissionRules('default')
    for (const name of [
      'computer_apps',
      'computer_snapshot',
      'computer_zoom',
      'computer_query',
      'computer_act',
      'computer_wait_for',
      'computer_observe',
    ]) {
      expect(rules).toContainEqual({
        permission: `superone_${name}`,
        pattern: '*',
        action: 'allow',
      })
    }
  })

  it('does not auto-allow computer-use tools when the feature is disabled', () => {
    setComputerUseEnabledForTests(false)
    const rules = buildOpenCodePermissionRules('default')
    expect(rules).not.toContainEqual({
      permission: 'superone_computer_apps',
      pattern: '*',
      action: 'allow',
    })
    // Static host tools still allowed.
    expect(rules).toContainEqual({
      permission: 'superone_session_rename',
      pattern: '*',
      action: 'allow',
    })
  })

  it('auto-allows mobile_share_file even when computer use is off', () => {
    setComputerUseEnabledForTests(false)
    expect(buildOpenCodePermissionRules('default')).toContainEqual({
      permission: 'superone_mobile_share_file',
      pattern: '*',
      action: 'allow',
    })
  })
})
