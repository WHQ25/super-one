import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(async () => ({ id: 'oc-session' })),
  updatePermission: vi.fn(async () => undefined),
  promptAsync: vi.fn(async () => undefined),
  command: vi.fn(async () => undefined),
  initSession: vi.fn(async () => undefined),
  summarize: vi.fn(async () => undefined),
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
  connectMcp: vi.fn(async () => undefined),
  disconnectMcp: vi.fn(async () => undefined),
  abort: vi.fn(async () => undefined),
  permissionReply: vi.fn(async () => undefined),
  questionReply: vi.fn(async () => undefined),
  questionReject: vi.fn(async () => undefined),
  closeServer: vi.fn(async () => undefined),
  events: [] as unknown[],
}))

vi.mock('./opencode-client', () => ({
  OpenCodeClient: class {
    providerList = async () => ({ connected: [], default: {}, all: [] })
    agents = async () => [{ name: 'build', mode: 'primary', hidden: false }]
    commands = async () => [{ name: 'review', source: 'command', hints: [], template: '' }]
    createSession = mocks.createSession
    updatePermission = mocks.updatePermission
    promptAsync = mocks.promptAsync
    command = mocks.command
    initSession = mocks.initSession
    summarize = mocks.summarize
    todos = mocks.todos
    pendingInteractions = mocks.pendingInteractions
    contextUsage = mocks.contextUsage
    diff = mocks.diff
    revert = mocks.revert
    mcpStatus = mocks.mcpStatus
    connectMcp = mocks.connectMcp
    disconnectMcp = mocks.disconnectMcp
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
  parseOpenCodeCommands: () => [{ name: 'review', description: '', argumentHint: '', isSkill: false }],
  withOpenCodeLocalCommands: (commands: unknown[]) => [...commands, {
    name: 'init', description: 'Create AGENTS.md', argumentHint: '', isSkill: false,
  }, {
    name: 'compact', description: 'Compact context', argumentHint: '', isSkill: false,
  }],
  startOpenCodeServer: async () => ({
    url: 'http://127.0.0.1:4000',
    exited: null,
    close: mocks.closeServer,
  }),
}))

import { buildOpenCodePermissionRules, createOpenCodeRuntime } from './opencode-runtime'

describe('opencode-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.events = []
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

    await runtime.prompt('Plan this', 'openai/gpt-5', 'high')
    expect(mocks.promptAsync).toHaveBeenCalledWith('oc-session', {
      text: 'Plan this',
      model: 'openai/gpt-5',
      variant: 'high',
      images: undefined,
      agent: 'plan',
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
    ])
    expect(runtime.initialTodos).toEqual([{ content: 'Resume work', status: 'pending', priority: 'high' }])
    expect(runtime.pendingPermissions).toEqual([expect.objectContaining({ id: 'permission-1' })])
    expect(runtime.pendingQuestions).toEqual([expect.objectContaining({ id: 'question-1' })])
    await runtime.command('review', 'working tree', 'openai/gpt-5', 'high')
    expect(mocks.command).toHaveBeenCalledWith('oc-session', {
      command: 'review',
      arguments: 'working tree',
      model: 'openai/gpt-5',
      variant: 'high',
      images: undefined,
      agent: undefined,
    })
    expect(await runtime.getMcpServerStatus()).toEqual([{ name: 'github', status: 'connected' }])
    await runtime.reconnectMcp('github')
    expect(mocks.disconnectMcp).toHaveBeenCalledWith('github')
    expect(mocks.connectMcp).toHaveBeenCalledWith('github')
    await runtime.toggleMcpServer('github', false)
    expect(mocks.disconnectMcp).toHaveBeenCalledTimes(2)
    expect(await runtime.getContextUsage()).toEqual(expect.objectContaining({ maxTokens: 400_000 }))
    await runtime.init('openai/gpt-5')
    expect(mocks.initSession).toHaveBeenCalledWith('oc-session', 'openai/gpt-5')
    await runtime.compact('openai/gpt-5')
    expect(mocks.summarize).toHaveBeenCalledWith('oc-session', 'openai/gpt-5')
    expect(await runtime.diff('user-message')).toHaveLength(1)
    await runtime.revert('user-message')
    expect(mocks.revert).toHaveBeenCalledWith('oc-session', 'user-message')
    await runtime.close()
    expect(mocks.closeServer).toHaveBeenCalledOnce()
  })

  it('forwards only events for its provider session', async () => {
    mocks.events = [
      { type: 'session.idle', properties: { sessionID: 'other-session' } },
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
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce())
    expect(onEvent.mock.calls[0][0].properties.sessionID).toBe('oc-session')
    await runtime.close()
  })

  it('builds deny and accept-edits rules without disabling questions', () => {
    expect(buildOpenCodePermissionRules('dontAsk')).toEqual([
      { permission: '*', pattern: '*', action: 'deny' },
      { permission: 'question', pattern: '*', action: 'allow' },
    ])
    expect(buildOpenCodePermissionRules('acceptEdits')).toContainEqual({
      permission: 'edit',
      pattern: '*',
      action: 'allow',
    })
  })
})
