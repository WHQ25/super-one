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

function makeEchoAgentStream(): { stream: Stream; dispose: () => void } {
  const agentApp = agent({ name: 'test-agent' })
    .onRequest(methods.agent.initialize, async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .onRequest(methods.agent.session.new, async () => ({
      sessionId: 'test-session-1',
    }))
    .onRequest(methods.agent.session.prompt, async (ctx) => {
      await ctx.client.notify(methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'echo-ok' },
        },
      })
      return { stopReason: 'end_turn' as const }
    })
    .onNotification(methods.agent.session.cancel, async () => {})

  const clientToAgent = new TransformStream<Uint8Array>()
  const agentToClient = new TransformStream<Uint8Array>()

  const agentStream = ndJsonStream(agentToClient.writable, clientToAgent.readable)
  agentApp.connect(agentStream)

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

describe('createAcpRuntime (in-process agent)', () => {
  it('streams text then completes', async () => {
    const events: AgentEvent[] = []
    const runtime = await createAcpRuntime({
      launch: {
        agentId: 'custom',
        command: 'unused',
        defaultCwd: '/tmp/proj',
      },
      permission: {
        request: async () => ({ outcome: { outcome: 'cancelled' } }),
      },
      streamFactory: async () => makeEchoAgentStream(),
    })

    await runtime.prompt('hi', 'msg-1', (e) => events.push(e))
    await runtime.close()
    // Drain microtasks so connection teardown rejections are observed here.
    await new Promise((r) => setTimeout(r, 0))

    const texts = events
      .filter((e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta')
      .map((e) => e.delta)
      .filter((d): d is { type: 'text'; text: string } => d.type === 'text')
      .map((d) => d.text)
    expect(texts.join('')).toContain('echo-ok')
    expect(events.some((e) => e.type === 'message_complete')).toBe(true)
    expect(events.some((e) => e.type === 'status_change' && e.status === 'idle')).toBe(true)
  })
})
