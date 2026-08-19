import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Stream,
} from '@agentclientprotocol/sdk'
import { createAcpRuntime } from './acp-runtime'
import {
  XAI_CONSENT_RECORD,
  XAI_RECAP,
  XAI_YOLO_MODE_CHANGED,
  xaiExtWireMethod,
} from './acp-xai-extensions'
import { setSuperoneMcpBridgeRuntime } from '../mcp/superone-mcp-stdio-state'
import { deriveSuperoneMcpSessionToken } from '../mcp/superone-mcp-auth'
import { ACP_SYSTEM_PROMPT_BLOCK } from '../agent/superone-system-prompt'
import type { AgentEvent } from '@superone/shared/agent-types'

// Grok routes x.ai methods only under the `_` wire prefix; the bare name is
// rejected with `Method not found`. The in-process test agent mirrors the real
// agent by registering the same wire names SuperOne must send.
const XAI_RECAP_WIRE = xaiExtWireMethod(XAI_RECAP)
const XAI_YOLO_MODE_CHANGED_WIRE = xaiExtWireMethod(XAI_YOLO_MODE_CHANGED)
const XAI_CONSENT_RECORD_WIRE = xaiExtWireMethod(XAI_CONSENT_RECORD)

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: () => ({ executable: '/fake/node', env: { NODE_FAKE: '1' } }),
}))

// Isolate session/new MCP list from the developer's real ~/.claude.json MCP configs.
vi.mock('../mcp-config-service', () => ({
  listMcpConfigs: vi.fn(() => []),
}))

interface CapturedRequests {
  initialize?: Record<string, unknown>
  newSession: Record<string, unknown> | null
  prompts: Array<Array<{ type: string; text?: string }>>
  notifications: Array<{ method: string; params: unknown }>
  setModelRequests?: Array<Record<string, unknown>>
}

interface CapturedLoad {
  loads: Array<Record<string, unknown>>
  news: number
}

function makeEchoAgentStream(
  captured?: CapturedRequests,
  agentCapabilities: Record<string, unknown> = {},
  loadCapture?: CapturedLoad,
): { stream: Stream; dispose: () => void } {
  if (captured && !captured.notifications) captured.notifications = []
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
      if (loadCapture) loadCapture.news += 1
      return { sessionId: 'test-session-1' }
    })
    .onRequest(methods.agent.session.load, async (ctx) => {
      if (loadCapture) loadCapture.loads.push(ctx.params as Record<string, unknown>)
      // Replay a historical chunk then return (client drains before normal pump).
      await ctx.client.notify(methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'replayed-history' },
        },
      })
      return {
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'm1',
            options: [{ value: 'm1', name: 'Model 1' }],
          },
        ],
      }
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
    // Custom methods need an explicit params parser (same pattern as client onRequest).
    .onNotification(
      XAI_YOLO_MODE_CHANGED_WIRE,
      (raw: unknown) => raw,
      async (ctx) => {
        if (captured) {
          captured.notifications.push({ method: XAI_YOLO_MODE_CHANGED_WIRE, params: ctx.params })
        }
      },
    )
    .onRequest(
      'session/set_model',
      (raw: unknown) => raw,
      async (ctx) => {
        if (captured) {
          captured.setModelRequests = captured.setModelRequests ?? []
          captured.setModelRequests.push(ctx.params as Record<string, unknown>)
        }
        return {}
      },
    )
    .onRequest(methods.agent.session.setMode, async () => ({}))

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
    ['grok-build', false, false],
    ['custom', true, true],
  ])('advertises local delegation capabilities for %s', async (agentId, terminal, hostFs) => {
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

    expect(captured.initialize?.clientCapabilities).toMatchObject({
      terminal,
      fs: { readTextFile: hostFs, writeTextFile: hostFs },
    })
    expect(captured.initialize?._meta).toMatchObject({
      askUserQuestion: true,
      exitPlanMode: true,
      clientIdentifier: 'superone',
    })
    const clientInfo = captured.initialize?.clientInfo as { name?: string; version?: string }
    expect(clientInfo?.name).toBe('superone')
    expect(clientInfo?.version).toMatch(/^\d+\.\d+/)
    expect(clientInfo?.version).not.toBe('0.0.0')
  })

  it('parses sessionRecap from initialize and requests x.ai/recap', async () => {
    const recapCalls: Array<Record<string, unknown>> = []
    const agentApp = agent({ name: 'recap-agent' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
        _meta: { sessionRecap: true },
      }))
      .onRequest(methods.agent.session.new, async () => ({ sessionId: 'recap-session' }))
      .onRequest(methods.agent.session.prompt, async () => ({ stopReason: 'end_turn' as const }))
      .onNotification(methods.agent.session.cancel, async () => {})
      .onRequest(
        XAI_RECAP_WIRE,
        (raw: unknown) => raw,
        async (ctx) => {
          recapCalls.push(ctx.params as Record<string, unknown>)
          return { ok: true }
        },
      )
    const clientToAgent = new TransformStream<Uint8Array>()
    const agentToClient = new TransformStream<Uint8Array>()
    agentApp.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable))
    const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
    const runtime = await createAcpRuntime({
      launch: { agentId: 'grok-build', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      streamFactory: async () => ({
        stream: clientStream,
        dispose: () => {
          try { void clientToAgent.writable.close().catch(() => undefined) } catch { /* */ }
          try { void agentToClient.writable.close().catch(() => undefined) } catch { /* */ }
        },
      }),
    })
    expect(runtime.isSessionRecapAvailable()).toBe(true)
    await runtime.requestRecap(true)
    expect(recapCalls).toEqual([{ sessionId: 'recap-session', auto: true }])
    await runtime.close()
  })

  it('records consent after the host accepts a settings/update gate', async () => {
    const consentRecords: Array<Record<string, unknown>> = []
    const agentApp = agent({ name: 'consent-agent' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, async (ctx) => {
        queueMicrotask(() => {
          void ctx.client.notify('_x.ai/settings/update' as never, {
            consent_gate: { id: 'tos', version: 2, title: 'Terms' },
          } as never)
        })
        return { sessionId: 'consent-session' }
      })
      .onRequest(methods.agent.session.prompt, async () => ({ stopReason: 'end_turn' as const }))
      .onNotification(methods.agent.session.cancel, async () => {})
      .onRequest(
        XAI_CONSENT_RECORD_WIRE,
        (raw: unknown) => raw,
        async (ctx) => {
          consentRecords.push(ctx.params as Record<string, unknown>)
          return { ok: true }
        },
      )
    const clientToAgent = new TransformStream<Uint8Array>()
    const agentToClient = new TransformStream<Uint8Array>()
    agentApp.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable))
    const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
    const runtime = await createAcpRuntime({
      launch: { agentId: 'grok-build', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      consentNotice: { request: async () => true },
      streamFactory: async () => ({
        stream: clientStream,
        dispose: () => {
          try { void clientToAgent.writable.close().catch(() => undefined) } catch { /* */ }
          try { void agentToClient.writable.close().catch(() => undefined) } catch { /* */ }
        },
      }),
    })
    await vi.waitFor(() => {
      expect(consentRecords).toEqual([{ noticeId: 'tos', version: 2 }])
    })
    await runtime.close()
  })

  it('passes yoloMode on session/new when permissionMode is bypassPermissions', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [], notifications: [] }
    const runtime = await createAcpRuntime({
      launch: {
        agentId: 'grok-build',
        command: 'unused',
        defaultCwd: '/tmp/proj',
      },
      permissionMode: 'bypassPermissions',
      permission: {
        request: async () => ({ outcome: { outcome: 'cancelled' } }),
      },
      streamFactory: async () => makeEchoAgentStream(captured),
    })
    await runtime.close()
    expect(captured.newSession?._meta).toMatchObject({
      yoloMode: true,
      clientIdentifier: 'superone',
    })
  })

  it('passes autoMode and clientIdentifier on session/new when permissionMode is auto', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [], notifications: [] }
    const runtime = await createAcpRuntime({
      launch: {
        agentId: 'grok-build',
        command: 'unused',
        defaultCwd: '/tmp/proj',
      },
      permissionMode: 'auto',
      permission: {
        request: async () => ({ outcome: { outcome: 'cancelled' } }),
      },
      streamFactory: async () => makeEchoAgentStream(captured),
    })
    await runtime.close()
    expect(captured.newSession?._meta).toMatchObject({
      autoMode: true,
      clientIdentifier: 'superone',
    })
    expect((captured.newSession?._meta as { yoloMode?: boolean } | undefined)?.yoloMode).toBeUndefined()
  })

  it('stamps reasoningEffort on session/new so spawn sampling matches the picker', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [], notifications: [] }
    const runtime = await createAcpRuntime({
      launch: {
        agentId: 'grok-build',
        command: 'unused',
        defaultCwd: '/tmp/proj',
      },
      permissionMode: 'auto',
      reasoningEffort: 'xhigh',
      permission: {
        request: async () => ({ outcome: { outcome: 'cancelled' } }),
      },
      streamFactory: async () => makeEchoAgentStream(captured),
    })
    await runtime.close()
    expect(captured.newSession?._meta).toMatchObject({
      autoMode: true,
      clientIdentifier: 'superone',
      reasoningEffort: 'xhigh',
    })
  })

  it('stamps reasoningEffort on session/load', async () => {
    const loadCapture: CapturedLoad = { loads: [], news: 0 }
    const captured: CapturedRequests = { newSession: null, prompts: [], notifications: [] }
    const runtime = await createAcpRuntime({
      launch: { agentId: 'grok-build', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      resumeSessionId: 'prior-grok-session',
      reasoningEffort: 'low',
      streamFactory: async () => makeEchoAgentStream(
        captured,
        { loadSession: true },
        loadCapture,
      ),
    })
    expect(loadCapture.loads[0]?._meta).toMatchObject({
      clientIdentifier: 'superone',
      reasoningEffort: 'low',
    })
    await runtime.close()
  })

  it('omits yolo/auto flags on session/new for default mode but still stamps clientIdentifier', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [], notifications: [] }
    const runtime = await createAcpRuntime({
      launch: {
        agentId: 'grok-build',
        command: 'unused',
        defaultCwd: '/tmp/proj',
      },
      permissionMode: 'default',
      permission: {
        request: async () => ({ outcome: { outcome: 'cancelled' } }),
      },
      streamFactory: async () => makeEchoAgentStream(captured),
    })
    await runtime.close()
    const meta = captured.newSession?._meta as Record<string, unknown> | null | undefined
    expect(meta?.yoloMode).toBeUndefined()
    expect(meta?.autoMode).toBeUndefined()
    expect(meta?.clientIdentifier).toBe('superone')
  })

  it('setModel sends session/set_model with optional reasoningEffort meta', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [], notifications: [] }
    const runtime = await createAcpRuntime({
      launch: {
        agentId: 'grok-build',
        command: 'unused',
        defaultCwd: '/tmp/proj',
      },
      permission: {
        request: async () => ({ outcome: { outcome: 'cancelled' } }),
      },
      streamFactory: async () => makeEchoAgentStream(captured),
    })
    await runtime.setModel('grok-4.5')
    await runtime.setModel('grok-4.5', { reasoningEffort: 'high' })
    await new Promise((r) => setTimeout(r, 20))
    expect(captured.setModelRequests).toEqual([
      { sessionId: 'test-session-1', modelId: 'grok-4.5' },
      {
        sessionId: 'test-session-1',
        modelId: 'grok-4.5',
        _meta: { reasoningEffort: 'high' },
      },
    ])
    expect(runtime.getModelConfig()?.selectedModelId).toBe('grok-4.5')
    await runtime.close()
  })

  it('setPermissionMode plan uses session/set_mode without yolo notification', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [], notifications: [] }
    const setModeCalls: Array<Record<string, unknown>> = []
    const agentApp = agent({ name: 'plan-mode-agent' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, async () => ({ sessionId: 'test-session-1' }))
      .onRequest(methods.agent.session.setMode, async (ctx) => {
        setModeCalls.push(ctx.params as Record<string, unknown>)
        return {}
      })
      .onRequest(methods.agent.session.prompt, async () => ({ stopReason: 'end_turn' as const }))
      .onNotification(methods.agent.session.cancel, async () => {})
      .onNotification(
        XAI_YOLO_MODE_CHANGED_WIRE,
        (raw: unknown) => raw,
        async (ctx) => {
          captured.notifications.push({ method: XAI_YOLO_MODE_CHANGED_WIRE, params: ctx.params })
        },
      )

    const clientToAgent = new TransformStream<Uint8Array>()
    const agentToClient = new TransformStream<Uint8Array>()
    agentApp.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable))
    const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)

    const runtime = await createAcpRuntime({
      launch: { agentId: 'grok-build', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      streamFactory: async () => ({
        stream: clientStream,
        dispose: () => {
          try { void clientToAgent.writable.close().catch(() => undefined) } catch { /* */ }
          try { void agentToClient.writable.close().catch(() => undefined) } catch { /* */ }
        },
      }),
    })
    await runtime.setPermissionMode('plan')
    await new Promise((r) => setTimeout(r, 20))
    expect(setModeCalls).toContainEqual({ sessionId: 'test-session-1', modeId: 'plan' })
    expect(captured.notifications.filter((n) => n.method === XAI_YOLO_MODE_CHANGED_WIRE)).toHaveLength(0)

    await runtime.setPermissionMode('default')
    await new Promise((r) => setTimeout(r, 20))
    expect(setModeCalls.some((c) => c.modeId === 'default')).toBe(true)
    expect(captured.notifications.some((n) => n.method === XAI_YOLO_MODE_CHANGED_WIRE)).toBe(true)
    await runtime.close()
  })

  it('setPermissionMode notifies x.ai/yolo_mode_changed with always-approve params', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [], notifications: [] }
    const runtime = await createAcpRuntime({
      launch: {
        agentId: 'grok-build',
        command: 'unused',
        defaultCwd: '/tmp/proj',
      },
      permissionMode: 'default',
      permission: {
        request: async () => ({ outcome: { outcome: 'cancelled' } }),
      },
      streamFactory: async () => makeEchoAgentStream(captured),
    })
    await runtime.setPermissionMode('bypassPermissions')
    // allow notify to flush across streams
    await new Promise((r) => setTimeout(r, 20))
    expect(captured.notifications).toContainEqual({
      method: XAI_YOLO_MODE_CHANGED_WIRE,
      params: {
        yolo_mode: true,
        auto_mode: false,
        permission_mode: 'always-approve',
      },
    })
    await runtime.setPermissionMode('default')
    await new Promise((r) => setTimeout(r, 20))
    expect(captured.notifications.some((n) =>
      n.method === XAI_YOLO_MODE_CHANGED_WIRE
      && (n.params as { permission_mode?: string }).permission_mode === 'ask',
    )).toBe(true)
    await runtime.close()
  })

  it('setPermissionMode auto → always-approve clears auto and enables yolo without a client filter', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [], notifications: [] }
    const runtime = await createAcpRuntime({
      launch: {
        agentId: 'grok-build',
        command: 'unused',
        defaultCwd: '/tmp/proj',
      },
      permissionMode: 'auto',
      permission: {
        request: async () => ({ outcome: { outcome: 'cancelled' } }),
      },
      streamFactory: async () => makeEchoAgentStream(captured),
    })
    await runtime.setPermissionMode('bypassPermissions')
    await new Promise((r) => setTimeout(r, 20))
    const yoloNotes = captured.notifications.filter((n) => n.method === XAI_YOLO_MODE_CHANGED_WIRE)
    expect(yoloNotes).toContainEqual({
      method: XAI_YOLO_MODE_CHANGED_WIRE,
      params: {
        yolo_mode: true,
        auto_mode: false,
        permission_mode: 'always-approve',
      },
    })
    expect(yoloNotes.some((n) => n.params && typeof n.params === 'object' && 'clientIdentifier' in n.params)).toBe(false)
    await runtime.close()
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

  it('maps x.ai/session_notification workflow progress after prompt returns', async () => {
    const sessionEvents: AgentEvent[] = []
    let agentNotifyClient: {
      notify: (method: string, params: unknown) => Promise<void>
    } | null = null

    const agentApp = agent({ name: 'workflow-agent' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, async () => ({ sessionId: 'sess-wf' }))
      .onRequest(methods.agent.session.prompt, async (ctx) => {
        agentNotifyClient = ctx.client
        // Launch tool complete with run_id for correlation
        await ctx.client.notify(methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tc_wf',
            title: 'workflow',
            kind: 'other',
            status: 'pending',
          },
        })
        await ctx.client.notify(methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tc_wf',
            status: 'completed',
            rawOutput: {
              run_id: 'wf_live',
              task_id: 'wf_live',
              name: 'review-changes',
              message: 'Workflow review-changes started. Progress appears under /workflows.',
            },
          },
        })
        return { stopReason: 'end_turn' as const }
      })
      .onNotification(methods.agent.session.cancel, async () => {})
      .onRequest(methods.agent.session.setMode, async () => ({}))

    const clientToAgent = new TransformStream<Uint8Array>()
    const agentToClient = new TransformStream<Uint8Array>()
    agentApp.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable))
    const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
    const dispose = () => {
      try {
        if (!clientToAgent.writable.locked) void clientToAgent.writable.close().catch(() => undefined)
      } catch { /* ignore */ }
      try {
        if (!agentToClient.writable.locked) void agentToClient.writable.close().catch(() => undefined)
      } catch { /* ignore */ }
    }

    const runtime = await createAcpRuntime({
      launch: { agentId: 'grok-build', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      onSessionEvent: (e) => sessionEvents.push(e),
      streamFactory: async () => ({ stream: clientStream, dispose }),
    })

    const promptEvents: AgentEvent[] = []
    await runtime.prompt('run workflow', 'msg-wf', (e) => promptEvents.push(e))
    // After prompt, progressive bus continues via onSessionEvent
    expect(agentNotifyClient).toBeTruthy()
    await agentNotifyClient!.notify('x.ai/session_notification', {
      sessionId: 'sess-wf',
      update: {
        sessionUpdate: 'workflow_updated',
        run_id: 'wf_live',
        revision: 1,
        name: 'review-changes',
        objective: 'Review',
        status: 'active',
        current_phase: 'Execute',
        elapsed_ms: 100,
        agents: [{ agent_id: 'a1', label: 'Worker', state: 'running', tokens_used: 10 }],
      },
    })
    await agentNotifyClient!.notify('x.ai/session_notification', {
      sessionId: 'sess-wf',
      update: {
        sessionUpdate: 'workflow_updated',
        run_id: 'wf_live',
        revision: 2,
        name: 'review-changes',
        objective: 'Review',
        status: 'complete',
        elapsed_ms: 500,
        result_summary: 'Done reviewing',
      },
    })
    await new Promise((r) => setTimeout(r, 50))

    const all = [...promptEvents, ...sessionEvents]
    const started = all.filter((e) => e.type === 'task_started' && e.taskId === 'wf_live')
    const progress = all.filter((e) => e.type === 'task_progress' && e.taskId === 'wf_live')
    const done = all.filter((e) => e.type === 'task_notification' && e.taskId === 'wf_live')
    expect(started.length).toBeGreaterThanOrEqual(1)
    expect(progress.length).toBeGreaterThanOrEqual(1)
    expect(done.some((e) => e.type === 'task_notification' && e.resultText === 'Done reviewing')).toBe(true)
    // Correlation from tool_result
    expect(started[0]).toMatchObject({ toolUseId: 'tc_wf' })

    await runtime.close()
    await new Promise((r) => setTimeout(r, 0))
  })

  it('opens an assistant bubble for agent auto-wake chunks after prompt returns', async () => {
    const sessionEvents: AgentEvent[] = []
    let agentNotifyClient: {
      notify: (method: string, params: unknown) => Promise<void>
    } | null = null

    const agentApp = agent({ name: 'wake-agent' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, async () => ({ sessionId: 'sess-wake' }))
      .onRequest(methods.agent.session.prompt, async (ctx) => {
        agentNotifyClient = ctx.client
        await ctx.client.notify(methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'launched workflow' },
          },
        })
        return { stopReason: 'end_turn' as const }
      })
      .onNotification(methods.agent.session.cancel, async () => {})
      .onRequest(methods.agent.session.setMode, async () => ({}))

    const clientToAgent = new TransformStream<Uint8Array>()
    const agentToClient = new TransformStream<Uint8Array>()
    agentApp.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable))
    const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
    const dispose = () => {
      try {
        if (!clientToAgent.writable.locked) void clientToAgent.writable.close().catch(() => undefined)
      } catch { /* ignore */ }
      try {
        if (!agentToClient.writable.locked) void agentToClient.writable.close().catch(() => undefined)
      } catch { /* ignore */ }
    }

    const runtime = await createAcpRuntime({
      launch: { agentId: 'grok-build', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      onSessionEvent: (e) => sessionEvents.push(e),
      streamFactory: async () => ({ stream: clientStream, dispose }),
    })

    const promptEvents: AgentEvent[] = []
    await runtime.prompt('run it', 'msg-launch', (e) => promptEvents.push(e))
    expect(agentNotifyClient).toBeTruthy()

    // After the SuperOne prompt returns, Grok workflow auto-wake streams a new reply.
    await agentNotifyClient!.notify(methods.client.session.update, {
      sessionId: 'sess-wake',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'wake-msg-1',
        content: { type: 'text', text: 'Workflow finished: all checks passed.' },
      },
    })
    await agentNotifyClient!.notify('x.ai/session_notification', {
      sessionId: 'sess-wake',
      update: {
        sessionUpdate: 'turn_completed',
        prompt_id: 'workflow-completed-wf_1-3',
        stop_reason: 'end_turn',
      },
    })
    await new Promise((r) => setTimeout(r, 50))

    const starts = sessionEvents.filter((e) => e.type === 'message_start')
    expect(starts.length).toBeGreaterThanOrEqual(1)
    const wakeId = starts[0]!.type === 'message_start' ? starts[0]!.message.id : ''
    expect(wakeId).toMatch(/^acp_wake_/)

    const texts = sessionEvents
      .filter((e): e is Extract<AgentEvent, { type: 'content_delta' }> => e.type === 'content_delta')
      .filter((e) => e.messageId === wakeId)
      .map((e) => (e.delta.type === 'text' ? e.delta.text : ''))
      .join('')
    expect(texts).toContain('Workflow finished: all checks passed.')

    expect(sessionEvents.some((e) => e.type === 'message_complete' && e.messageId === wakeId)).toBe(true)
    expect(sessionEvents.some((e) => e.type === 'status_change' && e.status === 'idle')).toBe(true)

    await runtime.close()
    await new Promise((r) => setTimeout(r, 0))
  })

  it('completes agent auto-wake on turn_completed even when mapped events are empty', async () => {
    const sessionEvents: AgentEvent[] = []
    let agentNotifyClient: {
      notify: (method: string, params: unknown) => Promise<void>
    } | null = null

    const agentApp = agent({ name: 'wake-empty-agent' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, async () => ({ sessionId: 'sess-wake-empty' }))
      .onRequest(methods.agent.session.prompt, async (ctx) => {
        agentNotifyClient = ctx.client
        return { stopReason: 'end_turn' as const }
      })
      .onNotification(methods.agent.session.cancel, async () => {})
      .onRequest(methods.agent.session.setMode, async () => ({}))

    const clientToAgent = new TransformStream<Uint8Array>()
    const agentToClient = new TransformStream<Uint8Array>()
    agentApp.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable))
    const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
    const dispose = () => {
      try {
        if (!clientToAgent.writable.locked) void clientToAgent.writable.close().catch(() => undefined)
      } catch { /* ignore */ }
      try {
        if (!agentToClient.writable.locked) void agentToClient.writable.close().catch(() => undefined)
      } catch { /* ignore */ }
    }

    const runtime = await createAcpRuntime({
      launch: { agentId: 'grok-build', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      onSessionEvent: (e) => sessionEvents.push(e),
      streamFactory: async () => ({ stream: clientStream, dispose }),
    })

    await runtime.prompt('run it', 'msg-launch', () => {})
    expect(agentNotifyClient).toBeTruthy()

    await agentNotifyClient!.notify(methods.client.session.update, {
      sessionId: 'sess-wake-empty',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'wake-msg-empty',
        content: { type: 'text', text: 'waking' },
      },
    })
    await new Promise((r) => setTimeout(r, 30))
    const wakeStart = sessionEvents.find((e) => e.type === 'message_start')
    expect(wakeStart?.type === 'message_start' ? wakeStart.message.id : '').toMatch(/^acp_wake_/)
    const wakeId = wakeStart!.type === 'message_start' ? wakeStart!.message.id : ''

    // turn_completed closes the wake bubble even if mappers emit no content events.
    await agentNotifyClient!.notify('x.ai/session_notification', {
      sessionId: 'sess-wake-empty',
      update: {
        sessionUpdate: 'turn_completed',
        prompt_id: 'workflow-completed-wf_empty-1',
        stop_reason: 'end_turn',
      },
    })
    await new Promise((r) => setTimeout(r, 50))

    expect(sessionEvents.some((e) => e.type === 'message_complete' && e.messageId === wakeId)).toBe(true)
    expect(sessionEvents.some((e) => e.type === 'status_change' && e.status === 'idle')).toBe(true)

    await runtime.close()
    await new Promise((r) => setTimeout(r, 0))
  })

  it('finalizes an open agent auto-wake before a new user prompt', async () => {
    const sessionEvents: AgentEvent[] = []
    let agentNotifyClient: {
      notify: (method: string, params: unknown) => Promise<void>
    } | null = null
    let promptCount = 0

    const agentApp = agent({ name: 'wake-prompt-agent' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, async () => ({ sessionId: 'sess-wake-prompt' }))
      .onRequest(methods.agent.session.prompt, async (ctx) => {
        agentNotifyClient = ctx.client
        promptCount += 1
        return { stopReason: 'end_turn' as const }
      })
      .onNotification(methods.agent.session.cancel, async () => {})
      .onRequest(methods.agent.session.setMode, async () => ({}))

    const clientToAgent = new TransformStream<Uint8Array>()
    const agentToClient = new TransformStream<Uint8Array>()
    agentApp.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable))
    const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)
    const dispose = () => {
      try {
        if (!clientToAgent.writable.locked) void clientToAgent.writable.close().catch(() => undefined)
      } catch { /* ignore */ }
      try {
        if (!agentToClient.writable.locked) void agentToClient.writable.close().catch(() => undefined)
      } catch { /* ignore */ }
    }

    const runtime = await createAcpRuntime({
      launch: { agentId: 'grok-build', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      onSessionEvent: (e) => sessionEvents.push(e),
      streamFactory: async () => ({ stream: clientStream, dispose }),
    })

    await runtime.prompt('first', 'msg-1', () => {})
    expect(agentNotifyClient).toBeTruthy()

    await agentNotifyClient!.notify(methods.client.session.update, {
      sessionId: 'sess-wake-prompt',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'wake-open',
        content: { type: 'text', text: 'still waking…' },
      },
    })
    await new Promise((r) => setTimeout(r, 30))
    const wakeStart = sessionEvents.find((e) => e.type === 'message_start')
    const wakeId = wakeStart!.type === 'message_start' ? wakeStart!.message.id : ''
    expect(wakeId).toMatch(/^acp_wake_/)

    const handoffEventStart = sessionEvents.length
    const secondPromptEvents: AgentEvent[] = []
    await runtime.prompt('second', 'msg-2', (e) => secondPromptEvents.push(e))
    expect(promptCount).toBe(2)

    // Wake bubble must be completed on the session bus before the next user prompt proceeds.
    const handoffEvents = sessionEvents.slice(handoffEventStart)
    expect(handoffEvents.some((e) => e.type === 'message_complete' && e.messageId === wakeId)).toBe(true)
    // AcpBackend emits streaming before runtime.prompt; the handoff must not overwrite it.
    expect(handoffEvents.some((e) => e.type === 'status_change' && e.status === 'idle')).toBe(false)

    await runtime.close()
    await new Promise((r) => setTimeout(r, 0))
  })
})

describe('ACP host integration (MCP + system prompt)', () => {
  const bridge = {
    endpoint: 'http://127.0.0.1:9999/mcp',
    httpUrl: 'http://127.0.0.1:9998/mcp',
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
        { name: 'SUPERONE_MCP_IPC_TOKEN', value: deriveSuperoneMcpSessionToken('tok-abc', 'sid-42') },
        { name: 'SUPERONE_MCP_IPC_ENDPOINT', value: bridge.endpoint },
      ]),
    )
  })

  it('sends no MCP server when the session has no superone id', async () => {
    const captured: CapturedRequests = { newSession: null, prompts: [] }
    await run({ captured })
    expect(captured.newSession?.mcpServers).toEqual([])
  })

  it('loads an existing session when loadSession is advertised and resumeSessionId is set', async () => {
    const loadCapture: CapturedLoad = { loads: [], news: 0 }
    const captured: CapturedRequests = { newSession: null, prompts: [] }
    const runtime = await createAcpRuntime({
      launch: { agentId: 'grok-build', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      superoneSessionId: 'sid-load',
      resumeSessionId: 'prior-grok-session',
      streamFactory: async () => makeEchoAgentStream(
        captured,
        { loadSession: true },
        loadCapture,
      ),
    })
    expect(runtime.sessionId).toBe('prior-grok-session')
    expect(loadCapture.loads).toHaveLength(1)
    expect(loadCapture.loads[0]).toMatchObject({
      sessionId: 'prior-grok-session',
      cwd: '/tmp/proj',
    })
    expect(loadCapture.news).toBe(0)
    // Model catalog from load response configOptions
    expect(runtime.getModelConfig()?.selectedModelId).toBe('m1')
    await runtime.close()
  })

  it('falls back to session/new when session/load fails', async () => {
    const loadCapture: CapturedLoad = { loads: [], news: 0 }
    const captured: CapturedRequests = { newSession: null, prompts: [] }
    // Agent advertises loadSession but rejects the load request.
    const agentApp = agent({ name: 'fail-load' })
      .onRequest(methods.agent.initialize, async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
      }))
      .onRequest(methods.agent.session.load, async () => {
        loadCapture.loads.push({})
        throw new Error('unknown session')
      })
      .onRequest(methods.agent.session.new, async (ctx) => {
        loadCapture.news += 1
        captured.newSession = ctx.params as Record<string, unknown>
        return { sessionId: 'fresh-session' }
      })
      .onRequest(methods.agent.session.prompt, async () => ({ stopReason: 'end_turn' as const }))
      .onNotification(methods.agent.session.cancel, async () => {})

    const clientToAgent = new TransformStream<Uint8Array>()
    const agentToClient = new TransformStream<Uint8Array>()
    agentApp.connect(ndJsonStream(agentToClient.writable, clientToAgent.readable))
    const clientStream = ndJsonStream(clientToAgent.writable, agentToClient.readable)

    const runtime = await createAcpRuntime({
      launch: { agentId: 'grok-build', command: 'unused', defaultCwd: '/tmp/proj' },
      permission: { request: async () => ({ outcome: { outcome: 'cancelled' } }) },
      resumeSessionId: 'missing-id',
      streamFactory: async () => ({
        stream: clientStream,
        dispose: () => {
          try { void clientToAgent.writable.close().catch(() => undefined) } catch { /* */ }
          try { void agentToClient.writable.close().catch(() => undefined) } catch { /* */ }
        },
      }),
    })
    expect(runtime.sessionId).toBe('fresh-session')
    expect(loadCapture.loads.length).toBe(1)
    expect(loadCapture.news).toBe(1)
    await runtime.close()
  })

  it('appends user MCP configs after superone when listMcpConfigs returns servers', async () => {
    const { listMcpConfigs } = await import('../mcp-config-service')
    vi.mocked(listMcpConfigs).mockReturnValueOnce([
      {
        name: 'github',
        type: 'stdio',
        scope: 'user',
        command: 'gh-mcp',
        args: [],
        env: { TOKEN: 't' },
      },
      {
        name: 'linear',
        type: 'http',
        scope: 'user',
        url: 'https://mcp.linear.app',
      },
    ])

    const captured: CapturedRequests = { newSession: null, prompts: [] }
    await run({
      captured,
      superoneSessionId: 'sid-mcp',
      agentCapabilities: {
        mcpCapabilities: { http: true, sse: false },
      },
    })

    const servers = captured.newSession?.mcpServers as Array<Record<string, unknown>>
    expect(servers.map((s) => s.name)).toEqual(['superone', 'github', 'linear'])
    expect(servers[1]).toMatchObject({
      name: 'github',
      command: 'gh-mcp',
      env: [{ name: 'TOKEN', value: 't' }],
    })
    expect(servers[2]).toMatchObject({
      type: 'http',
      name: 'linear',
      url: 'https://mcp.linear.app',
    })
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
