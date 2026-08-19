import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

// acp-runtime reaches resolve-cli (for the MCP bridge node runtime), which imports electron.
vi.mock('../../agent/resolve-cli', () => ({
  getNodeRuntime: () => ({ executable: '/fake/node', env: {} }),
}))

const { recordGrokFromUsageMock } = vi.hoisted(() => ({
  recordGrokFromUsageMock: vi.fn(),
}))
vi.mock('../../usage-stats-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../usage-stats-service')>()
  return {
    ...actual,
    recordGrokFromUsage: recordGrokFromUsageMock,
  }
})

import { AcpBackend, setAcpRuntimeFactory } from './acp-backend'
import type { AcpRuntimeOptions } from '../../acp/acp-runtime'
import { acpStartOpts as startOpts, mockAcpRuntime as mockRuntime } from '../../../test/fixtures/acp-backend-fixtures'

describe('AcpBackend', () => {
  beforeEach(() => {
    recordGrokFromUsageMock.mockClear()
    setAcpRuntimeFactory(async () => mockRuntime())
  })

  afterEach(() => {
    setAcpRuntimeFactory(null)
  })

  it('starts and reports kind acp', async () => {
    const backend = new AcpBackend()
    expect(backend.kind).toBe('acp')
    await backend.start(startOpts({ agentId: 'grok-build' }))
    await backend.close()
  })

  it('passes startOpts.effort as session/new reasoningEffort', async () => {
    let captured: AcpRuntimeOptions | undefined
    setAcpRuntimeFactory(async (opts) => {
      captured = opts
      return mockRuntime()
    })
    const backend = new AcpBackend()
    await backend.start({ ...startOpts({ agentId: 'grok-build' }), effort: 'xhigh' })
    expect(captured?.reasoningEffort).toBe('xhigh')
    expect(captured?.consentNotice).toBeDefined()
    await backend.close()
  })

  it('stamps setSessionMode effort even when picked before runtime exists', async () => {
    let captured: AcpRuntimeOptions | undefined
    setAcpRuntimeFactory(async (opts) => {
      captured = opts
      return mockRuntime()
    })
    const backend = new AcpBackend()
    await backend.setSessionMode('low')
    await backend.start({ ...startOpts({ agentId: 'grok-build' }), effort: 'ask' })
    expect(captured?.reasoningEffort).toBe('low')
    await backend.close()
  })

  it('ignores OpenCode mode ids as session/new reasoningEffort', async () => {
    let captured: AcpRuntimeOptions | undefined
    setAcpRuntimeFactory(async (opts) => {
      captured = opts
      return mockRuntime()
    })
    const backend = new AcpBackend()
    await backend.start({ ...startOpts({ agentId: 'opencode' }), effort: 'ask' })
    expect(captured?.reasoningEffort).toBeUndefined()
    await backend.close()
  })

  it('parks a consent notice as ask_user_question and resolves accept', async () => {
    let captured: AcpRuntimeOptions | undefined
    setAcpRuntimeFactory(async (opts) => {
      captured = opts
      return mockRuntime()
    })
    const backend = new AcpBackend()
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.start(startOpts({ agentId: 'grok-build' }))
    const pending = captured?.consentNotice?.request({
      id: 'tos',
      version: 2,
      title: 'Terms',
      body: 'Please accept.',
      acceptLabel: 'I agree',
    })
    const question = events.find((e): e is Extract<AgentEvent, { type: 'ask_user_question' }> =>
      e.type === 'ask_user_question')
    expect(question?.request.requestId).toBe('acp_consent_tos_2')
    expect(question?.request.questions[0]?.options[0]?.label).toBe('I agree')
    backend.respondToQuestion('acp_consent_tos_2', { 'Terms\n\nPlease accept.': 'I agree' })
    await expect(pending).resolves.toBe(true)
    await backend.close()
  })

  it('prefetches Grok billing once the runtime is ready', async () => {
    const getRateLimits = vi.fn(async () => ({
      title: 'Grok Build',
      planType: 'SuperGrok Heavy',
      windows: [{ label: 'Weekly limit', usedPercent: 0, resetsAt: null }],
      extraUsage: null,
      fetchedAt: 1,
    }))
    setAcpRuntimeFactory(async () => mockRuntime({ getRateLimits }))
    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'grok-build' }))
    await vi.waitFor(() => expect(getRateLimits).toHaveBeenCalledTimes(1))
    await backend.close()
  })

  it('records Grok turn usage with the selected model', async () => {
    setAcpRuntimeFactory(async () => mockRuntime({
      getConfigOptions: () => [],
      getModelConfig: () => ({
        configId: null,
        selectedModelId: 'grok-4.5',
        models: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
      }),
      prompt: async (_text, messageId, onEvent) => {
        onEvent({ type: 'agent_setting_change', selectedModel: 'grok-4.6' })
        onEvent({
          type: 'message_usage',
          messageId,
          inputTokens: 800,
          outputTokens: 300,
          cacheReadTokens: 400,
        })
        onEvent({ type: 'message_complete', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))
    const backend = new AcpBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))

    await backend.start(startOpts({ agentId: 'grok-build' }))
    await backend.send({ content: 'hello', assistantMessageId: 'a1' })

    expect(recordGrokFromUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 800, outputTokens: 300, cacheReadTokens: 400 }),
      'grok-4.6',
      expect.any(Date),
    )
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message_usage',
      messageId: 'a1',
      model: 'grok-4.6',
    }))
    await backend.close()
  })

  it('records only deltas across cumulative mid-turn Grok message_usage events', async () => {
    setAcpRuntimeFactory(async () => mockRuntime({
      getConfigOptions: () => [],
      getModelConfig: () => ({
        configId: null,
        selectedModelId: 'grok-4.5',
        models: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
      }),
      prompt: async (_text, messageId, onEvent) => {
        // Provisional response_started-style cumulative snapshot
        onEvent({
          type: 'message_usage',
          messageId,
          inputTokens: 1000,
          outputTokens: 0,
          cacheReadTokens: 200,
        })
        // First response_completed (same totals + output)
        onEvent({
          type: 'message_usage',
          messageId,
          inputTokens: 1000,
          outputTokens: 150,
          cacheReadTokens: 200,
        })
        // Second response_completed (running cumulative)
        onEvent({
          type: 'message_usage',
          messageId,
          inputTokens: 1800,
          outputTokens: 200,
          cacheReadTokens: 300,
        })
        // Authoritative turn_completed (same absolute totals)
        onEvent({
          type: 'message_usage',
          messageId,
          inputTokens: 1800,
          outputTokens: 200,
          cacheReadTokens: 300,
        })
        onEvent({ type: 'message_complete', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))
    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'grok-build' }))
    await backend.send({ content: 'hello', assistantMessageId: 'a1' })

    expect(recordGrokFromUsageMock.mock.calls.map((c) => c[0])).toEqual([
      { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 200 },
      { inputTokens: 0, outputTokens: 150, cacheReadTokens: 0 },
      { inputTokens: 800, outputTokens: 50, cacheReadTokens: 100 },
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    ])
    await backend.close()
  })

  it('releases an idle runtime through the shared runtime contract', async () => {
    const close = vi.fn(async () => {})
    setAcpRuntimeFactory(async () => mockRuntime({ close }))
    const backend = new AcpBackend()

    await backend.start(startOpts({ agentId: 'grok-build' }))
    await vi.waitFor(() => expect(backend.hasActiveRuntime()).toBe(true))
    await backend.releaseRuntime('idle')

    expect(close).toHaveBeenCalledOnce()
    expect(backend.hasActiveRuntime()).toBe(false)
  })

  it('waits for an old pending runtime to close without clearing a concurrent new runtime', async () => {
    const oldClose = vi.fn(async () => {})
    const newClose = vi.fn(async () => {})
    const oldRuntime = mockRuntime({ close: oldClose })
    const newRuntime = mockRuntime({ sessionId: 'acp-sess-2', close: newClose })
    let resolveOld!: (value: AcpRuntime) => void
    let callCount = 0
    setAcpRuntimeFactory(async () => {
      callCount += 1
      if (callCount === 1) return new Promise<AcpRuntime>((resolve) => { resolveOld = resolve })
      return newRuntime
    })
    const backend = new AcpBackend()

    await backend.start(startOpts({ agentId: 'grok-build' }))
    let releaseFinished = false
    const release = backend.releaseRuntime('idle').then(() => { releaseFinished = true })
    await backend.start(startOpts({ agentId: 'grok-build' }))
    await vi.waitFor(() => expect(callCount).toBe(2))
    expect(releaseFinished).toBe(false)

    resolveOld(oldRuntime)
    await release

    expect(oldClose).toHaveBeenCalledOnce()
    expect(newClose).not.toHaveBeenCalled()
    expect(backend.hasActiveRuntime()).toBe(true)
  })

  it('aborts a runtime initialization that never settles on its own', async () => {
    let aborted = false
    setAcpRuntimeFactory(async (opts) => new Promise<AcpRuntime>((_resolve, reject) => {
      opts.signal?.addEventListener('abort', () => {
        aborted = true
        reject(new Error('aborted'))
      }, { once: true })
    }))
    const backend = new AcpBackend()

    await backend.start(startOpts({ agentId: 'grok-build' }))
    await backend.releaseRuntime('idle')

    expect(aborted).toBe(true)
    expect(backend.hasActiveRuntime()).toBe(false)
  })

  it('emits provider_session_id so the renderer can copy the real agent id', async () => {
    const backend = new AcpBackend()
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    const viaListener: string[] = []
    backend.onProviderSessionId((id) => viaListener.push(id))

    // start() spawns the runtime fire-and-forget; let it settle.
    await backend.start(startOpts({ agentId: 'grok-build' }))
    await new Promise((r) => setTimeout(r, 10))

    // The DB path (listener) and the renderer path (event) must both carry the id.
    expect(viaListener).toEqual(['acp-sess-1'])
    expect(events).toContainEqual({ type: 'provider_session_id', providerSessionId: 'acp-sess-1' })
    await backend.close()
  })

  it('passes the SuperOne session id to the runtime so the MCP bridge is session-scoped', async () => {
    let seen: string | undefined = 'unset'
    setAcpRuntimeFactory(async (opts) => {
      seen = opts.superoneSessionId
      return mockRuntime()
    })
    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'grok-build' }))
    await new Promise((r) => setTimeout(r, 10))
    expect(seen).toBe('sess-1')
    await backend.close()
  })

  it('passes providerSessionId as resumeSessionId so Grok can session/load', async () => {
    let resume: string | undefined = 'unset'
    setAcpRuntimeFactory(async (opts) => {
      resume = opts.resumeSessionId
      return mockRuntime({ sessionId: 'prior-grok-session' })
    })
    const backend = new AcpBackend()
    await backend.start({
      ...startOpts({ agentId: 'grok-build' }),
      providerSessionId: 'prior-grok-session',
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(resume).toBe('prior-grok-session')
    await backend.close()
  })

  it('restarts once when a cold prewarm lacked resume and start later supplies it', async () => {
    const factories: string[] = []
    setAcpRuntimeFactory(async (opts) => {
      factories.push(opts.resumeSessionId ?? '(none)')
      if (!opts.resumeSessionId) {
        return mockRuntime({ sessionId: 'stale-new-id' })
      }
      return mockRuntime({ sessionId: opts.resumeSessionId })
    })
    const backend = new AcpBackend()
    // Cold prewarm without provider session id (draft / race before DB hydrate).
    await backend.start(startOpts({ agentId: 'grok-build' }))
    await new Promise((r) => setTimeout(r, 10))
    expect(factories[0]).toBe('(none)')
    // Later start with the stored resume id must force one session/load restart.
    await backend.start({
      ...startOpts({ agentId: 'grok-build' }),
      providerSessionId: 'prior-grok-session',
    })
    await backend.send({ content: 'hello', assistantMessageId: 'a1' })
    expect(factories.length).toBeGreaterThanOrEqual(2)
    expect(factories[factories.length - 1]).toBe('prior-grok-session')
    await backend.close()
  })

  it('does not re-spawn when session/load already failed for the wanted resume id', async () => {
    const factories: string[] = []
    setAcpRuntimeFactory(async (opts) => {
      factories.push(opts.resumeSessionId ?? '(none)')
      // Simulate load failure: agent was asked to resume but minted a new id.
      return mockRuntime({ sessionId: `new-${factories.length}` })
    })
    const backend = new AcpBackend()
    await backend.start({
      ...startOpts({ agentId: 'grok-build' }),
      providerSessionId: 'unloadable-prior',
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(factories).toEqual(['unloadable-prior'])
    // Second ensureRuntime (send) must accept the live id — not mint another session.
    await backend.send({ content: 'hello', assistantMessageId: 'a1' })
    expect(factories).toEqual(['unloadable-prior'])
    await backend.close()
  })

  it('emits acp_modes from configOptions and setSessionMode updates selection', async () => {
    const setConfigOption = vi.fn(async (_id: string, value: string) => [
      {
        id: 'mode',
        name: 'Session Mode',
        category: 'mode' as const,
        type: 'select' as const,
        currentValue: value,
        options: [
          { value: 'ask', name: 'Ask' },
          { value: 'code', name: 'Code' },
        ],
      },
    ])
    setAcpRuntimeFactory(async () => mockRuntime({ setConfigOption }))
    const backend = new AcpBackend()
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.start(startOpts({ agentId: 'custom', command: 'mock' }))
    await backend.send({ content: 'hi', assistantMessageId: 'm1' })

    const readyModes = events.filter((e): e is Extract<AgentEvent, { type: 'acp_modes' }> =>
      e.type === 'acp_modes' && e.status === 'ready' && e.modes.length > 0)
    expect(readyModes.length).toBeGreaterThan(0)
    expect(readyModes[0]?.selectedModeId).toBe('ask')
    expect(readyModes[0]?.configId).toBe('mode')

    events.length = 0
    await backend.setSessionMode('code')
    expect(setConfigOption).toHaveBeenCalledWith('mode', 'code')
    const after = events.find((e): e is Extract<AgentEvent, { type: 'acp_modes' }> =>
      e.type === 'acp_modes' && e.selectedModeId === 'code')
    expect(after?.modes.map((m) => m.id)).toEqual(['ask', 'code'])
    await backend.close()
  })

  it('setModel uses session/set_model when model configId is null (Grok path)', async () => {
    const setModel = vi.fn(async () => {})
    const setConfigOption = vi.fn(async () => [])
    setAcpRuntimeFactory(async () => mockRuntime({
      getModelConfig: () => ({
        configId: null,
        selectedModelId: 'grok-4.5',
        models: [
          { id: 'grok-4.5', name: 'Grok 4.5', description: '' },
          { id: 'composer', name: 'Composer', description: '' },
        ],
      }),
      getModeConfig: () => ({
        configId: null,
        selectedModeId: 'high',
        modes: [
          { id: 'low', name: 'Low', description: '' },
          { id: 'high', name: 'High', description: '' },
        ],
      }),
      getConfigOptions: () => [],
      setModel,
      setConfigOption,
    }))
    const backend = new AcpBackend()
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.start(startOpts({ agentId: 'grok-build' }))
    await new Promise((r) => setTimeout(r, 10))

    events.length = 0
    await backend.setModel('composer')
    // Grok effort (lastModeConfig selectedModeId=high) must ride along set_model
    expect(setModel).toHaveBeenCalledWith('composer', { reasoningEffort: 'high' })
    expect(setConfigOption).not.toHaveBeenCalled()
    const modelEvt = events.find((e): e is Extract<AgentEvent, { type: 'acp_models' }> =>
      e.type === 'acp_models' && e.selectedModelId === 'composer')
    expect(modelEvt?.configId).toBeNull()
    expect(modelEvt?.models.map((m) => m.id)).toEqual(['grok-4.5', 'composer'])
    await backend.close()
  })

  it('setSessionMode uses set_model + reasoningEffort when mode configId is null', async () => {
    const setModel = vi.fn(async () => {})
    setAcpRuntimeFactory(async () => mockRuntime({
      getModelConfig: () => ({
        configId: null,
        selectedModelId: 'grok-4.5',
        models: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
      }),
      getModeConfig: () => ({
        configId: null,
        selectedModeId: 'medium',
        modes: [
          { id: 'low', name: 'Low', description: '' },
          { id: 'medium', name: 'Medium', description: '' },
          { id: 'high', name: 'High', description: '' },
        ],
      }),
      getConfigOptions: () => [],
      setModel,
    }))
    const backend = new AcpBackend()
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.start(startOpts({ agentId: 'grok-build' }))
    await new Promise((r) => setTimeout(r, 10))

    events.length = 0
    await backend.setSessionMode('high')
    expect(setModel).toHaveBeenCalledWith('grok-4.5', { reasoningEffort: 'high' })
    const modeEvt = events.find((e): e is Extract<AgentEvent, { type: 'acp_modes' }> =>
      e.type === 'acp_modes' && e.selectedModeId === 'high')
    expect(modeEvt?.configId).toBeNull()
    expect(modeEvt?.modes.map((m) => m.id)).toEqual(['low', 'medium', 'high'])
    await backend.close()
  })

  it('send applies request.effort as set_model reasoningEffort when modeConfigId is null', async () => {
    const setModel = vi.fn(async () => {})
    setAcpRuntimeFactory(async () => mockRuntime({
      getModelConfig: () => ({
        configId: null,
        selectedModelId: 'grok-4.5',
        models: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
      }),
      getModeConfig: () => ({
        configId: null,
        // Agent default selection empty — turn effort must still win
        selectedModeId: '',
        modes: [
          { id: 'low', name: 'Low', description: '' },
          { id: 'high', name: 'High', description: '' },
        ],
      }),
      getConfigOptions: () => [],
      setModel,
    }))
    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'grok-build' }))
    await new Promise((r) => setTimeout(r, 10))

    await backend.send({
      content: 'ping',
      model: 'grok-4.5',
      effort: 'high',
    })
    expect(setModel).toHaveBeenCalledWith('grok-4.5', { reasoningEffort: 'high' })
    await backend.close()
  })

  it('emits message_error when agent is not configured', async () => {
    const backend = new AcpBackend()
    await backend.start(startOpts({}))
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.send({ content: 'hi' })
    expect(events.some((e) => e.type === 'message_error')).toBe(true)
    const err = events.find((e) => e.type === 'message_error')
    expect(err && err.type === 'message_error' ? err.error : '').toMatch(/No ACP agent configured/)
    await backend.close()
  })

  it('streams prompt through runtime when agent is configured', async () => {
    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'custom', command: 'mock' }))
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.send({ content: 'hi', assistantMessageId: 'a1' })

    expect(events.some((e) => e.type === 'message_start')).toBe(true)
    const text = events
      .filter((e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta')
      .map((e) => e.delta)
      .filter((d): d is { type: 'text'; text: string } => d.type === 'text')
      .map((d) => d.text)
      .join('')
    expect(text).toContain('hello-from-mock')
    expect(events.some((e) => e.type === 'message_complete')).toBe(true)
    await backend.close()
  })

  it('auto-allows SuperOne built-in MCP tools without emitting permission_request', async () => {
    setAcpRuntimeFactory(async (opts) => mockRuntime({
      prompt: async (_text, messageId, onEvent) => {
        const response = await opts.permission.request({
          sessionId: 'acp-sess-1',
          toolCall: {
            toolCallId: 'tc-rename',
            title: 'use_tool',
            kind: 'other',
            rawInput: {
              tool_name: 'superone__session_rename',
              tool_input: { title: 'Hello' },
            },
            _meta: {
              'x.ai/tool': { name: 'use_tool', kind: 'use_tool', namespace: 'grok_build' },
            },
          },
          options: [
            { optionId: 'allow-always-mcp', name: 'Always allow', kind: 'allow_always' },
            { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Deny', kind: 'reject_once' },
          ],
        } as never)
        onEvent({
          type: 'content_delta',
          messageId,
          delta: { type: 'text', text: JSON.stringify(response) },
        })
        onEvent({ type: 'message_complete', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))

    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'grok-build' }))
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.send({ content: 'rename', assistantMessageId: 'a-rename' })

    expect(events.some((e) => e.type === 'permission_request')).toBe(false)
    const text = events
      .filter((e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta')
      .map((e) => e.delta)
      .filter((d): d is { type: 'text'; text: string } => d.type === 'text')
      .map((d) => d.text)
      .join('')
    // session_rename is main-thread-only: allow-once so Grok children cannot inherit a grant.
    expect(JSON.parse(text)).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    })
    await backend.close()
  })

  it('denies session_tag from a Grok child session without a permission_request UI', async () => {
    setAcpRuntimeFactory(async (opts) => mockRuntime({
      prompt: async (_text, messageId, onEvent) => {
        const response = await opts.permission.request({
          sessionId: 'grok-child-sess',
          toolCall: {
            toolCallId: 'tc-tag',
            title: 'use_tool',
            kind: 'other',
            rawInput: {
              tool_name: 'superone__session_tag',
              tool_input: { add: ['subagent-should-fail'] },
            },
            _meta: {
              'x.ai/tool': { name: 'use_tool', kind: 'use_tool', namespace: 'grok_build' },
            },
          },
          options: [
            { optionId: 'allow-always-mcp', name: 'Always allow', kind: 'allow_always' },
            { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Deny', kind: 'reject_once' },
          ],
        } as never)
        onEvent({
          type: 'content_delta',
          messageId,
          delta: { type: 'text', text: JSON.stringify(response) },
        })
        onEvent({ type: 'message_complete', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))

    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'grok-build' }))
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.send({ content: 'tag', assistantMessageId: 'a-tag' })

    expect(events.some((e) => e.type === 'permission_request')).toBe(false)
    const text = events
      .filter((e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta')
      .map((e) => e.delta)
      .filter((d): d is { type: 'text'; text: string } => d.type === 'text')
      .map((d) => d.text)
      .join('')
    expect(JSON.parse(text)).toEqual({
      outcome: { outcome: 'selected', optionId: 'reject-once' },
    })
    await backend.close()
  })

  it('forwards setPermissionMode to the runtime', async () => {
    const setPermissionMode = vi.fn(async () => {})
    setAcpRuntimeFactory(async () => mockRuntime({ setPermissionMode }))
    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'grok-build' }))
    await new Promise((r) => setTimeout(r, 10))
    await backend.setPermissionMode('bypassPermissions')
    expect(setPermissionMode).toHaveBeenCalledWith('bypassPermissions')
    await backend.close()
  })

  it('recreates the ACP runtime when rebuild switches cwd (worktree)', async () => {
    const cwds: string[] = []
    let closeCount = 0
    setAcpRuntimeFactory(async (opts) => {
      const cwd = opts.launch.cwd || opts.launch.defaultCwd
      cwds.push(cwd)
      return mockRuntime({
        launch: {
          agentId: 'grok-build',
          command: 'grok',
          args: ['agent', 'stdio'],
          env: {},
          cwd,
        },
        close: async () => { closeCount += 1 },
      })
    })
    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'grok-build' }))
    await new Promise((r) => setTimeout(r, 15))
    expect(cwds).toEqual(['/tmp/proj'])

    await backend.rebuild({
      ...startOpts({ agentId: 'grok-build' }),
      cwd: '/tmp/proj/.worktrees/feat',
    })
    await new Promise((r) => setTimeout(r, 15))
    expect(closeCount).toBeGreaterThanOrEqual(1)
    expect(cwds.at(-1)).toBe('/tmp/proj/.worktrees/feat')

    // Same agent + same cwd: do not spawn a third process
    const before = cwds.length
    await backend.send({ content: 'hi', assistantMessageId: 'm-wt' })
    expect(cwds.length).toBe(before)
    await backend.close()
  })

  it('prewarm restarts runtime when cwd changes to a worktree', async () => {
    const cwds: string[] = []
    setAcpRuntimeFactory(async (opts) => {
      const cwd = opts.launch.cwd || opts.launch.defaultCwd
      cwds.push(cwd)
      return mockRuntime({
        launch: {
          agentId: 'grok-build',
          command: 'grok',
          args: [],
          env: {},
          cwd,
        },
      })
    })
    const backend = new AcpBackend()
    backend.prewarm(startOpts({ agentId: 'grok-build' }))
    await new Promise((r) => setTimeout(r, 15))
    expect(cwds).toEqual(['/tmp/proj'])

    backend.prewarm({
      ...startOpts({ agentId: 'grok-build' }),
      cwd: '/tmp/proj/.worktrees/feat',
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(cwds.at(-1)).toBe('/tmp/proj/.worktrees/feat')
    await backend.close()
  })

  it('forwards ask_user_question answers to the Grok extension gate', async () => {
    setAcpRuntimeFactory(async (opts) => mockRuntime({
      prompt: async (_text, messageId, onEvent) => {
        const response = await opts.askUserQuestion!.request({
          sessionId: 'acp-sess-1',
          toolCallId: 'ask-1',
          questions: [{
            question: 'Pick?',
            options: [
              { label: 'One', description: 'first' },
              { label: 'Two', description: 'second' },
            ],
          }],
        })
        onEvent({
          type: 'content_delta',
          messageId,
          delta: {
            type: 'text',
            text: JSON.stringify(response),
          },
        })
        onEvent({ type: 'message_complete', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))

    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'custom', command: 'mock' }))
    const events: AgentEvent[] = []
    backend.onEvent((e) => {
      events.push(e)
      if (e.type === 'ask_user_question') {
        backend.respondToQuestion(e.request.requestId, { 'Pick?': 'One' })
      }
    })
    await backend.send({ content: 'ask', assistantMessageId: 'a-ask' })
    const text = events
      .filter((e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta')
      .map((e) => e.delta)
      .filter((d): d is { type: 'text'; text: string } => d.type === 'text')
      .map((d) => d.text)
      .join('')
    expect(JSON.parse(text)).toEqual({
      outcome: 'accepted',
      answers: { 'Pick?': ['One'] },
    })
    expect(events.some((e) => e.type === 'ask_user_question')).toBe(true)
    expect(backend.getPendingInteractions()).toEqual([])
    await backend.close()
  })

  it('dismisses ask_user_question as cancelled', async () => {
    setAcpRuntimeFactory(async (opts) => mockRuntime({
      prompt: async (_text, messageId, onEvent) => {
        const response = await opts.askUserQuestion!.request({
          toolCallId: 'ask-2',
          questions: [{ question: 'Q?', options: [{ label: 'A', description: '' }] }],
        })
        onEvent({
          type: 'content_delta',
          messageId,
          delta: { type: 'text', text: JSON.stringify(response) },
        })
        onEvent({ type: 'message_complete', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))

    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'custom', command: 'mock' }))
    const events: AgentEvent[] = []
    backend.onEvent((e) => {
      events.push(e)
      if (e.type === 'ask_user_question') {
        backend.dismissQuestion(e.request.requestId)
      }
    })
    await backend.send({ content: 'ask', assistantMessageId: 'a-dismiss' })
    const text = events
      .filter((e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta')
      .map((e) => e.delta)
      .filter((d): d is { type: 'text'; text: string } => d.type === 'text')
      .map((d) => d.text)
      .join('')
    expect(JSON.parse(text)).toEqual({ outcome: 'cancelled' })
    await backend.close()
  })

  it('forwards exit_plan_mode approval to Grok outcome=approved', async () => {
    setAcpRuntimeFactory(async (opts) => mockRuntime({
      prompt: async (_text, messageId, onEvent) => {
        const response = await opts.exitPlanMode!.request({
          sessionId: 'acp-sess-1',
          toolCallId: 'plan-1',
          planContent: '# Ship it\n\n1. Test\n2. Deploy',
        })
        onEvent({
          type: 'content_delta',
          messageId,
          delta: { type: 'text', text: JSON.stringify(response) },
        })
        onEvent({ type: 'message_complete', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))

    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'grok-build' }))
    const events: AgentEvent[] = []
    backend.onEvent((e) => {
      events.push(e)
      if (e.type === 'plan_approval') {
        expect(e.request).toMatchObject({
          requestId: 'plan-1',
          planContent: '# Ship it\n\n1. Test\n2. Deploy',
          planFilePath: '',
        })
        backend.respondToPlanApproval(e.request.requestId, true)
      }
    })
    await backend.send({ content: 'exit plan', assistantMessageId: 'a-plan-ok' })
    const text = events
      .filter((e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta')
      .map((e) => e.delta)
      .filter((d): d is { type: 'text'; text: string } => d.type === 'text')
      .map((d) => d.text)
      .join('')
    expect(JSON.parse(text)).toEqual({ outcome: 'approved' })
    expect(events.some((e) => e.type === 'plan_approval')).toBe(true)
    expect(backend.getPendingInteractions()).toEqual([])
    await backend.close()
  })

  it('forwards exit_plan_mode rejection with feedback as outcome=cancelled', async () => {
    setAcpRuntimeFactory(async (opts) => mockRuntime({
      prompt: async (_text, messageId, onEvent) => {
        const response = await opts.exitPlanMode!.request({
          toolCallId: 'plan-2',
          planContent: 'thin plan',
        })
        onEvent({
          type: 'content_delta',
          messageId,
          delta: { type: 'text', text: JSON.stringify(response) },
        })
        onEvent({ type: 'message_complete', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))

    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'grok-build' }))
    const events: AgentEvent[] = []
    backend.onEvent((e) => {
      events.push(e)
      if (e.type === 'plan_approval') {
        backend.respondToPlanApproval(e.request.requestId, false, 'Add error handling')
      }
    })
    await backend.send({ content: 'reject plan', assistantMessageId: 'a-plan-no' })
    const text = events
      .filter((e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta')
      .map((e) => e.delta)
      .filter((d): d is { type: 'text'; text: string } => d.type === 'text')
      .map((d) => d.text)
      .join('')
    expect(JSON.parse(text)).toEqual({
      outcome: 'cancelled',
      feedback: 'Add error handling',
    })
    await backend.close()
  })

  it('abandons pending plan approval on interrupt', async () => {
    let resolveParked: (() => void) | null = null
    const parked = new Promise<void>((resolve) => { resolveParked = resolve })
    setAcpRuntimeFactory(async (opts) => mockRuntime({
      prompt: async (_text, messageId, onEvent) => {
        const planPromise = opts.exitPlanMode!.request({
          toolCallId: 'plan-int',
          planContent: 'wip',
        })
        resolveParked?.()
        const response = await planPromise
        onEvent({
          type: 'content_delta',
          messageId,
          delta: { type: 'text', text: JSON.stringify(response) },
        })
        onEvent({ type: 'message_interrupted', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))

    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'grok-build' }))
    const sendP = backend.send({ content: 'plan', assistantMessageId: 'a-plan-int' })
    await parked
    expect(backend.getPendingInteractions().some((e) => e.type === 'plan_approval')).toBe(true)
    await backend.interrupt()
    await sendP
    expect(backend.getPendingInteractions().every((e) => e.type !== 'plan_approval')).toBe(true)
    await backend.close()
  })

  it('forwards permission decisions to the pending gate', async () => {
    setAcpRuntimeFactory(async (opts) => mockRuntime({
      prompt: async (_text, messageId, onEvent) => {
        const response = await opts.permission.request({
          sessionId: 'acp-sess-1',
          toolCall: { toolCallId: 'tc1', title: 'Write file', kind: 'edit' },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          ],
        })
        onEvent({
          type: 'content_delta',
          messageId,
          delta: {
            type: 'text',
            text: response.outcome.outcome === 'selected' ? `opt:${response.outcome.optionId}` : 'cancelled',
          },
        })
        onEvent({ type: 'message_complete', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))

    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'custom', command: 'mock' }))
    const events: AgentEvent[] = []
    backend.onEvent((e) => {
      events.push(e)
      if (e.type === 'permission_request') {
        backend.respondToPermission(e.request.requestId, true)
      }
    })
    await backend.send({ content: 'write', assistantMessageId: 'a2' })
    const text = events
      .filter((e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta')
      .map((e) => e.delta)
      .filter((d): d is { type: 'text'; text: string } => d.type === 'text')
      .map((d) => d.text)
      .join('')
    expect(text).toContain('opt:allow')
    expect(backend.getPendingInteractions()).toEqual([])
    await backend.close()
  })

  it('exposes pending permissions via getPendingInteractions', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    setAcpRuntimeFactory(async (opts) => mockRuntime({
      prompt: async (_text, messageId, onEvent) => {
        const pending = opts.permission.request({
          sessionId: 's',
          toolCall: { toolCallId: 'p1', title: 'Run', kind: 'execute' },
          options: [{ optionId: 'a', name: 'Allow', kind: 'allow_once' }],
        })
        release()
        await pending
        onEvent({ type: 'message_complete', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))

    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'custom', command: 'mock' }))
    const sendPromise = backend.send({ content: 'x', assistantMessageId: 'm1' })
    await gate
    await new Promise((r) => setTimeout(r, 0))
    const pending = backend.getPendingInteractions()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.type).toBe('permission_request')
    backend.respondToPermission('p1', true)
    await sendPromise
    await backend.close()
  })

  it('does not double-emit error when runtime already reported failure', async () => {
    setAcpRuntimeFactory(async () => mockRuntime({
      prompt: async (_text, messageId, onEvent) => {
        onEvent({ type: 'message_error', messageId, error: 'spawn failed' })
        onEvent({ type: 'status_change', status: 'error' })
        throw new Error('spawn failed')
      },
    }))
    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'custom', command: 'mock' }))
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.send({ content: 'hi', assistantMessageId: 'e1' })
    expect(events.filter((e) => e.type === 'message_error')).toHaveLength(1)
    await backend.close()
  })

  it('emits message_interrupted when interrupt races a throw', async () => {
    setAcpRuntimeFactory(async () => mockRuntime({
      prompt: async () => {
        await new Promise((r) => setTimeout(r, 30))
        throw new Error('aborted')
      },
      cancel: async () => {},
    }))
    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'custom', command: 'mock' }))
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    const sendPromise = backend.send({ content: 'hi', assistantMessageId: 'i1' })
    await backend.interrupt()
    await sendPromise
    expect(events.some((e) => e.type === 'message_interrupted')).toBe(true)
    await backend.close()
  })

  it('allows start() after prewarm without throwing already started', async () => {
    let createCount = 0
    setAcpRuntimeFactory(async () => {
      createCount += 1
      return mockRuntime()
    })
    const backend = new AcpBackend()
    const opts = startOpts({ agentId: 'custom', command: 'mock' })
    backend.prewarm(opts)
    await new Promise((r) => setTimeout(r, 10))
    await expect(backend.start(opts)).resolves.toBeUndefined()
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.send({ content: 'hi', assistantMessageId: 'pw1' })
    expect(events.some((e) => e.type === 'message_start')).toBe(true)
    expect(events.some((e) => e.type === 'message_complete')).toBe(true)
    expect(createCount).toBe(1)
    await backend.close()
  })

  it('start is idempotent when called twice with the same agent', async () => {
    const backend = new AcpBackend()
    const opts = startOpts({ agentId: 'custom', command: 'mock' })
    await backend.start(opts)
    await expect(backend.start(opts)).resolves.toBeUndefined()
    await backend.close()
  })

  it('injectTaskNotification queues while a prompt is active and flushes after it ends', async () => {
    let resolvePrompt!: () => void
    const promptTexts: string[] = []
    setAcpRuntimeFactory(async () => mockRuntime({
      prompt: async (text, messageId, onEvent) => {
        promptTexts.push(text)
        if (promptTexts.length === 1) {
          await new Promise<void>((resolve) => { resolvePrompt = resolve })
        }
        onEvent({ type: 'message_complete', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))

    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'custom', command: 'mock' }))

    const first = backend.send({ content: 'first', assistantMessageId: 'asst-1' })
    await vi.waitFor(() => expect(promptTexts).toEqual(['first']))

    await backend.injectTaskNotification('wake once')
    await backend.injectTaskNotification('wake once')
    expect(promptTexts).toEqual(['first'])

    resolvePrompt()
    await first
    await vi.waitFor(() => expect(promptTexts).toEqual(['first', 'wake once']))
    await backend.close()
  })

  it('injectTaskNotification returns unhandled when idle so Session.send owns the turn', async () => {
    const promptTexts: string[] = []
    setAcpRuntimeFactory(async () => mockRuntime({
      prompt: async (text, messageId, onEvent) => {
        promptTexts.push(text)
        onEvent({ type: 'message_complete', messageId })
        onEvent({ type: 'status_change', status: 'idle' })
      },
    }))

    const backend = new AcpBackend()
    await backend.start(startOpts({ agentId: 'custom', command: 'mock' }))
    const handled = await backend.injectTaskNotification('idle wake')
    expect(handled).toBe('unhandled')
    expect(promptTexts).toEqual([])
    await backend.close()
  })

  it('does not publish models from a superseded agent when switching mid-prewarm', async () => {
    let resolveGrok!: (r: AcpRuntime) => void
    const grokGate = new Promise<AcpRuntime>((r) => { resolveGrok = r })
    let createN = 0
    setAcpRuntimeFactory(async (opts) => {
      createN += 1
      const agentId = opts.launch.agentId ?? 'custom'
      if (agentId === 'grok-build') {
        return grokGate
      }
      return mockRuntime({
        sessionId: 'opencode-sess',
        getModelConfig: () => ({
          configId: 'model',
          selectedModelId: 'oc-1',
          models: [{ id: 'oc-1', name: 'OpenCode 1', description: '' }],
        }),
        getConfigOptions: () => [],
      })
    })

    const backend = new AcpBackend()
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))

    backend.prewarm(startOpts({ agentId: 'grok-build' }))
    await new Promise((r) => setTimeout(r, 5))
    backend.prewarm(startOpts({ agentId: 'opencode', command: 'opencode' }))
    await new Promise((r) => setTimeout(r, 20))

    resolveGrok(mockRuntime({
      sessionId: 'grok-sess',
      getModelConfig: () => ({
        configId: null,
        selectedModelId: 'grok-4.5',
        models: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
      }),
      getConfigOptions: () => [],
    }))
    await new Promise((r) => setTimeout(r, 20))

    const ready = events.filter((e) => e.type === 'acp_models' && e.status === 'ready')
    const withModels = ready.filter((e) => e.type === 'acp_models' && e.models.length > 0) as Array<
      Extract<AgentEvent, { type: 'acp_models' }>
    >
    expect(withModels.every((e) => e.agentId === 'opencode')).toBe(true)
    expect(withModels.some((e) => e.models.some((m) => m.id === 'oc-1'))).toBe(true)
    expect(withModels.some((e) => e.models.some((m) => m.id === 'grok-4.5'))).toBe(false)
    expect(createN).toBeGreaterThanOrEqual(2)
    await backend.close()
  })
})
