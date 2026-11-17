import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

const cacheStore = new Map<string, unknown>()

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../database', () => ({
  getCachedHarnessResources: vi.fn((id: string) => cacheStore.get(id) ?? null),
  setCachedHarnessResources: vi.fn((id: string, value: unknown) => {
    cacheStore.set(id, value)
  }),
}))
vi.mock('../usage-stats-service', () => ({
  recordAntigravityFromUsage: vi.fn(),
  recordGrokFromUsage: vi.fn(),
  subtractDelta: (a: Record<string, number>, b: Record<string, number>) => ({
    inputTokens: (a.inputTokens ?? 0) - (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) - (b.outputTokens ?? 0),
    cacheReadTokens: (a.cacheReadTokens ?? 0) - (b.cacheReadTokens ?? 0),
    cacheCreationTokens: 0,
  }),
}))
vi.mock('../computer-use/grant-request', () => ({
  resolveComputerUseGrant: () => false,
  rejectComputerUseGrant: () => false,
}))
vi.mock('../mcp/terminal-tabs-harness-gate', () => ({
  gateTerminalTabsCall: vi.fn(),
}))

import { extractModelsFromNewSessionResult, extractModesFromNewSessionResult } from './acp-config'
import { readAcpResourcesCache, upsertAcpAgentConfig, upsertAcpAgentModes } from './acp-model-cache'
import type { AcpRuntime, AcpRuntimeOptions } from './acp-runtime'
import { AcpBackend, setAcpRuntimeFactory } from '../session/backends/acp-backend'

const HEALTHY_AGY_SESSION = {
  sessionId: 'agy-healthy-1',
  configOptions: [
    {
      id: 'model',
      name: 'Model',
      category: 'model' as const,
      type: 'select' as const,
      currentValue: 'gemini-4-carbon',
      options: [
        { value: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
        { value: 'gemini-pro-orchestrator', name: 'Orchestrator (Carbon)' },
        { value: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
      ],
    },
    {
      id: 'thought_level',
      name: 'Thinking Level',
      category: 'thought_level' as const,
      type: 'select' as const,
      currentValue: 'medium',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'medium', name: 'Medium' },
        { value: 'high', name: 'High' },
      ],
    },
    {
      id: 'mode',
      name: 'Mode',
      category: 'mode' as const,
      type: 'select' as const,
      currentValue: 'default',
      options: [
        { value: 'default', name: 'Default' },
        { value: 'accept-edits', name: 'Accept Edits' },
        { value: 'plan', name: 'Plan' },
      ],
    },
  ],
  models: {
    currentModelId: 'gemini-4-carbon-medium',
    availableModels: [
      { modelId: 'gemini-4-carbon-low', name: 'Carbon low' },
      { modelId: 'gemini-4-carbon-medium', name: 'Carbon medium' },
      { modelId: 'gemini-4-carbon-high', name: 'Carbon high' },
      { modelId: 'gemini-pro-orchestrator', name: 'Orchestrator (Carbon)' },
      { modelId: 'claude-sonnet-5-5-low', name: 'Sonnet low' },
      { modelId: 'claude-sonnet-5-5-medium', name: 'Sonnet medium' },
      { modelId: 'claude-sonnet-5-5-high', name: 'Sonnet high' },
    ],
  },
}

const DEGRADED_MODE_ONLY_OPTIONS = [
  {
    id: 'mode',
    name: 'Mode',
    category: 'mode' as const,
    type: 'select' as const,
    currentValue: 'default',
    options: [
      { value: 'default', name: 'Default' },
      { value: 'accept-edits', name: 'Accept Edits' },
      { value: 'plan', name: 'Plan' },
    ],
  },
]

function createStubRuntime(overrides: Partial<AcpRuntime> & { sessionId?: string }): AcpRuntime {
  return {
    sessionId: overrides.sessionId ?? 'agy-sess-1',
    launch: {
      agentId: 'antigravity',
      command: '/usr/local/bin/agy',
      args: ['acp'],
      cwd: '/repo',
      env: {},
      source: 'builtin',
    },
    getConfigOptions: () => [],
    getModelConfig: () => null,
    getModeConfig: () => null,
    setConfigOption: async () => [],
    setModel: async () => undefined,
    setPermissionMode: async () => undefined,
    setAcpSessionMode: async () => undefined,
    getContextUsage: async () => null,
    isSessionRecapAvailable: () => false,
    requestRecap: async () => undefined,
    prompt: async (_text, messageId, onEvent) => {
      onEvent({ type: 'content_delta', messageId, delta: { type: 'text', text: 'OK' } })
      onEvent({ type: 'message_complete', messageId })
      onEvent({ type: 'status_change', status: 'idle' })
    },
    cancel: async () => undefined,
    close: async () => undefined,
    interject: async () => undefined,
    compactConversation: async () => undefined,
    rewindPoints: async () => [],
    rewindExecute: async () => ({ rewound: false }),
    updateMcpServers: async () => undefined,
    allowsProjectMcp: () => true,
    authenticateMcp: async () => undefined,
    getSessionUsage: async () => null,
    getAgentCapabilities: () => null,
    ...overrides,
  }
}

beforeEach(() => {
  cacheStore.clear()
})

afterEach(() => {
  setAcpRuntimeFactory(null)
})

describe('Antigravity degraded model catalog and background lifecycle guards', () => {
  it('preserves cached model and effort configOptions when a degraded session returns mode-only configOptions', () => {
    const modelCfg = extractModelsFromNewSessionResult(HEALTHY_AGY_SESSION)!
    const modeCfg = extractModesFromNewSessionResult(HEALTHY_AGY_SESSION)!
    upsertAcpAgentConfig('antigravity', HEALTHY_AGY_SESSION.configOptions, modelCfg, modeCfg)
    upsertAcpAgentModes('antigravity', modeCfg)

    upsertAcpAgentConfig('antigravity', DEGRADED_MODE_ONLY_OPTIONS, null, null)

    const cached = readAcpResourcesCache()
    const antiCfg = cached.configByAgentId?.antigravity
    expect(antiCfg?.configOptions.some((o) => o.id === 'model')).toBe(true)
    expect(antiCfg?.configOptions.some((o) => o.id === 'thought_level')).toBe(true)
    const orchestrator = cached.modelsByAgentId?.antigravity?.models.find(
      (m) => m.id === 'gemini-pro-orchestrator',
    )
    expect(orchestrator).toBeDefined()
    expect(orchestrator?.supportsEffort).toBe(false)
  })

  it('respawns a degraded prewarmed runtime with models=0 before running orchestrator prompt', async () => {
    let spawnCount = 0
    const closedIds: string[] = []
    const setConfigCalls: Array<{ id: string; val: string }> = []
    const healthyModels = extractModelsFromNewSessionResult(HEALTHY_AGY_SESSION)!

    setAcpRuntimeFactory(async (opts: AcpRuntimeOptions) => {
      spawnCount += 1
      if (spawnCount === 1) {
        return createStubRuntime({
          sessionId: 'degraded-sess-0',
          getConfigOptions: () => DEGRADED_MODE_ONLY_OPTIONS as never,
          getModelConfig: () => null,
          setModel: async (m) => {
            throw new Error(`Unknown model ID: ${m}`)
          },
          close: async () => {
            closedIds.push('degraded-sess-0')
          },
        })
      }
      expect(opts.resumeSessionId).toBeUndefined()
      let selectedModel = 'gemini-4-carbon'
      return createStubRuntime({
        sessionId: 'healthy-sess-2',
        getConfigOptions: () =>
          HEALTHY_AGY_SESSION.configOptions
            .filter((o) => selectedModel !== 'gemini-pro-orchestrator' || o.id !== 'thought_level')
            .map((o) => (o.id === 'model' ? { ...o, currentValue: selectedModel } : o)) as never,
        getModelConfig: () => ({ ...healthyModels, selectedModelId: selectedModel }),
        setConfigOption: async (id, val) => {
          setConfigCalls.push({ id, val })
          if (id === 'model') selectedModel = val
          return HEALTHY_AGY_SESSION.configOptions
            .filter((o) => selectedModel !== 'gemini-pro-orchestrator' || o.id !== 'thought_level')
            .map((o) => (o.id === 'model' ? { ...o, currentValue: selectedModel } : o)) as never
        },
      })
    })

    const backend = new AcpBackend('acp-antigravity')
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))

    await backend.start({
      sessionId: 'super-sess-1',
      projectPath: '/repo',
      model: 'gemini-pro-orchestrator',
      config: { agentId: 'antigravity' },
    })
    await vi.waitFor(() => expect(spawnCount).toBe(1))

    await backend.send({
      content: 'Check issue 204',
      assistantMessageId: 'msg-orch-1',
      model: 'gemini-pro-orchestrator',
    })

    expect(spawnCount).toBe(2)
    expect(closedIds).toEqual(['degraded-sess-0'])
    expect(setConfigCalls).toEqual([{ id: 'model', val: 'gemini-pro-orchestrator' }])
    expect(events.some((e) => e.type === 'message_complete' && e.messageId === 'msg-orch-1')).toBe(true)
    expect(events.some((e) => e.type === 'message_error')).toBe(false)

    await backend.close()
  })

  it('surfaces a clear Cloud Code model catalog error and tears down runtime instead of running prompt with no plan model', async () => {
    let promptCalled = false
    let closedCount = 0

    setAcpRuntimeFactory(async () =>
      createStubRuntime({
        sessionId: 'degraded-always',
        getConfigOptions: () => DEGRADED_MODE_ONLY_OPTIONS as never,
        getModelConfig: () => null,
        setModel: async (m) => {
          throw new Error(`Unknown model ID: ${m}`)
        },
        prompt: async () => {
          promptCalled = true
        },
        close: async () => {
          closedCount += 1
        },
      }),
    )

    const backend = new AcpBackend('acp-antigravity')
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))

    await backend.start({
      sessionId: 'super-sess-2',
      projectPath: '/repo',
      model: 'gemini-pro-orchestrator',
      config: { agentId: 'antigravity' },
    })
    await backend.send({
      content: 'Check issue 204',
      assistantMessageId: 'msg-orch-err',
      model: 'gemini-pro-orchestrator',
    })

    expect(promptCalled).toBe(false)
    expect(closedCount).toBeGreaterThanOrEqual(2)
    const errEvent = events.find((e): e is Extract<AgentEvent, { type: 'message_error' }> => e.type === 'message_error')
    expect(errEvent?.error).toContain('gemini-pro-orchestrator')
    expect(errEvent?.error).toContain('Google Cloud Code')
    expect(backend.hasActiveRuntime()).toBe(false)

    await backend.close()
  })

  it('keeps runtime pinned across empty-taskId subagent spawn and backgroundWatch, and attaches AskUserQuestion to agentWakeMessageId', async () => {
    let bgActive = false
    let runtimeClosed = false
    let capturedOpts: AcpRuntimeOptions | null = null

    setAcpRuntimeFactory(async (opts) => {
      capturedOpts = opts
      return createStubRuntime({
        sessionId: 'agy-pin-1',
        hasActiveBackgroundWork: () => bgActive,
        close: async () => {
          runtimeClosed = true
        },
      })
    })

    const backend = new AcpBackend('acp-antigravity')
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))

    await backend.start({
      sessionId: 'super-sess-pin',
      projectPath: '/repo',
      permissionMode: 'default',
      config: { agentId: 'antigravity' },
    })
    await vi.waitFor(() => expect(capturedOpts).not.toBeNull())

    capturedOpts!.onSessionEvent?.({
      type: 'task_started',
      taskId: '',
      toolUseId: 'call_sub_init',
      description: 'Researcher',
      isBackgrounded: true,
    })
    expect(backend.hasActiveBackgroundTasks()).toBe(true)
    await backend.releaseRuntime('idle')
    expect(runtimeClosed).toBe(false)

    capturedOpts!.onSessionEvent?.({
      type: 'task_started',
      taskId: 'conv-bound-1',
      toolUseId: 'call_sub_init',
      taskType: 'local_agent',
      description: 'Researcher',
      isBackgrounded: true,
    })
    capturedOpts!.onSessionEvent?.({
      type: 'task_notification',
      taskId: 'conv-bound-1',
      toolUseId: 'call_sub_init',
      taskStatus: 'completed',
      outputFile: '',
    })
    bgActive = true
    expect(backend.hasActiveBackgroundTasks()).toBe(true)
    await backend.setPermissionMode('auto')
    expect(runtimeClosed).toBe(false)

    capturedOpts!.onSessionEvent?.({
      type: 'message_start',
      message: {
        id: 'acp_wake_test_1',
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'acp',
      },
    })

    const askPromise = capturedOpts!.askUserQuestion!.request({
      toolCallId: 'call_wake_q1',
      questions: [
        {
          id: 'q0',
          header: 'Question',
          question: 'Continue deploy?',
          multiSelect: false,
          options: [{ label: 'Yes', description: '' }],
        },
      ],
    })

    const askEvent = events.find((e): e is Extract<AgentEvent, { type: 'ask_user_question' }> => e.type === 'ask_user_question')
    expect(askEvent).toBeDefined()
    expect(
      events.some(
        (e) =>
          e.type === 'content_delta' &&
          e.messageId === 'acp_wake_test_1' &&
          e.delta.type === 'tool_use' &&
          e.delta.toolName === 'AskUserQuestion',
      ),
    ).toBe(true)

    backend.respondToQuestion(askEvent!.request.requestId, { 'Continue deploy?': 'Yes' })
    await askPromise

    expect(
      events.some(
        (e) =>
          e.type === 'content_delta' &&
          e.messageId === 'acp_wake_test_1' &&
          e.delta.type === 'tool_result' &&
          e.delta.toolUseId === 'call_wake_q1',
      ),
    ).toBe(true)

    bgActive = false
    capturedOpts!.onSessionEvent?.({ type: 'message_complete', messageId: 'acp_wake_test_1' })
    capturedOpts!.onSessionEvent?.({ type: 'status_change', status: 'idle' })
    expect(backend.hasActiveBackgroundTasks()).toBe(false)

    await backend.close()
  })
})
