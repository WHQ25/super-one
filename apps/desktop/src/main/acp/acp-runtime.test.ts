import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Stream,
} from '@agentclientprotocol/sdk'
import { createAcpRuntime } from './acp-runtime'
import { setSuperoneMcpBridgeRuntime } from '../mcp/superone-mcp-stdio-state'
import { ACP_SYSTEM_PROMPT_BLOCK } from '../agent/superone-system-prompt'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: () => ({ executable: '/fake/node', env: { NODE_FAKE: '1' } }),
}))

interface CapturedRequests {
  initialize?: Record<string, unknown>
  newSession: Record<string, unknown> | null
  prompts: Array<Array<{ type: string; text?: string }>>
}

function makeEchoAgentStream(
  captured?: CapturedRequests,
  agentCapabilities: Record<string, unknown> = {},
): { stream: Stream; dispose: () => void } {
  const agentApp = agent({ name: 'test-agent' })
    .onRequest(methods.agent.initialize, async (ctx) => {
      if (captured) captured.initialize = ctx.params as Record<string, unknown>
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities,
      }
    })
    .onRequest(methods.agent.session.new, async (ctx) => {
      if (captured) captured.newSession = ctx.params as Record<string, unknown>
      return { sessionId: 'test-session-1' }
    })
    .onRequest(methods.agent.session.prompt, async (ctx) => {
      if (captured) {
        captured.prompts.push(ctx.params.prompt as Array<{ type: string; text?: string }>)
      }
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
  it.each([
    ['grok-build', false],
    ['custom', true],
  ])('advertises terminal capability for %s as %s', async (agentId, terminal) => {
    const captured: CapturedRequests = { newSession: null, prompts: [] }
    const runtime = await createAcpRuntime({
      launch: {
        agentId,
        command: 'unused',
        defaultCwd: '/tmp/proj',
      },
      permission: {
        request: async () => ({ outcome: { outcome: 'cancelled' } }),
      },
      streamFactory: async () => makeEchoAgentStream(captured),
    })

    await runtime.close()
    await new Promise((r) => setTimeout(r, 0))

    expect(captured.initialize?.clientCapabilities).toMatchObject({ terminal })
  })

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

describe('ACP host integration (MCP + system prompt)', () => {
  const bridge = {
    endpoint: 'http://127.0.0.1:9999/mcp',
    token: 'tok-abc',
    bridgeScriptPath: '/fake/bridge.js',
  }

  beforeEach(() => setSuperoneMcpBridgeRuntime(bridge))
  afterEach(() => setSuperoneMcpBridgeRuntime(null))

  async function run(opts: {
    captured: CapturedRequests
    superoneSessionId?: string
    additionalRoots?: string[]
    agentCapabilities?: Record<string, unknown>
    prompts?: string[]
  }) {
    const runtime = await createAcpRuntime({
      launch: { agentId: 'custom', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      superoneSessionId: opts.superoneSessionId,
      additionalRoots: opts.additionalRoots,
      streamFactory: async () => makeEchoAgentStream(opts.captured, opts.agentCapabilities),
    })
    for (const [i, text] of (opts.prompts ?? []).entries()) {
      await runtime.prompt(text, `msg-${i + 1}`, () => {})
    }
    await runtime.close()
    await new Promise((r) => setTimeout(r, 0))
  }

  it('attaches the superone MCP server to session/new with env as an ACP name/value array', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [] }
    await run({ captured, superoneSessionId: 'sid-42' })

    const servers = captured.newSession?.mcpServers as Array<Record<string, unknown>>
    expect(servers).toHaveLength(1)
    expect(servers[0].name).toBe('superone')
    expect(servers[0].command).toBe('/fake/node')
    expect(servers[0].args).toEqual(['/fake/bridge.js'])
    // ACP's McpServerStdio.env is Array<EnvVariable>, not the Record shape Codex uses.
    expect(servers[0].env).toEqual(
      expect.arrayContaining([
        { name: 'SUPERONE_MCP_SESSION_ID', value: 'sid-42' },
        { name: 'SUPERONE_MCP_IPC_TOKEN', value: 'tok-abc' },
        { name: 'SUPERONE_MCP_IPC_ENDPOINT', value: bridge.endpoint },
      ]),
    )
  })

  it('sends no MCP server when the session has no superone id', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [] }
    await run({ captured })
    expect(captured.newSession?.mcpServers).toEqual([])
  })

  it('prepends the host-context block to the first prompt only', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [] }
    await run({ captured, superoneSessionId: 'sid-42', prompts: ['first', 'second'] })

    expect(captured.prompts).toHaveLength(2)
    expect(captured.prompts[0][0]).toEqual({ type: 'text', text: ACP_SYSTEM_PROMPT_BLOCK })
    expect(captured.prompts[0].some((b) => b.text === 'first')).toBe(true)
    expect(captured.prompts[1].some((b) => b.text === ACP_SYSTEM_PROMPT_BLOCK)).toBe(false)
    expect(captured.prompts[1][0]).toEqual({ type: 'text', text: 'second' })
  })

  it('omits the host-context block when no MCP server is attached', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [] }
    // Without the tools the block names, the instructions would point nowhere.
    await run({ captured, prompts: ['first'] })
    expect(captured.prompts[0].some((b) => b.text === ACP_SYSTEM_PROMPT_BLOCK)).toBe(false)
  })

  it('sends additionalDirectories only when the agent advertises the capability', async () => {
    const withCap: CapturedRequests = { newSession: null, prompts: [] }
    await run({
      captured: withCap,
      superoneSessionId: 'sid-42',
      additionalRoots: ['/tmp/other'],
      agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } },
    })
    expect(withCap.newSession?.additionalDirectories).toEqual(['/tmp/other'])

    // grok-build advertises `sessionCapabilities: {}` — extra roots must be dropped.
    const withoutCap: CapturedRequests = { newSession: null, prompts: [] }
    await run({
      captured: withoutCap,
      superoneSessionId: 'sid-42',
      additionalRoots: ['/tmp/other'],
      agentCapabilities: { sessionCapabilities: {} },
    })
    expect(withoutCap.newSession?.additionalDirectories).toBeUndefined()
  })
})
