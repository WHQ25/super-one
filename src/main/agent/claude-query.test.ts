import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SendMessageRequest } from '../../shared/agent-types'
import type { MessageBridge } from './message-bridge'

const state = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  error: null as unknown,
  queryMock: vi.fn(),
}))

state.queryMock.mockImplementation((input: Record<string, unknown>) => {
  void input
  const messages = [...state.messages]
  const error = state.error
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        yield msg
      }
      if (error) throw error
    },
  }
})

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: state.queryMock,
  createSdkMcpServer: vi.fn(() => ({ type: 'sdk', name: 'superone', instance: {} })),
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('./event-trace', () => ({
  trace: vi.fn(),
}))

vi.mock('./resolve-cli', () => ({
  resolveSdkCli: vi.fn(),
  getNodeRuntime: vi.fn(() => ({})),
}))

vi.mock('../generative-ui/mcp-server', () => ({
  createGenerativeUiMcpServer: vi.fn(),
}))

vi.mock('../canvas/canvas-mcp-proxy', () => ({
  getCanvasMcpProxy: vi.fn(() => ({ type: 'sdk', name: 'superone', instance: {} })),
}))

import { buildUserMessage, createSessionQuery } from './claude-query'

beforeEach(() => {
  state.messages = []
  state.error = null
  state.queryMock.mockClear()
})

describe('buildUserMessage', () => {
  it('builds plain text content when no images are provided', () => {
    const request: SendMessageRequest = {
      content: 'Hello Claude',
    }

    const message = buildUserMessage(request, 'session-1')

    expect(message.type).toBe('user')
    expect(message.session_id).toBe('session-1')
    expect(message.parent_tool_use_id).toBeNull()
    expect(message.message.role).toBe('user')
    expect(message.message.content).toBe('Hello Claude')
  })

  it('builds image blocks and appends text block when images are provided', () => {
    const request: SendMessageRequest = {
      content: 'Please review this screenshot',
      images: [
        {
          name: 'screenshot.png',
          mimeType: 'image/png',
          base64: 'ZmFrZS1iYXNlNjQ=',
        },
      ],
    }

    const message = buildUserMessage(request, 'session-2')
    const blocks = message.message.content as Array<Record<string, unknown>>

    expect(Array.isArray(blocks)).toBe(true)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'ZmFrZS1iYXNlNjQ=',
      },
    })
    expect(blocks[1]).toEqual({
      type: 'text',
      text: 'Please review this screenshot',
    })
  })
})

describe('createSessionQuery', () => {
  it('maps mixed sdk events into agent events and completes successfully', async () => {
    state.messages = [
      {
        type: 'user',
        parent_tool_use_id: 'parent-1',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-a', content: 'ok' },
            {
              type: 'tool_result',
              tool_use_id: 'tool-b',
              content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }],
            },
            {
              type: 'tool_result',
              tool_use_id: 'tool-c',
              content: [{ type: 'image', url: 'ignored' }],
            },
          ],
        },
      },
      {
        type: 'user',
        message: { content: '<local-command-stdout>\nhello\n</local-command-stdout>' },
      },
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      { type: 'system', subtype: 'hook_started', hook_id: 'h1', hook_name: 'PreToolUse', hook_event: 'on-tool-start' },
      { type: 'system', subtype: 'hook_response', hook_id: 'h1', hook_name: 'PreToolUse', hook_event: 'on-tool-start', output: 'done', exit_code: 0, outcome: 'success' },
      { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 123 } },
      { type: 'system', subtype: 'status', status: 'compacting' },
      { type: 'system', subtype: 'task_notification', task_id: 'task-1', status: 'completed', output_file: '/tmp/out.md' },
      { type: 'auth_status', isAuthenticating: true, output: ['waiting'], error: 'auth-pending' },
      {
        type: 'assistant',
        message: {
          id: 'step-1',
          usage: { input_tokens: 10, cache_creation_input_tokens: 2, output_tokens: 0, cache_read_input_tokens: 5 },
          content: [
            { type: 'thinking', thinking: 'thinking top' },
            { type: 'tool_use', id: 'tool-write', name: 'Write', input: { file_path: '/tmp/plan.md' } },
            { type: 'tool_use', id: 'tool-bash', name: 'Bash', input: 'ls -la' },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'step-1',
          usage: { input_tokens: 999, cache_creation_input_tokens: 1, output_tokens: 0 },
          content: [],
        },
      },
      {
        type: 'assistant',
        parent_tool_use_id: 'parent-tool',
        message: {
          id: 'sub-step-1',
          usage: { input_tokens: 3, cache_creation_input_tokens: 1, output_tokens: 0 },
          content: [{ type: 'thinking', thinking: 'thinking sub' }],
        },
      },
      {
        type: 'stream_event',
        parent_tool_use_id: 'parent-tool',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tool-stream', name: 'Edit' },
        },
      },
      {
        type: 'stream_event',
        parent_tool_use_id: 'parent-tool',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial text' } },
      },
      {
        type: 'stream_event',
        parent_tool_use_id: 'parent-tool',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'partial thinking' } },
      },
      {
        type: 'stream_event',
        parent_tool_use_id: 'parent-tool',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":1' } },
      },
      {
        type: 'stream_event',
        parent_tool_use_id: 'parent-tool',
        event: { type: 'content_block_stop', index: 0 },
      },
      {
        type: 'stream_event',
        event: { type: 'message_delta', usage: { output_tokens: 7 } },
      },
      {
        type: 'stream_event',
        parent_tool_use_id: 'parent-tool',
        event: { type: 'message_delta', usage: { output_tokens: 5 } },
      },
      {
        type: 'tool_progress',
        tool_use_id: 'tool-stream',
        tool_name: 'Edit',
        elapsed_time_seconds: 2.4,
        parent_tool_use_id: 'parent-tool',
      },
      {
        type: 'tool_use_summary',
        summary: 'summary text',
        preceding_tool_use_ids: ['tool-stream'],
        parent_tool_use_id: 'parent-tool',
      },
      {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.123,
        num_turns: 2,
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: {
          'claude-3': {
            inputTokens: 10,
            outputTokens: 20,
            cacheReadInputTokens: 3,
            cacheCreationInputTokens: 4,
            costUSD: 0.04,
          },
        },
      },
    ]

    const events: Array<Record<string, unknown>> = []
    const onSessionId = vi.fn()
    const trackPlanFile = vi.fn()
    const startTime = Date.now() - 200

    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      {
        cwd: '/repo',
        model: 'claude-opus',
        permissionMode: 'default',
        canUseTool: vi.fn(),
        resume: 'resume-1',
        abortController: new AbortController(),
        trackPlanFile,
      },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => 'frontend-message-id',
      () => startTime,
      () => false,
      onSessionId
    )
    await handle.iterationDone

    expect(state.queryMock).toHaveBeenCalledTimes(1)
    const queryInput = state.queryMock.mock.calls[0][0] as Record<string, unknown>
    expect((queryInput.options as Record<string, unknown>).cwd).toBe('/repo')
    expect((queryInput.options as Record<string, unknown>).allowDangerouslySkipPermissions).toBe(false)
    expect((queryInput.options as Record<string, unknown>).settingSources).toEqual(['user', 'project', 'local'])

    expect(onSessionId).toHaveBeenCalledWith('sess-1')
    expect(trackPlanFile).toHaveBeenCalledWith('/tmp/plan.md')

    const eventTypes = events.map((e) => e.type)
    expect(eventTypes).toContain('slash_command_output')
    expect(eventTypes).toContain('hook_started')
    expect(eventTypes).toContain('hook_complete')
    expect(eventTypes).toContain('compact_boundary')
    expect(eventTypes).toContain('status_indicator')
    expect(eventTypes).toContain('task_notification')
    expect(eventTypes).toContain('auth_status')
    expect(eventTypes).toContain('tool_input_delta')
    expect(eventTypes).toContain('tool_progress')
    expect(eventTypes).toContain('message_complete')
    expect(eventTypes).toContain('status_change')

    const toolResult = events.find((e) => e.type === 'content_delta' && (e.delta as Record<string, unknown>)?.type === 'tool_result')
    expect((toolResult?.delta as Record<string, unknown>)?.summary).toBe('ok')

    const toolInputDelta = events.find((e) => e.type === 'tool_input_delta')
    expect(toolInputDelta).toMatchObject({
      messageId: 'frontend-message-id',
      toolUseId: 'tool-stream',
      partialJson: '{"a":1',
      parentToolUseId: 'parent-tool',
    })

    const messageComplete = events.find((e) => e.type === 'message_complete') as Record<string, unknown> | undefined
    const metadata = messageComplete?.metadata as Record<string, unknown>
    expect((metadata.usage as Record<string, unknown>).inputTokens).toBe(3)
    expect((metadata.usage as Record<string, unknown>).cacheReadInputTokens).toBe(0)
    expect(((metadata.modelUsage as Record<string, unknown>)['claude-3'] as Record<string, unknown>).outputTokens).toBe(20)

    const topLevelUsage = events.filter((e) => e.type === 'message_usage')
    const lastTopLevelUsage = topLevelUsage[topLevelUsage.length - 1] as Record<string, unknown>
    expect(lastTopLevelUsage.outputTokens).toBe(7)
    expect(lastTopLevelUsage.inputTokens).toBe(12)
  })

  it('accumulates input tokens across steps', async () => {
    state.messages = [
      {
        type: 'assistant',
        message: {
          id: 'step-1',
          usage: { input_tokens: 100, cache_creation_input_tokens: 5, output_tokens: 0 },
          content: [{ type: 'tool_use', id: 'tool-a', name: 'Read', input: {} }],
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'step-2',
          usage: { input_tokens: 110, cache_creation_input_tokens: 3, output_tokens: 0 },
          content: [{ type: 'tool_use', id: 'tool-b', name: 'Read', input: {} }],
        },
      },
      {
        type: 'stream_event',
        event: { type: 'message_delta', usage: { output_tokens: 20 } },
      },
      { type: 'result', subtype: 'success', usage: {} },
    ]

    const events: Array<Record<string, unknown>> = []
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => 'msg-tokens',
      () => Date.now() - 50,
      () => false,
    )
    await handle.iterationDone

    const usageEvents = events.filter((e) => e.type === 'message_usage')
    expect(usageEvents).toHaveLength(3)
    expect(usageEvents[0]).toMatchObject({ inputTokens: 105, outputTokens: 0 })
    expect(usageEvents[1]).toMatchObject({ inputTokens: 218, outputTokens: 0 })
    expect(usageEvents[2]).toMatchObject({ inputTokens: 218, outputTokens: 20 })
  })

  it('emits message_error on non-success result subtype and stays idle', async () => {
    state.messages = [
      {
        type: 'result',
        subtype: 'error',
        errors: ['failure-1', 'failure-2'],
      },
    ]

    const events: Array<Record<string, unknown>> = []
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => 'msg-error',
      () => Date.now() - 50,
      () => false
    )
    await handle.iterationDone

    expect(events).toContainEqual({
      type: 'message_error',
      messageId: 'msg-error',
      error: 'failure-1; failure-2',
    })
    expect(events).toContainEqual({
      type: 'status_change',
      status: 'idle',
    })
  })

  it('emits message_interrupted when result arrives after interruption', async () => {
    state.messages = [{ type: 'result', subtype: 'success', usage: {} }]

    const events: Array<Record<string, unknown>> = []
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => 'msg-interrupted',
      () => Date.now() - 20,
      () => true
    )
    await handle.iterationDone

    expect(events.some((e) => e.type === 'message_interrupted')).toBe(true)
    expect(events).toContainEqual({ type: 'status_change', status: 'idle' })
  })

  it('maps iterator errors to message_error + status_change error', async () => {
    state.error = new Error('stream crashed')

    const events: Array<Record<string, unknown>> = []
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => 'msg-catch',
      () => Date.now() - 20,
      () => false
    )
    await handle.iterationDone

    expect(events).toContainEqual({
      type: 'message_error',
      messageId: 'msg-catch',
      error: 'stream crashed',
    })
    expect(events).toContainEqual({ type: 'status_change', status: 'error' })
  })

  it('emits early idle when background tasks are running after main agent completes', async () => {
    state.messages = [
      { type: 'system', subtype: 'init', session_id: 'sess-bg' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'agent-tool', name: 'Agent', input: {} }] } },
      { type: 'system', subtype: 'task_started', task_id: 'bg-1', tool_use_id: 'agent-tool', description: 'bg task' },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'done' }] } },
      { type: 'system', subtype: 'task_progress', task_id: 'bg-1', tool_use_id: 'agent-tool', description: 'progress', usage: {} },
      { type: 'system', subtype: 'task_progress', task_id: 'bg-1', tool_use_id: 'agent-tool', description: 'progress2', usage: {} },
      { type: 'system', subtype: 'task_notification', task_id: 'bg-1', status: 'completed', output_file: '' },
      { type: 'result', subtype: 'success', usage: {} },
    ]

    const events: Array<Record<string, unknown>> = []
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => 'msg-bg',
      () => Date.now() - 100,
      () => false
    )
    await handle.iterationDone

    const statusChanges = events
      .filter((e) => e.type === 'status_change')
      .map((e) => e.status)
    expect(statusChanges[0]).toBe('idle')
    expect(statusChanges[statusChanges.length - 1]).toBe('idle')
  })

  it('emits early idle on task_notification without task_progress', async () => {
    state.messages = [
      { type: 'system', subtype: 'init', session_id: 'sess-no-progress' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'agent-tool', name: 'Agent', input: {} }] } },
      { type: 'system', subtype: 'task_started', task_id: 'bg-1', tool_use_id: 'agent-tool', description: 'bg task' },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'done' }] } },
      { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } } },
      { type: 'system', subtype: 'task_notification', task_id: 'bg-1', status: 'completed', output_file: '' },
      { type: 'result', subtype: 'success', usage: {} },
    ]

    const events: Array<Record<string, unknown>> = []
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => 'msg-no-progress',
      () => Date.now() - 100,
      () => false
    )
    await handle.iterationDone

    const statusChanges = events
      .filter((e) => e.type === 'status_change')
      .map((e) => e.status)
    expect(statusChanges[0]).toBe('idle')
    expect(statusChanges).toContain('idle')
    const earlyIdleIdx = statusChanges.indexOf('idle')
    expect(earlyIdleIdx).toBeLessThan(statusChanges.length - 1)
  })

  it('emits early idle when task_started fires after main agent final response', async () => {
    state.messages = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'agent-tool', name: 'Agent', input: {} }] } },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'final response' }] } },
      { type: 'system', subtype: 'task_started', task_id: 'bg-1', tool_use_id: 'agent-tool', description: 'bg task' },
      { type: 'system', subtype: 'task_progress', task_id: 'bg-1', tool_use_id: 'agent-tool', description: 'progress', usage: {} },
      { type: 'result', subtype: 'success', usage: {} },
    ]

    const events: Array<Record<string, unknown>> = []
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => 'msg-late-start',
      () => Date.now() - 100,
      () => false
    )
    await handle.iterationDone

    const statusChanges = events
      .filter((e) => e.type === 'status_change')
      .map((e) => e.status)
    expect(statusChanges[0]).toBe('idle')
    expect(statusChanges[statusChanges.length - 1]).toBe('idle')
  })

  it('re-emits streaming when main agent resumes after early idle', async () => {
    state.messages = [
      { type: 'system', subtype: 'task_started', task_id: 'bg-1', tool_use_id: 'agent-tool', description: 'bg task' },
      { type: 'assistant', message: { content: [] } },
      { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } } },
      { type: 'system', subtype: 'task_progress', task_id: 'bg-1', tool_use_id: 'agent-tool', description: 'progress', usage: {} },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'resumed' }] } },
      { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } } },
      { type: 'result', subtype: 'success', usage: {} },
    ]

    const events: Array<Record<string, unknown>> = []
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => 'msg-resume',
      () => Date.now() - 100,
      () => false
    )
    await handle.iterationDone

    const statusChanges = events
      .filter((e) => e.type === 'status_change')
      .map((e) => e.status)
    expect(statusChanges).toEqual(['idle', 'streaming', 'idle', 'idle'])
  })

  it('uses per-turn messageId so result(A) keeps turn-A id when sendMessage(B) changes currentMessageId', async () => {
    state.messages = [
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'turn A' }] } },
      { type: 'result', subtype: 'success', usage: {} },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'turn B' }] } },
      { type: 'result', subtype: 'success', usage: {} },
    ]

    let currentId = 'msg-A'
    const events: Array<Record<string, unknown>> = []
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => currentId,
      () => Date.now() - 50,
      () => false,
      undefined,
      (id) => { currentId = id },
    )
    await handle.iterationDone

    const completes = events.filter((e) => e.type === 'message_complete')
    expect(completes).toHaveLength(2)
    expect(completes[0].messageId).toBe('msg-A')
    expect(completes[1].messageId).toBe(currentId)
  })

  it('continuation assistant in same turn keeps turn-A messageId even after sendMessage(B)', async () => {
    state.messages = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'agent-tool', name: 'Agent', input: {} }] } },
      { type: 'system', subtype: 'task_started', task_id: 'bg-1', tool_use_id: 'agent-tool', description: 'bg task' },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'main done' } } },
      { type: 'assistant', message: { content: [] } },
      { type: 'system', subtype: 'task_progress', task_id: 'bg-1', tool_use_id: 'agent-tool', description: 'progress', usage: {} },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'resumed after bg' } } },
      { type: 'assistant', message: { content: [] } },
      { type: 'result', subtype: 'success', usage: {} },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'turn B' } } },
      { type: 'assistant', message: { content: [] } },
      { type: 'result', subtype: 'success', usage: {} },
    ]

    let currentId = 'msg-A'
    const events: Array<Record<string, unknown>> = []
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => currentId,
      () => Date.now() - 50,
      () => false,
      undefined,
      (id) => { currentId = id },
    )
    await handle.iterationDone

    const thinkingDeltas = events
      .filter((e) => e.type === 'content_delta' && (e.delta as Record<string, unknown>)?.type === 'thinking')
      .map((e) => ({ messageId: e.messageId, thinking: (e.delta as Record<string, unknown>).thinking }))
    expect(thinkingDeltas[0]).toMatchObject({ messageId: 'msg-A', thinking: 'main done' })
    expect(thinkingDeltas[1]).toMatchObject({ messageId: 'msg-A', thinking: 'resumed after bg' })
    expect(thinkingDeltas[2]).toMatchObject({ messageId: currentId, thinking: 'turn B' })

    const completes = events.filter((e) => e.type === 'message_complete')
    expect(completes[0].messageId).toBe('msg-A')
    expect(completes[1].messageId).toBe(currentId)
  })

  it('new turn stream_events get correct messageId even before assistant message', async () => {
    state.messages = [
      { type: 'assistant', message: { content: [] } },
      { type: 'result', subtype: 'success', usage: {} },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello B' } } },
      { type: 'assistant', message: { content: [] } },
      { type: 'result', subtype: 'success', usage: {} },
    ]

    let currentId = 'msg-A'
    const events: Array<Record<string, unknown>> = []
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => currentId,
      () => Date.now() - 50,
      () => false,
      undefined,
      (id) => { currentId = id },
    )
    await handle.iterationDone

    const textDelta = events.find(
      (e) => e.type === 'content_delta' && (e.delta as Record<string, unknown>)?.type === 'text' && (e.delta as Record<string, unknown>)?.text === 'hello B'
    )
    expect(textDelta?.messageId).toBe(currentId)

    const completes = events.filter((e) => e.type === 'message_complete')
    expect(completes).toHaveLength(2)
    expect(completes[0].messageId).toBe('msg-A')
    expect(completes[1].messageId).toBe(currentId)
  })

  it('re-emits streaming after result when new assistant arrives (resultSeen)', async () => {
    state.messages = [
      { type: 'assistant', message: { content: [] } },
      { type: 'result', subtype: 'success', usage: {} },
      { type: 'assistant', message: { content: [] } },
      { type: 'result', subtype: 'success', usage: {} },
    ]

    let currentId = 'msg-x'
    const events: Array<Record<string, unknown>> = []
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => currentId,
      () => Date.now() - 50,
      () => false,
      undefined,
      (id) => { currentId = id },
    )
    await handle.iterationDone

    const statusChanges = events.filter((e) => e.type === 'status_change').map((e) => e.status)
    expect(statusChanges).toEqual(['idle', 'streaming', 'idle'])

    const messageStarts = events.filter((e) => e.type === 'message_start')
    expect(messageStarts).toHaveLength(1)
    expect((messageStarts[0].message as Record<string, unknown>).id).toBe(currentId)
  })

  it('maps iterator errors to interrupted status when already interrupted', async () => {
    state.error = new Error('aborted')

    const events: Array<Record<string, unknown>> = []
    const startTime = Date.now() - 80
    const handle = createSessionQuery(
      { consumedTags: [], drainConsumedTag: () => undefined } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => 'msg-catch-interrupted',
      () => startTime,
      () => true
    )
    await handle.iterationDone

    const interruptedEvent = events.find((e) => e.type === 'message_interrupted') as Record<string, unknown> | undefined
    expect(interruptedEvent?.messageId).toBe('msg-catch-interrupted')
    expect(events).toContainEqual({ type: 'status_change', status: 'idle' })
  })

  it('first replay user echo does not trigger queued turn detection even when consumedTags is non-empty', async () => {
    state.messages = [
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'thinking...' } } },
      { type: 'user', message: { role: 'user', content: 'original message' }, parent_tool_use_id: null, isReplay: true },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'thinking...' }] } },
      { type: 'result', subtype: 'success', usage: {} },
    ]

    const consumedTags = ['queued-tag-1']
    const events: Array<Record<string, unknown>> = []
    const onQueuedTurnStart = vi.fn()
    const handle = createSessionQuery(
      { consumedTags, drainConsumedTag: () => consumedTags.shift() } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => 'msg-A',
      () => Date.now() - 50,
      () => false,
      undefined,
      onQueuedTurnStart,
    )
    await handle.iterationDone

    expect(onQueuedTurnStart).not.toHaveBeenCalled()
    const messageStarts = events.filter((e) => e.type === 'message_start')
    expect(messageStarts).toHaveLength(0)
    const completes = events.filter((e) => e.type === 'message_complete')
    expect(completes).toHaveLength(1)
    expect(completes[0].messageId).toBe('msg-A')
  })

  it('second replay user echo triggers turn split with message_complete for previous turn', async () => {
    state.messages = [
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'turn 1' } } },
      { type: 'user', message: { role: 'user', content: 'original message' }, parent_tool_use_id: null, isReplay: true },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'turn 1' }] } },
      { type: 'user', message: { role: 'user', content: 'queued message' }, parent_tool_use_id: null, isReplay: true },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'turn 2 response' }] } },
      { type: 'result', subtype: 'success', usage: {} },
    ]

    const consumedTags = ['queued-tag-1']
    let currentId = 'msg-A'
    const events: Array<Record<string, unknown>> = []
    const onQueuedTurnStart = vi.fn((id: string) => { currentId = id })
    const handle = createSessionQuery(
      { consumedTags, drainConsumedTag: () => consumedTags.shift() } as unknown as MessageBridge,
      { cwd: '/repo', permissionMode: 'default', canUseTool: vi.fn() },
      (event) => events.push(event as unknown as Record<string, unknown>),
      () => currentId,
      () => Date.now() - 50,
      () => false,
      undefined,
      onQueuedTurnStart,
    )
    await handle.iterationDone

    expect(onQueuedTurnStart).toHaveBeenCalledTimes(1)
    const queuedId = onQueuedTurnStart.mock.calls[0][0] as string
    expect(queuedId).toMatch(/^msg_\d+_\w+$/)

    const completes = events.filter((e) => e.type === 'message_complete')
    expect(completes).toHaveLength(2)
    expect(completes[0].messageId).toBe('msg-A')
    expect(completes[1].messageId).toBe(queuedId)

    const messageStarts = events.filter((e) => e.type === 'message_start')
    expect(messageStarts).toHaveLength(1)
    expect((messageStarts[0].message as Record<string, unknown>).id).toBe(queuedId)
  })
})
