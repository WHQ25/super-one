import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { AcpBackend, setAcpRuntimeFactory } from './acp-backend'
import type { BackendStartOptions } from '../types'
import type { AcpRuntime } from '../../acp/acp-runtime'

function startOpts(config: unknown = {}): BackendStartOptions {
  return {
    sessionId: 'sess-1',
    projectPath: '/tmp/proj',
    cwd: '/tmp/proj',
    config,
    permissionMode: 'default',
    abortController: new AbortController(),
  }
}

function mockRuntime(overrides?: Partial<AcpRuntime>): AcpRuntime {
  return {
    sessionId: 'acp-sess-1',
    launch: {
      agentId: 'custom',
      command: 'echo',
      args: [],
      env: {},
      cwd: '/tmp/proj',
    },
    getConfigOptions: () => [
      {
        id: 'mode',
        name: 'Session Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'ask',
        options: [
          { value: 'ask', name: 'Ask' },
          { value: 'code', name: 'Code' },
        ],
      },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'm1',
        options: [
          { value: 'm1', name: 'Model 1' },
          { value: 'm2', name: 'Model 2' },
        ],
      },
    ],
    getModelConfig: () => ({
      configId: 'model',
      selectedModelId: 'm1',
      models: [
        { id: 'm1', name: 'Model 1', description: '' },
        { id: 'm2', name: 'Model 2', description: '' },
      ],
    }),
    setConfigOption: async (_configId, value) => [
      {
        id: 'mode',
        name: 'Session Mode',
        category: 'mode',
        type: 'select',
        currentValue: value,
        options: [
          { value: 'ask', name: 'Ask' },
          { value: 'code', name: 'Code' },
        ],
      },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'm1',
        options: [
          { value: 'm1', name: 'Model 1' },
          { value: 'm2', name: 'Model 2' },
        ],
      },
    ],
    prompt: async (_text, messageId, onEvent) => {
      onEvent({
        type: 'content_delta',
        messageId,
        delta: { type: 'text', text: 'hello-from-mock' },
      })
      onEvent({ type: 'message_complete', messageId })
      onEvent({ type: 'status_change', status: 'idle' })
    },
    cancel: async () => {},
    close: async () => {},
    ...overrides,
  }
}

describe('AcpBackend', () => {
  beforeEach(() => {
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
    expect(JSON.parse(text)).toMatchObject({
      accepted: {
        answers: { 'Pick?': ['One'] },
      },
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
    expect(JSON.parse(text)).toEqual({ cancelled: {} })
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
