import { SUPERONE_SYSTEM_PROMPT_APPEND, superoneHostContext } from '@superone/shared/superone-system-prompt'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { NodeSessionRecord } from '@superone/runtime/session'

const mocks = vi.hoisted(() => {
  const notificationHandlers = new Map<string, {
    parse: (raw: unknown) => Record<string, unknown>
    handle: (ctx: { params: Record<string, unknown> }) => Promise<void>
  }>()
  const updates = [
    {
      kind: 'session_update',
      notification: {
        sessionId: 'acp-provider-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello ACP' },
        },
      },
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello ACP' },
      },
    },
    { kind: 'stop', stopReason: 'end_turn' },
  ]
  const active = {
    sessionId: 'acp-provider-1',
    prompt: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { stopReason: 'end_turn' }
    }),
    nextUpdate: vi.fn(async () => updates.shift()!),
    dispose: vi.fn(),
  }
  const connection = {
    agent: {
      request: vi.fn(async () => ({})),
      buildSession: vi.fn(() => ({
        start: vi.fn(async () => {
          const registered = notificationHandlers.get('x.ai/session_notification')
          if (registered) {
            const params = registered.parse({
              sessionId: 'acp-provider-1',
              update: {
                sessionUpdate: 'workflow_updated',
                run_id: 'workflow-1',
                revision: 1,
                name: 'review',
                objective: 'Review changes',
                status: 'active',
                current_phase: 'Inspect',
              },
            })
            await registered.handle({ params })
          }
          return active
        }),
      })),
    },
    close: vi.fn(),
  }
  const requestHandlers = new Map<string, {
    parse: (raw: unknown) => unknown
    handle: (ctx: { params: unknown }) => Promise<unknown>
  }>()
  const app = {
    onRequest: vi.fn((
      method: string,
      parse: (raw: unknown) => unknown,
      handle: (ctx: { params: unknown }) => Promise<unknown>,
    ) => {
      requestHandlers.set(method, { parse, handle })
      return app
    }),
    onNotification: vi.fn((
      method: string,
      parse: (raw: unknown) => Record<string, unknown>,
      handle: (ctx: { params: Record<string, unknown> }) => Promise<void>,
    ) => {
      notificationHandlers.set(method, { parse, handle })
      return app
    }),
    connect: vi.fn(() => connection),
  }
  return {
    active,
    app,
    connection,
    notificationHandlers,
    requestHandlers,
    kill: vi.fn(async () => undefined),
  }
})

vi.mock('@agentclientprotocol/sdk', () => ({
  client: vi.fn(() => mocks.app),
  methods: {
    client: { session: { requestPermission: 'session/request_permission' } },
    agent: { initialize: 'initialize', authenticate: 'authenticate', session: { setConfigOption: 'session/set_config_option' } },
  },
  PROTOCOL_VERSION: 1,
}))

vi.mock('./process', () => ({
  spawnAcpProcess: vi.fn(() => ({ stream: {}, kill: mocks.kill })),
}))

import { createAcpAgentTurnRunner } from './run-turn'
import { XAI_EXT_NOTIFICATION_METHODS } from './xai-state'

function session(): NodeSessionRecord {
  return {
    sessionId: 'session-1',
    projectId: 'project-1',
    harnessId: 'acp',
    providerId: 'acp',
    title: null,
    status: 'streaming',
    transcript: [],
    pendingInteraction: null,
    providerResume: null,
    cwd: '/tmp',
    createdAt: 0,
    updatedAt: 0,
    isPinned: false,
    isHidden: false,
    isUserRenamed: false,
    controllerClientSessionId: null,
    hostActionCapabilityVersion: 0,
    hostActionToolGroups: [],
    alwaysAllowedTools: [],
  }
}

describe('ACP production turn runner AgentEvents', () => {
  it('stamps a Grok checkpoint and skips Antigravity', async () => {
    const nextUpdate = mocks.active.nextUpdate.getMockImplementation()
    mocks.active.nextUpdate.mockResolvedValue({ kind: 'stop', stopReason: 'end_turn' })
    const events: AgentEvent[] = []
    try {
      const turn = (launch: { command: string; agentId: string }, acpAgentId?: string) => createAcpAgentTurnRunner({ launch })({
        session: { ...session(), ...(acpAgentId ? { acpAgentId } : {}) },
        messageId: 'a1',
        clientMessageId: 'u1',
        text: 'go',
        onAgentEvent: (event) => events.push(event),
        onDelta: () => {},
        signal: new AbortController().signal,
      })
      await turn({ command: 'grok', agentId: 'grok-build' })
      expect(events).toContainEqual({
        type: 'checkpoint_captured', messageId: 'a1', userMessageId: 'u1', checkpointId: 'u1', resumePointId: 'u1',
      })
      events.length = 0
      await turn({ command: 'grok', agentId: 'grok-build' }, 'antigravity')
      await turn({ command: 'agy', agentId: 'antigravity' }, 'antigravity')
      expect(events.some((event) => event.type === 'checkpoint_captured')).toBe(false)
    } finally {
      if (nextUpdate) mocks.active.nextUpdate.mockImplementation(nextUpdate)
    }
  })

  it('uses the lossless path without duplicating legacy deltas', async () => {
    const events: AgentEvent[] = []
    const deltas: string[] = []
    const runner = createAcpAgentTurnRunner({
      launch: { command: '/fake/acp' },
      resolveProjectPath: () => '/tmp',
    })

    const result = await runner({
      session: session(),
      messageId: 'message-1',
      text: 'go',
      onAgentEvent: (event) => events.push(event),
      onDelta: (delta) => deltas.push(delta),
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ finalText: 'hello ACP', providerResume: 'acp-session:acp-provider-1' })
    expect(mocks.active.prompt).toHaveBeenCalledWith(expect.stringContaining(SUPERONE_SYSTEM_PROMPT_APPEND))
    expect(deltas).toEqual([])
    expect(events.map((event) => event.type)).toEqual([
      'message_start',
      'status_change',
      'provider_session_id',
      'task_started',
      'task_progress',
      'content_delta',
      'message_complete',
      'status_change',
    ])
    expect(events).toContainEqual(expect.objectContaining({
      type: 'task_progress',
      taskId: 'workflow-1',
      currentPhase: 'Inspect',
    }))
    expect(mocks.notificationHandlers.size).toBe(XAI_EXT_NOTIFICATION_METHODS.length)
  })

  it('publishes session/new models and applies the selected model before prompting', async () => {
    mocks.active.nextUpdate.mockResolvedValue({ kind: 'stop', stopReason: 'end_turn' })
    const response = {
      sessionId: 'acp-provider-1',
      configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select',
        currentValue: 'fast', options: [{ value: 'fast', name: 'Fast' }, { value: 'full', name: 'Full' }] }],
      models: { currentModelId: 'fast', availableModels: [
        { modelId: 'fast', name: 'Fast', _meta: { totalContextTokens: 200000 } },
        { modelId: 'full', name: 'Full', _meta: { totalContextTokens: 300000 } },
      ] },
    }
    Object.assign(mocks.active, { newSessionResponse: response })
    const events: AgentEvent[] = []
    mocks.connection.agent.request.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === 'session/set_config_option') return { configOptions: [
        { ...response.configOptions[0], currentValue: 'full' },
      ] }
      return {}
    })
    const promptCheck = mocks.active.prompt.getMockImplementation()!
    mocks.active.prompt.mockImplementationOnce(async () => {
      expect(mocks.connection.agent.request).toHaveBeenCalledWith('session/set_config_option', {
        sessionId: 'acp-provider-1', configId: 'model', value: 'full',
      })
      return promptCheck()
    })
    try {
      await createAcpAgentTurnRunner({ launch: { command: '/fake/acp' } })({
        session: session(), model: 'full', text: 'go', onDelta: () => {},
        onAgentEvent: event => events.push(event), signal: new AbortController().signal,
      })
      expect(events).toContainEqual(expect.objectContaining({ type: 'acp_models', configId: 'model',
        selectedModelId: 'full', models: [
          expect.objectContaining({ id: 'fast', contextWindow: 200000 }),
          expect.objectContaining({ id: 'full', contextWindow: 300000 }),
        ] }))
    } finally {
      delete (mocks.active as { newSessionResponse?: unknown }).newSessionResponse
      mocks.connection.agent.request.mockImplementation(async () => ({}))
    }
  })

  it.each(['full', 'default'])('uses legacy set_model only for an explicit %s choice', async model => {
    mocks.active.nextUpdate.mockResolvedValue({ kind: 'stop', stopReason: 'end_turn' })
    mocks.connection.agent.request.mockClear()
    Object.assign(mocks.active, { newSessionResponse: { sessionId: 'acp-provider-1', models: {
      currentModelId: 'fast', availableModels: [{ modelId: 'fast', name: 'Fast' }, { modelId: 'full', name: 'Full' }],
    } } })
    try {
      await createAcpAgentTurnRunner({ launch: { command: '/fake/acp' } })({ session: session(), model,
        text: 'go', onDelta: () => {}, signal: new AbortController().signal })
      const calls = mocks.connection.agent.request.mock.calls as unknown as Array<[string, unknown]>
      expect(calls.filter(call => call[0] === 'session/set_model')).toEqual(model === 'default' ? [] : [
        ['session/set_model', { sessionId: 'acp-provider-1', modelId: 'full' }],
      ])
    } finally { delete (mocks.active as { newSessionResponse?: unknown }).newSessionResponse }
  })

  it('does not send a prompt when the agent rejects the selected model', async () => {
    mocks.active.prompt.mockClear()
    mocks.kill.mockClear()
    mocks.connection.agent.request.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === 'session/set_model') throw new Error('model unavailable')
      return {}
    })
    try {
      await expect(createAcpAgentTurnRunner({ launch: { command: '/fake/acp' } })({ session: session(), model: 'unavailable',
        text: 'go', onDelta: () => {}, signal: new AbortController().signal })).rejects.toThrow('model unavailable')
      expect(mocks.active.prompt).not.toHaveBeenCalled()
      expect(mocks.kill).toHaveBeenCalledOnce()
    } finally { mocks.connection.agent.request.mockImplementation(async () => ({})) }
  })

  it('parks x.ai/mcp/elicit on onPermission instead of auto-cancelling', async () => {
    mocks.active.nextUpdate.mockResolvedValue({ kind: 'stop', stopReason: 'end_turn' })
    const onPermission = vi.fn(async () => 'allow' as const)
    const runner = createAcpAgentTurnRunner({
      launch: { command: '/fake/acp' },
      resolveProjectPath: () => '/tmp',
    })
    const turn = runner({
      session: session(),
      messageId: 'message-elicit',
      text: 'go',
      onAgentEvent: () => {},
      onDelta: () => {},
      onPermission,
      signal: new AbortController().signal,
    })
    await vi.waitFor(() => expect(mocks.requestHandlers.has('x.ai/mcp/elicit')).toBe(true))
    const elicit = mocks.requestHandlers.get('x.ai/mcp/elicit')!
    const result = await elicit.handle({
      params: elicit.parse({
        serverName: 'github',
        message: 'Sign in',
        url: 'https://github.com/login',
        elicitationId: 'e-1',
      }),
    })
    expect(onPermission).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'permission',
      requestKind: 'mcp_elicitation',
      serverName: 'github',
    }))
    expect(result).toEqual({ outcome: 'accept' })
    await turn
  })

  it('advertises askUserQuestion and exitPlanMode on initialize', async () => {
    mocks.active.nextUpdate.mockResolvedValue({ kind: 'stop', stopReason: 'end_turn' })
    const runner = createAcpAgentTurnRunner({
      launch: { command: '/fake/acp' },
      resolveProjectPath: () => '/tmp',
    })
    await runner({
      session: session(),
      messageId: 'message-init-meta',
      text: 'go',
      onAgentEvent: () => {},
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    expect(mocks.connection.agent.request).toHaveBeenCalledWith(
      'initialize',
      expect.objectContaining({
        _meta: {
          askUserQuestion: true,
          exitPlanMode: true,
          clientIdentifier: 'superone',
        },
      }),
    )
    const initCalls = mocks.connection.agent.request.mock.calls as unknown as Array<[string, { clientCapabilities?: unknown; clientInfo?: { version?: string } }]>
    const initCall = initCalls.find((call) => call[0] === 'initialize')
    expect(initCall?.[1]).toEqual(expect.objectContaining({
      clientCapabilities: {},
    }))
    expect(initCall?.[1]?.clientInfo?.version).toMatch(/^\d+\.\d+/)
  })

  it('authenticates a grok launch before session/new and stamps permission meta', async () => {
    mocks.active.nextUpdate.mockResolvedValue({ kind: 'stop', stopReason: 'end_turn' })
    mocks.connection.agent.request.mockReset()
    mocks.connection.agent.request
      .mockResolvedValueOnce({ authMethods: [{ id: 'cached_token' }] })
      .mockResolvedValueOnce({})
    const runner = createAcpAgentTurnRunner({
      launch: { command: '/opt/grok', agentId: 'grok-build' },
      resolveProjectPath: () => '/tmp',
    })
    await runner({
      session: session(),
      messageId: 'message-grok-init',
      text: 'go',
      permissionMode: 'auto',
      onAgentEvent: () => {},
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    const grokCalls = mocks.connection.agent.request.mock.calls as unknown as Array<[string, unknown]>
    expect(grokCalls.map((call) => call[0])).toEqual([
      'initialize',
      'authenticate',
      '_x.ai/suggestPrompt',
    ])
    expect(grokCalls[1]?.[1]).toEqual({ methodId: 'cached_token' })
    expect(grokCalls[0]?.[1]).toEqual(expect.objectContaining({
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    }))
    expect(mocks.connection.agent.buildSession).toHaveBeenCalledWith(expect.objectContaining({
      _meta: {
        clientIdentifier: 'superone',
        yoloMode: false,
        autoMode: true,
        rules: superoneHostContext(),
      },
    }))
    expect(mocks.active.prompt).toHaveBeenCalledWith('go')
    expect(grokCalls[2]?.[1]).toEqual({ generation: 1, sessionId: 'acp-provider-1' })
    mocks.connection.agent.request.mockImplementation(async () => ({}))
  })

  it('pulls x.ai/suggestPrompt after a grok turn and emits prompt_suggestion on the ambient path', async () => {
    mocks.active.nextUpdate.mockResolvedValue({ kind: 'stop', stopReason: 'end_turn' })
    mocks.connection.agent.request.mockImplementation(async (...args: unknown[]) => {
      const method = args[0]
      if (method === 'initialize') return { authMethods: [] }
      if (method === '_x.ai/suggestPrompt') {
        const body = args[1] as { generation: number }
        return { suggestion: 'Run the tests', generation: body.generation }
      }
      return {}
    })
    const events: AgentEvent[] = []
    const ambient: AgentEvent[] = []
    try {
      await createAcpAgentTurnRunner({
        launch: { command: '/opt/grok', agentId: 'grok-build' },
      })({
        session: session(),
        messageId: 'message-suggest',
        text: 'go',
        onAgentEvent: (event) => events.push(event),
        onAmbientEvent: (event) => ambient.push(event),
        onDelta: () => {},
        signal: new AbortController().signal,
      })
      expect(ambient).toEqual([{ type: 'prompt_suggestion', suggestion: 'Run the tests' }])
      expect(events.some((event) => event.type === 'prompt_suggestion')).toBe(false)
    } finally {
      mocks.connection.agent.request.mockImplementation(async () => ({}))
    }
  })

  it('does not pull x.ai/suggestPrompt for a grok slash prompt', async () => {
    mocks.active.nextUpdate.mockResolvedValue({ kind: 'stop', stopReason: 'end_turn' })
    mocks.connection.agent.request.mockReset()
    mocks.connection.agent.request.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === 'initialize') return { authMethods: [] }
      return {}
    })
    try {
      await createAcpAgentTurnRunner({
        launch: { command: '/opt/grok', agentId: 'grok-build' },
      })({
        session: session(),
        messageId: 'message-slash',
        text: '/recap',
        onAgentEvent: () => {},
        onDelta: () => {},
        signal: new AbortController().signal,
      })
      const methods = (mocks.connection.agent.request.mock.calls as unknown as Array<[string]>)
        .map((call) => call[0])
      expect(methods).not.toContain('_x.ai/suggestPrompt')
    } finally {
      mocks.connection.agent.request.mockImplementation(async () => ({}))
    }
  })

  it('sends an explicit clientVersion on initialize', async () => {
    mocks.connection.agent.request.mockClear()
    mocks.active.nextUpdate.mockResolvedValue({ kind: 'stop', stopReason: 'end_turn' })
    const runner = createAcpAgentTurnRunner({
      launch: { command: '/fake/acp' },
      resolveProjectPath: () => '/tmp',
      clientVersion: '9.9.9',
    })
    await runner({
      session: session(),
      messageId: 'message-client-version',
      text: 'go',
      onAgentEvent: () => {},
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    const initCalls = mocks.connection.agent.request.mock.calls as unknown as Array<[string, { clientInfo?: { name?: string; version?: string } }]>
    const initCall = initCalls.find((call) => call[0] === 'initialize')
    expect(initCall?.[1]?.clientInfo).toEqual({ name: 'superone-node', version: '9.9.9' })
  })

  it('cancels ask_user_question immediately when the runner has no question UI', async () => {
    mocks.active.nextUpdate.mockResolvedValue({ kind: 'stop', stopReason: 'end_turn' })
    const runner = createAcpAgentTurnRunner({
      launch: { command: '/fake/acp' },
      resolveProjectPath: () => '/tmp',
    })
    const turn = runner({
      session: session(),
      messageId: 'message-ask',
      text: 'go',
      onAgentEvent: () => {},
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    await vi.waitFor(() => expect(mocks.requestHandlers.has('x.ai/ask_user_question')).toBe(true))
    const ask = mocks.requestHandlers.get('x.ai/ask_user_question')!
    const result = await ask.handle({
      params: ask.parse({ questions: [{ question: 'Pick one?' }] }),
    })
    expect(result).toEqual({ outcome: 'cancelled' })
    const alias = mocks.requestHandlers.get('_x.ai/ask_user_question')!
    expect(await alias.handle({ params: alias.parse({}) })).toEqual({ outcome: 'cancelled' })
    await turn
  })

  it('cancels exit_plan_mode immediately when the runner has no plan UI', async () => {
    mocks.active.nextUpdate.mockResolvedValue({ kind: 'stop', stopReason: 'end_turn' })
    const runner = createAcpAgentTurnRunner({
      launch: { command: '/fake/acp' },
      resolveProjectPath: () => '/tmp',
    })
    const turn = runner({
      session: session(),
      messageId: 'message-plan',
      text: 'go',
      onAgentEvent: () => {},
      onDelta: () => {},
      signal: new AbortController().signal,
    })
    await vi.waitFor(() => expect(mocks.requestHandlers.has('x.ai/exit_plan_mode')).toBe(true))
    const exitPlan = mocks.requestHandlers.get('x.ai/exit_plan_mode')!
    expect(await exitPlan.handle({ params: exitPlan.parse({ planContent: '# Plan' }) }))
      .toEqual({ outcome: 'cancelled' })
    const alias = mocks.requestHandlers.get('_x.ai/exit_plan_mode')!
    expect(await alias.handle({ params: alias.parse({}) })).toEqual({ outcome: 'cancelled' })
    await turn
  })

  it('parks ask_user_question on onQuestion when a UI waiter exists', async () => {
    mocks.active.nextUpdate.mockResolvedValue({ kind: 'stop', stopReason: 'end_turn' })
    const onQuestion = vi.fn(async () => ({
      answers: { 'Pick one?': 'A' },
      annotations: { 'Pick one?': { notes: 'Selected from the remote UI' } },
    }))
    const runner = createAcpAgentTurnRunner({
      launch: { command: '/fake/acp' },
      resolveProjectPath: () => '/tmp',
    })
    const turn = runner({
      session: session(),
      messageId: 'message-ask-ui',
      text: 'go',
      onAgentEvent: () => {},
      onDelta: () => {},
      onQuestion,
      signal: new AbortController().signal,
    })
    await vi.waitFor(() => expect(mocks.requestHandlers.has('x.ai/ask_user_question')).toBe(true))
    const ask = mocks.requestHandlers.get('x.ai/ask_user_question')!
    const result = await ask.handle({
      params: ask.parse({ toolCallId: 'q-1', questions: [{ question: 'Pick one?' }] }),
    })
    expect(onQuestion).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'question',
      interactionId: 'q-1',
    }))
    expect(result).toEqual({
      outcome: 'accepted', answers: { 'Pick one?': ['A'] },
      annotations: { 'Pick one?': { notes: 'Selected from the remote UI' } },
    })
    await turn
  })
})
