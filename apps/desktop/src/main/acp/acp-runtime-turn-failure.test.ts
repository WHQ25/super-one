import { describe, it, expect, vi } from 'vitest'
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Stream,
} from '@agentclientprotocol/sdk'
import { createAcpRuntime } from './acp-runtime'
import { ACP_RATE_LIMITED_ERROR_CODE } from './acp-request-error'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: () => ({ executable: '/fake/node', env: { NODE_FAKE: '1' } }),
}))

vi.mock('../mcp-config-service', () => ({
  listMcpConfigs: vi.fn(() => []),
}))

type PromptHandler = (turn: number, sessionId: string, ctx: {
  client: { notify: (method: string, params: unknown) => Promise<void> }
}) => Promise<{ stopReason: 'end_turn' }>

/** Agent whose session/prompt behaviour is driven per turn by `onPrompt`. */
function makeAgentStream(onPrompt: PromptHandler): { stream: Stream; dispose: () => void } {
  let turn = 0
  const agentApp = agent({ name: 'turn-failure-agent' })
    .onRequest(methods.agent.initialize, async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .onRequest(methods.agent.session.new, async () => ({ sessionId: 'failing-session' }))
    .onRequest(methods.agent.session.prompt, async (ctx) => {
      turn += 1
      return onPrompt(turn, String(ctx.params.sessionId), ctx as never)
    })
    .onNotification(methods.agent.session.cancel, async () => {})

  const clientToAgent = new TransformStream<Uint8Array>()
  const agentToClient = new TransformStream<Uint8Array>()
  agentApp.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable))
  const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
  const safeClose = (w: WritableStream<Uint8Array>) => {
    try {
      if (!w.locked) void w.close().catch(() => undefined)
    } catch { /* ignore */ }
  }
  return {
    stream: clientStream,
    dispose: () => {
      safeClose(clientToAgent.writable)
      safeClose(agentToClient.writable)
    },
  }
}

async function startRuntime(
  onPrompt: PromptHandler,
  extra: { cancelStopFallbackMs?: number } = {},
) {
  const events: AgentEvent[] = []
  const runtime = await createAcpRuntime({
    launch: { agentId: 'grok-build', command: 'unused', defaultCwd: '/tmp/proj' },
    permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
    streamFactory: async () => makeAgentStream(onPrompt),
    onSessionEvent: (e) => events.push(e),
    ...extra,
  })
  return { runtime, events }
}

const RATE_LIMIT_DETAIL =
  'API error (status 429 Too Many Requests): subscription:free-usage-exhausted: quota spent'

describe('ACP turn failure (Grok quota exhausted)', () => {
  it('ends the turn with a message error when session/prompt is rejected', async () => {
    const { runtime } = await startRuntime(async () => {
      throw new RequestError(ACP_RATE_LIMITED_ERROR_CODE, 'Rate limited', RATE_LIMIT_DETAIL)
    })

    const turnEvents: AgentEvent[] = []
    await expect(
      runtime.prompt('hi', 'msg-1', (e) => turnEvents.push(e)),
    ).rejects.toThrow()

    const error = turnEvents.find((e) => e.type === 'message_error')
    expect(error).toMatchObject({ type: 'message_error', messageId: 'msg-1' })
    expect((error as { error: string }).error).toMatch(/free Grok Build usage limit/)
    expect(turnEvents.at(-1)).toEqual({ type: 'status_change', status: 'error' })

    await runtime.close()
  })

  it('keeps the update pump alive so the next turn still streams', async () => {
    const { runtime } = await startRuntime(async (turn, sessionId, ctx) => {
      if (turn === 1) {
        throw new RequestError(ACP_RATE_LIMITED_ERROR_CODE, 'Rate limited', RATE_LIMIT_DETAIL)
      }
      await ctx.client.notify(methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'recovered' },
        },
      })
      return { stopReason: 'end_turn' as const }
    })

    await runtime.prompt('first', 'msg-1', () => {}).catch(() => undefined)

    const second: AgentEvent[] = []
    await runtime.prompt('second', 'msg-2', (e) => second.push(e))

    const text = second.filter(
      (e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta',
    )
    expect(text.some((e) => JSON.stringify(e.delta).includes('recovered'))).toBe(true)
    expect(second.some((e) => e.type === 'message_complete')).toBe(true)

    await runtime.close()
  })

  it('settles a stuck turn when cancel gets no stop from the agent', async () => {
    // Grok drops session/cancel once the turn already failed server-side.
    const { runtime } = await startRuntime(
      () => new Promise(() => {}) as never,
      { cancelStopFallbackMs: 20 },
    )

    const turnEvents: AgentEvent[] = []
    const turn = runtime.prompt('hangs', 'msg-1', (e) => turnEvents.push(e))
    await new Promise((r) => setTimeout(r, 10))
    await runtime.cancel()
    await turn

    expect(turnEvents.some((e) => e.type === 'message_interrupted')).toBe(true)
    expect(turnEvents.at(-1)).toEqual({ type: 'status_change', status: 'idle' })

    await runtime.close()
  })
})
