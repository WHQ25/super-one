import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { NodeSessionRecord } from '@superone/runtime/session'

const mocks = vi.hoisted(() => {
  const order: string[] = []
  const client = {
    session: {
      create: vi.fn(async () => ({ data: { id: 'open-provider-1' } })),
      promptAsync: vi.fn(async () => {
        order.push('prompt')
      }),
    },
    mcp: { add: vi.fn(async () => undefined) },
    event: {
      subscribe: vi.fn(async () => {
        order.push('subscribe')
        return {
          stream: (async function* () {
            yield {
              type: 'message.updated',
              properties: {
                sessionID: 'open-provider-1',
                info: {
                  id: 'assistant-1',
                  role: 'assistant',
                  providerID: 'openai',
                  modelID: 'gpt-5.4',
                  agent: 'build',
                  cost: 0,
                  finish: null,
                  tokens: { input: 1, output: 2, reasoning: 0, total: 3, cache: { read: 0, write: 0 } },
                },
              },
            }
            yield {
              type: 'message.part.updated',
              properties: {
                sessionID: 'open-provider-1',
                part: {
                  id: 'part-1',
                  messageID: 'assistant-1',
                  type: 'text',
                  text: 'hello OpenCode',
                  time: { start: 1 },
                },
              },
            }
            yield {
              type: 'session.status',
              properties: { sessionID: 'open-provider-1', status: { type: 'idle' } },
            }
          })(),
        }
      }),
    },
  }
  return {
    client,
    close: vi.fn(async () => undefined),
    order,
  }
})

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: vi.fn(() => mocks.client),
}))

vi.mock('./server', () => ({
  startOpenCodeServer: vi.fn(async () => ({
    url: 'http://127.0.0.1:9999',
    exited: null,
    close: mocks.close,
  })),
}))

import { createOpenCodeAppServerTurnRunner } from './run-turn'

function session(): NodeSessionRecord {
  return {
    sessionId: 'session-1',
    projectId: 'project-1',
    harnessId: 'opencode',
    providerId: 'opencode',
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

describe('OpenCode production turn runner AgentEvents', () => {
  it('subscribes before prompt and suppresses duplicate legacy deltas', async () => {
    const events: AgentEvent[] = []
    const deltas: string[] = []
    const runner = createOpenCodeAppServerTurnRunner(() => '/tmp', {
      serverUrl: 'http://127.0.0.1:9999',
    })

    const result = await runner({
      session: session(),
      messageId: 'message-1',
      text: 'go',
      onAgentEvent: (event) => events.push(event),
      onDelta: (delta) => deltas.push(delta),
      signal: new AbortController().signal,
    })

    expect(mocks.order).toEqual(['subscribe', 'prompt'])
    expect(result).toEqual({ finalText: 'hello OpenCode', providerResume: 'opencode:open-provider-1' })
    expect(deltas).toEqual([])
    expect(events.map((event) => event.type)).toEqual([
      'message_start',
      'status_change',
      'provider_session_id',
      'message_usage',
      'content_delta',
      'message_complete',
      'status_change',
    ])
  })
})
