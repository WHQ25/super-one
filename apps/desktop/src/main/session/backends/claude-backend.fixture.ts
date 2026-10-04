import { vi } from 'vitest'
import type { AgentEvent, SendMessageRequest } from '@superone/shared/agent-types'

const hoisted = vi.hoisted(() => {
  interface Captured {
    emit: ((e: AgentEvent) => void) | null
    onSessionId: ((id: string) => void) | null
    onQueuedTurnStart: ((messageId: string) => void) | null
    onStepBoundary: (() => void) | null
    getInterrupted: (() => boolean) | null
    getCurrentMessageId: (() => string) | null
    bridge: unknown
    iterationDone: { resolve: () => void; promise: Promise<void> } | null
    activeBackgroundTasks: Map<string, { toolUseId?: string; description: string }> | null
    createSessionQueryMock: ReturnType<typeof vi.fn>
    buildClaudeOptionsMock: ReturnType<typeof vi.fn>
    warmupPrewarm: ReturnType<typeof vi.fn>
    warmupDispose: ReturnType<typeof vi.fn<() => void>>
    mockQueryInterrupt: ReturnType<typeof vi.fn>
    mockQueryCancelAsyncMessage: ReturnType<typeof vi.fn>
    mockQueryClose: ReturnType<typeof vi.fn>
    mockQuerySetModel: ReturnType<typeof vi.fn>
    mockQueryRewindFiles: ReturnType<typeof vi.fn>
    mockQueryGetContextUsage: ReturnType<typeof vi.fn>
    mockQueryMcpServerStatus: ReturnType<typeof vi.fn>
    mockQueryReconnectMcpServer: ReturnType<typeof vi.fn>
    mockQueryToggleMcpServer: ReturnType<typeof vi.fn>
    mockQueryReloadPlugins: ReturnType<typeof vi.fn>
  }
  const captured: Captured = {
    emit: null,
    onSessionId: null,
    onQueuedTurnStart: null,
    onStepBoundary: null,
    getInterrupted: null,
    getCurrentMessageId: null,
    bridge: null,
    iterationDone: null,
    activeBackgroundTasks: null,
    createSessionQueryMock: vi.fn(),
    buildClaudeOptionsMock: vi.fn((opts: unknown) => ({ __built: opts })),
    warmupPrewarm: vi.fn(),
    warmupDispose: vi.fn(),
    mockQueryInterrupt: vi.fn(async () => ({ still_queued: [] })),
    mockQueryCancelAsyncMessage: vi.fn(async () => true),
    mockQueryClose: vi.fn(),
    mockQuerySetModel: vi.fn(async () => {}),
    mockQueryRewindFiles: vi.fn(async () => ({ canRewind: true, filesChanged: ['a.ts'], insertions: 1, deletions: 0 })),
    mockQueryGetContextUsage: vi.fn(async () => ({ categories: [{ name: 'system', tokens: 5, color: '#fff' }], totalTokens: 5, maxTokens: 100, percentage: 5, model: 'claude' })),
    mockQueryMcpServerStatus: vi.fn(async () => []),
    mockQueryReconnectMcpServer: vi.fn(async () => {}),
    mockQueryToggleMcpServer: vi.fn(async () => {}),
    mockQueryReloadPlugins: vi.fn(async () => ({ commands: [], error_count: 0 })),
  }
  captured.createSessionQueryMock.mockImplementation(
    (bridge: unknown, opts: unknown, emit: (e: AgentEvent) => void, getMid: () => string, _getTs: () => number, getInterrupted: () => boolean, onSessionId: (id: string) => void, onQueuedTurnStart: (id: string) => void, onStepBoundary: () => void) => {
      captured.emit = emit
      captured.onSessionId = onSessionId
      captured.onQueuedTurnStart = onQueuedTurnStart
      captured.onStepBoundary = onStepBoundary
      captured.getInterrupted = getInterrupted
      captured.getCurrentMessageId = getMid
      captured.bridge = bridge
      let resolveIter: () => void = () => {}
      const promise = new Promise<void>((resolve) => { resolveIter = resolve })
      captured.iterationDone = { resolve: resolveIter, promise }
      captured.activeBackgroundTasks = new Map()
      return {
        activeBackgroundTasks: captured.activeBackgroundTasks,
        query: {
          interrupt: captured.mockQueryInterrupt,
          cancelAsyncMessage: captured.mockQueryCancelAsyncMessage,
          close: captured.mockQueryClose,
          setModel: captured.mockQuerySetModel,
          rewindFiles: captured.mockQueryRewindFiles,
          getContextUsage: captured.mockQueryGetContextUsage,
          mcpServerStatus: captured.mockQueryMcpServerStatus,
          reconnectMcpServer: captured.mockQueryReconnectMcpServer,
          toggleMcpServer: captured.mockQueryToggleMcpServer,
          reloadPlugins: captured.mockQueryReloadPlugins,
        },
        iterationDone: promise,
        spawnAbortController: (opts as { abortController?: AbortController }).abortController ?? new AbortController(),
      }
    }
  )
  return { captured }
})

vi.mock('../../agent/claude-query', () => ({
  createSessionQuery: hoisted.captured.createSessionQueryMock,
  buildClaudeOptions: hoisted.captured.buildClaudeOptionsMock,
  buildUserMessage: vi.fn((request: SendMessageRequest, sessionId: string) => ({
    type: 'user',
    message: { role: 'user', content: request.content },
    parent_tool_use_id: null,
    session_id: sessionId,
    priority: request.priority,
  })),
}))

vi.mock('../../agent/warmup-manager', () => {
  const SharedWarmupManager = Object.assign(class {
    prewarm = hoisted.captured.warmupPrewarm
    consume = () => null
    dispose = hoisted.captured.warmupDispose
  }, {
    keyOf: (opts: { __built?: { model?: string; effort?: string; permissionMode?: string; resume?: string } } & { model?: string; effort?: string; permissionMode?: string; resume?: string }) => {
      const o = opts?.__built ?? opts
      return JSON.stringify({ m: o?.model ?? '', e: o?.effort ?? '', p: o?.permissionMode ?? '', r: o?.resume ?? '' })
    },
  })
  const singleton = new SharedWarmupManager()
  return {
    WarmupManager: SharedWarmupManager,
    getGlobalWarmupManager: () => singleton,
    disposeGlobalWarmupManager: () => singleton.dispose(),
  }
})

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

const proxyHoisted = vi.hoisted(() => ({
  ensureProxyMock: vi.fn(async () => ({ url: 'http://127.0.0.1:45001', port: 45001 })),
}))

vi.mock('../../providers/llm-proxy-manager', () => ({
  ensureProxy: proxyHoisted.ensureProxyMock,
}))

vi.mock('../../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({})),
  dedupePath: vi.fn((p: string) => p),
}))

const permissionHoisted = vi.hoisted(() => ({
  createCanUseToolMock: vi.fn(() => ({ canUseTool: vi.fn(), trackPlanFile: vi.fn() })),
  rejectAllPendingMock: vi.fn(),
}))

vi.mock('../../agent/claude-permissions', () => ({
  createCanUseTool: permissionHoisted.createCanUseToolMock,
  createOnElicitation: vi.fn(() => vi.fn()),
  respondToElicitation: vi.fn(),
  respondToPermission: vi.fn(),
  respondToQuestion: vi.fn(),
  dismissQuestion: vi.fn(),
  respondToPlanApproval: vi.fn(),
  rejectAllPending: permissionHoisted.rejectAllPendingMock,
}))


export function makeStartOpts() {
  return {
    sessionId: 'sess-test',
    projectPath: '/tmp/proj',
    cwd: '/tmp/proj',
    config: { apiKey: 'sk-test' },
    permissionMode: 'default' as const,
    abortController: new AbortController(),
  }
}


export { hoisted, proxyHoisted, permissionHoisted }
