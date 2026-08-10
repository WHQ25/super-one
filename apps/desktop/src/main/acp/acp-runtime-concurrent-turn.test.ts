import { describe, it, expect, vi } from 'vitest'
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Stream,
} from '@agentclientprotocol/sdk'
import { createAcpRuntime } from './acp-runtime'
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

/**
 * Agent that mirrors Grok's reaction to a second in-flight `session/prompt`:
 * the first turn is ended with `stopReason: 'cancelled'` only once the second
 * prompt arrives, so the cancel settles *after* the newer turn already
 * overwrote the runtime's per-turn state.
 */
function makeCancelOnSecondPromptStream(): { stream: Stream; dispose: () => void } {
  let turn = 0
  let endFirstTurn: ((result: { stopReason: 'cancelled' }) => void) | null = null
  const agentApp = agent({ name: 'concurrent-prompt-agent' })
    .onRequest(methods.agent.initialize, async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .onRequest(methods.agent.session.new, async () => ({ sessionId: 'concurrent-session' }))
    .onRequest(methods.agent.session.prompt, async (ctx) => {
      turn += 1
      if (turn === 1) {
        await ctx.client.notify(methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'first-turn-text' },
          },
        })
        return new Promise<{ stopReason: 'cancelled' }>((resolve) => {
          endFirstTurn = resolve
        })
      }
      // Second prompt lands mid-turn → Grok kills the first turn.
      endFirstTurn?.({ stopReason: 'cancelled' })
      return new Promise<never>(() => {})
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

describe('ACP concurrent prompts', () => {
  it('marks the cancelled turn interrupted on its own message id, not the newer turn', async () => {
    const runtime = await createAcpRuntime({
      launch: { agentId: 'grok-build', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      streamFactory: async () => makeCancelOnSecondPromptStream(),
      onSessionEvent: () => {},
    })

    const firstTurnEvents: AgentEvent[] = []
    const secondTurnEvents: AgentEvent[] = []

    const firstTurn = runtime.prompt('first', 'msg-A', (e) => firstTurnEvents.push(e))
    // Let the first prompt reach the agent and stream a chunk before steering in.
    await vi.waitFor(() => {
      expect(firstTurnEvents.some((e) => e.type === 'content_delta')).toBe(true)
    })

    // The replacement turn never settles on its own — it dies with the runtime.
    const secondTurn = runtime.prompt('second', 'msg-B', (e) => secondTurnEvents.push(e))
      .catch(() => undefined)
    await firstTurn

    const interrupted = firstTurnEvents.filter((e) => e.type === 'message_interrupted')
    expect(interrupted).toHaveLength(1)
    expect((interrupted[0] as { messageId: string }).messageId).toBe('msg-A')
    expect(secondTurnEvents.some((e) => e.type === 'message_interrupted')).toBe(false)

    await runtime.close()
    await secondTurn
  })
})
