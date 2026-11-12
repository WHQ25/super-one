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

vi.mock('./antigravity-profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./antigravity-profile')>()
  return {
    ...actual,
    isAntigravityAuthSatisfied: () => true,
    readAntigravityAuthConfig: () => ({ authMethod: 'oauth-personal' }),
  }
})

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

  it('steers an in-flight Antigravity turn via a concurrent session/prompt without session/cancel', async () => {
    const order: string[] = []
    let finishSteerLeg0: ((result: {
      stopReason: 'end_turn'
      usage: { inputTokens: number; outputTokens: number; totalTokens: number }
    }) => void) | null = null
    let finishSteeredLeg1: ((result: {
      stopReason: 'end_turn'
      usage: { inputTokens: number; outputTokens: number; totalTokens: number }
    }) => void) | null = null
    let inFlightPrompts = 0
    let sawConcurrentPrompt = false

    const makeAntigravitySteerStream = (): { stream: Stream; dispose: () => void } => {
      let leg = 0
      const agentApp = agent({ name: 'antigravity-steer-agent' })
        .onRequest(methods.agent.initialize, async () => ({
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {},
        }))
        .onRequest(methods.agent.authenticate, async () => ({}))
        .onRequest(methods.agent.session.new, async () => ({ sessionId: 'agy-session' }))
        .onRequest(methods.agent.session.setMode, async () => ({}))
        .onRequest(methods.agent.session.prompt, async (ctx) => {
          leg += 1
          inFlightPrompts += 1
          if (inFlightPrompts > 1) sawConcurrentPrompt = true
          const text = ctx.params.prompt
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map((b) => b.text)
            .join('')
          order.push(`prompt:${leg}:${text}`)
          try {
            if (leg === 1) {
              await ctx.client.notify(methods.client.session.update, {
                sessionId: ctx.params.sessionId,
                update: {
                  sessionUpdate: 'agent_message_chunk',
                  content: { type: 'text', text: 'agy-pre-steer' },
                },
              })
              return await new Promise((resolve) => {
                finishSteerLeg0 = resolve
              })
            }
            finishSteerLeg0?.({
              stopReason: 'end_turn',
              usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
            })
            await ctx.client.notify(methods.client.session.update, {
              sessionId: ctx.params.sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'agy-post-steer' },
              },
            })
            return await new Promise((resolve) => {
              finishSteeredLeg1 = resolve
            })
          } finally {
            inFlightPrompts -= 1
          }
        })
        .onNotification(methods.agent.session.cancel, async () => {
          order.push('cancel')
        })

      const clientToAgent = new TransformStream<Uint8Array>()
      const agentToClient = new TransformStream<Uint8Array>()
      agentApp.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable))
      const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
      const safeClose = (w: WritableStream<Uint8Array>) => {
        try {
          if (!w.locked) void w.close().catch(() => undefined)
        } catch {}
      }
      return {
        stream: clientStream,
        dispose: () => {
          safeClose(clientToAgent.writable)
          safeClose(agentToClient.writable)
        },
      }
    }

    const runtime = await createAcpRuntime({
      launch: { agentId: 'antigravity', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      streamFactory: async () => makeAntigravitySteerStream(),
      onSessionEvent: () => {},
    })

    const turnEvents: AgentEvent[] = []
    const turnPromise = runtime.prompt('first', 'msg-agy-1', (e) => turnEvents.push(e))
    await vi.waitFor(() => {
      expect(turnEvents.some((e) => e.type === 'content_delta')).toBe(true)
    })

    await runtime.interject('steered', 'u-steer-1')
    await vi.waitFor(() => {
      expect(turnEvents.filter((e) => e.type === 'content_delta')).toHaveLength(2)
    })

    expect(sawConcurrentPrompt).toBe(true)
    expect(order).toEqual(['prompt:1:first', 'prompt:2:steered'])
    expect(turnEvents.some((e) => e.type === 'message_complete')).toBe(false)
    expect(turnEvents.some((e) => e.type === 'message_interrupted')).toBe(false)

    finishSteeredLeg1?.({
      stopReason: 'end_turn',
      usage: { inputTokens: 150, outputTokens: 35, totalTokens: 185 },
    })
    await turnPromise

    const usages = turnEvents.filter((e): e is Extract<AgentEvent, { type: 'message_usage' }> => e.type === 'message_usage')
    expect(usages).toHaveLength(2)
    expect(usages[0]).toMatchObject({ messageId: 'msg-agy-1', inputTokens: 100, outputTokens: 20 })
    expect(usages[1]).toMatchObject({ messageId: 'msg-agy-1', inputTokens: 150, outputTokens: 35 })
    const completes = turnEvents.filter((e) => e.type === 'message_complete')
    expect(completes).toHaveLength(1)
    expect(turnEvents.filter((e) => e.type === 'status_change' && e.status === 'idle')).toHaveLength(1)

    await runtime.close()
  })

  it('keeps the initial Antigravity leg alive when a steered session/prompt is rejected', async () => {
    let finishLeg0: ((result: { stopReason: 'end_turn' }) => void) | null = null

    const makeAntigravityRejectSteerStream = (): { stream: Stream; dispose: () => void } => {
      let leg = 0
      const agentApp = agent({ name: 'antigravity-reject-steer-agent' })
        .onRequest(methods.agent.initialize, async () => ({
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {},
        }))
        .onRequest(methods.agent.authenticate, async () => ({}))
        .onRequest(methods.agent.session.new, async () => ({ sessionId: 'agy-session' }))
        .onRequest(methods.agent.session.setMode, async () => ({}))
        .onRequest(methods.agent.session.prompt, async (ctx) => {
          leg += 1
          if (leg > 1) {
            throw new Error('steer busy')
          }
          await ctx.client.notify(methods.client.session.update, {
            sessionId: ctx.params.sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'agy-still-running' },
            },
          })
          return await new Promise<{ stopReason: 'end_turn' }>((resolve) => {
            finishLeg0 = resolve
          })
        })
        .onNotification(methods.agent.session.cancel, async () => {})

      const clientToAgent = new TransformStream<Uint8Array>()
      const agentToClient = new TransformStream<Uint8Array>()
      agentApp.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable))
      const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
      const safeClose = (w: WritableStream<Uint8Array>) => {
        try {
          if (!w.locked) void w.close().catch(() => undefined)
        } catch {}
      }
      return {
        stream: clientStream,
        dispose: () => {
          safeClose(clientToAgent.writable)
          safeClose(agentToClient.writable)
        },
      }
    }

    const runtime = await createAcpRuntime({
      launch: { agentId: 'antigravity', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      streamFactory: async () => makeAntigravityRejectSteerStream(),
      onSessionEvent: () => {},
    })

    const turnEvents: AgentEvent[] = []
    const turnPromise = runtime.prompt('first', 'msg-agy-1', (e) => turnEvents.push(e))
    await vi.waitFor(() => {
      expect(turnEvents.some((e) => e.type === 'content_delta')).toBe(true)
    })

    await expect(runtime.interject('steered', 'u-steer-fail')).rejects.toThrow()
    expect(turnEvents.some((e) => e.type === 'message_error')).toBe(false)

    finishLeg0?.({ stopReason: 'end_turn' })
    await turnPromise
    expect(turnEvents.some((e) => e.type === 'message_complete' && e.messageId === 'msg-agy-1')).toBe(true)

    await runtime.close()
  })
})

