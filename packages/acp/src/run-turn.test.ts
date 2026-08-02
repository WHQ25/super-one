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
  const app = {
    onRequest: vi.fn(),
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
  app.onRequest.mockReturnValue(app)
  return {
    active,
    app,
    connection,
    notificationHandlers,
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
    expect(mocks.notificationHandlers.size).toBe(11)
  })
})
