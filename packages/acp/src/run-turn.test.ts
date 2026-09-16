import { SUPERONE_SYSTEM_PROMPT_APPEND } from '@superone/shared/superone-system-prompt'
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
    agent: { initialize: 'initialize' },
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
