import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { OpenCodeRuntime, OpenCodeRuntimeEvent, OpenCodeRuntimeOptions } from '../../opencode/opencode-runtime'
import type { OpenCodeV2Event } from '../../opencode/opencode-v2-types'

vi.mock('../../logger', () => ({ default: { debug: vi.fn(), warn: vi.fn() } }))
vi.mock('../../mcp-config-service', () => ({ listMcpConfigs: () => [] }))
vi.mock('../../mcp/superone-mcp-stdio-state', () => ({ getSuperoneMcpStdioConfig: () => null }))
const mockGateTerminalTabsCall = vi.fn()
vi.mock('../../mcp/terminal-tabs-harness-gate', () => ({
  gateTerminalTabsCall: (...args: unknown[]) => mockGateTerminalTabsCall(...args),
}))

import { OpenCodeBackend, setOpenCodeRuntimeFactory } from './opencode-backend'
import type { BackendStartOptions } from '../types'

function startOptions(): BackendStartOptions {
  return {
    sessionId: 'superone-session',
    projectPath: '/project',
    cwd: '/project',
    config: {},
    permissionMode: 'default',
    abortController: new AbortController(),
  }
}

function v2(type: string, data: Record<string, unknown>): OpenCodeRuntimeEvent {
  return { type: 'v2', event: { id: `evt-${type}`, type, data: { sessionID: 'ses_1', ...data } } as OpenCodeV2Event }
}

describe('OpenCodeBackend with OpenCode 2', () => {
  let route: (event: OpenCodeRuntimeEvent) => void
  let prompt: ReturnType<typeof vi.fn>
  let permissionReply: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockGateTerminalTabsCall.mockReset()
    prompt = vi.fn(async () => undefined)
    permissionReply = vi.fn(async () => undefined)
    const runtime = {
      sessionId: 'ses_1',
      models: [{ id: 'openai/gpt', name: 'GPT', description: '', contextWindow: 1000 }],
      agents: [],
      commands: [],
      snapshotEvents: [v2('permission.asked', { id: 'per_snapshot', action: 'shell', resources: ['ls'] })],
      prompt,
      permissionReply,
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as OpenCodeRuntime
    setOpenCodeRuntimeFactory(async (opts: OpenCodeRuntimeOptions) => {
      route = opts.onEvent
      return runtime
    })
  })

  afterEach(() => {
    setOpenCodeRuntimeFactory(null)
  })

  it('replays pending interactions and settles the turn with step metadata', async () => {
    const backend = new OpenCodeBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(startOptions())
    expect(backend.getPendingInteractions()).toEqual([
      expect.objectContaining({ type: 'permission_request', request: expect.objectContaining({ requestId: 'per_snapshot' }) }),
    ])

    const send = backend.send({ content: 'hi', model: 'openai/gpt', assistantMessageId: 'assistant-local' })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())
    route(v2('session.execution.succeeded', {}))
    route(v2('session.inbox.enqueued', { inboxID: 'msg_u', item: { type: 'user' } }))
    route(v2('session.execution.started', {}))
    route(v2('session.inbox.delivered', { inboxID: 'msg_u' }))
    route(v2('session.step.started', { assistantMessageID: 'msg_a', agent: 'build', model: { id: 'gpt', providerID: 'openai' } }))
    route(v2('session.text.delta', { assistantMessageID: 'msg_a', ordinal: 0, delta: 'Hello' }))
    route(v2('session.step.ended', {
      assistantMessageID: 'msg_a',
      finish: 'stop',
      cost: 0,
      tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
    }))
    route(v2('session.execution.succeeded', {}))
    await send

    expect(events).toContainEqual({ type: 'content_delta', messageId: 'assistant-local', delta: { type: 'text', text: 'Hello' } })
    expect(events).toContainEqual({
      type: 'message_complete',
      messageId: 'assistant-local',
      metadata: expect.objectContaining({ model: 'openai/gpt', agent: 'build', forkAnchorId: 'msg_a' }),
    })
    await backend.close()
  })

  it('answers a terminal_tabs permission from the host gate using the called tool input', async () => {
    const backend = new OpenCodeBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(startOptions())
    const send = backend.send({ content: 'start dev', model: 'openai/gpt', assistantMessageId: 'assistant-local' })
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce())

    route(v2('session.inbox.enqueued', { inboxID: 'msg_u', item: { type: 'user' } }))
    route(v2('session.execution.started', {}))
    route(v2('session.inbox.delivered', { inboxID: 'msg_u' }))
    route(v2('session.step.started', { assistantMessageID: 'msg_a', agent: 'build', model: { id: 'gpt', providerID: 'openai' } }))
    route(v2('session.tool.called', { assistantMessageID: 'msg_a', id: 'call_t', input: { action: 'run', command: 'bun run dev' } }))
    mockGateTerminalTabsCall.mockResolvedValueOnce({ status: 'allowed' })
    route(v2('permission.asked', {
      id: 'per_t',
      action: 'superone_terminal_tabs',
      resources: ['*'],
      save: ['*'],
      source: { type: 'tool', messageID: 'msg_a', id: 'call_t' },
    }))

    expect(mockGateTerminalTabsCall).toHaveBeenCalledWith(
      'superone-session',
      { action: 'run', command: 'bun run dev' },
      { signal: expect.any(AbortSignal) },
    )
    await vi.waitFor(() => expect(permissionReply).toHaveBeenCalledWith('per_t', 'once'))
    expect(events.some((event) => event.type === 'permission_request'
      && event.request.requestId === 'per_t')).toBe(false)

    route(v2('session.execution.succeeded', {}))
    await send
    await backend.close()
  })

  it('forwards once, remembered project approval and rejection as distinct native decisions', async () => {
    const backend = new OpenCodeBackend()
    await backend.start(startOptions())
    for (const [id, allow, always, decision] of [
      ['per_once', true, false, 'once'], ['per_saved', true, true, 'always'], ['per_no', false, false, 'reject'],
    ] as const) {
      route(v2('permission.asked', { id, action: 'external_directory', resources: ['/outside/reference/*'], save: ['/outside/*'] }))
      expect(backend.respondToPermission(id, allow, always)).toBe(true)
      expect(permissionReply).toHaveBeenCalledWith(id, decision)
      expect(backend.getPendingInteractions().some(event => event.type === 'permission_request' && event.request.requestId === id)).toBe(false)
    }
    await backend.close()
  })
})
