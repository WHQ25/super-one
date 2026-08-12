import { describe, expect, it } from 'vitest'
import {
  CursorTurnCallIdBridge,
  extractToolCallParts,
  mapConversationStep,
  mapInteractionUpdate,
} from './cursor-event-map'

describe('mapInteractionUpdate', () => {
  it('maps text-delta to content_delta text', () => {
    const events = mapInteractionUpdate('m1', { type: 'text-delta', text: 'hi' } as never)
    expect(events).toEqual([
      { type: 'content_delta', messageId: 'm1', delta: { type: 'text', text: 'hi' } },
    ])
  })

  it('maps nested toolCall shape on tool-call-started', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      callId: 'c1',
      toolCall: {
        type: 'shell',
        args: { command: 'ls -la' },
      },
    } as never)
    expect(events[0]).toMatchObject({
      type: 'content_delta',
      delta: {
        type: 'tool_use',
        toolUseId: 'c1',
        toolName: 'Bash',
        status: 'streaming',
        input: JSON.stringify({ command: 'ls -la' }),
      },
    })
  })

  it('maps nested tool-call-completed with success result', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-completed',
      callId: 'c1',
      toolCall: {
        type: 'read',
        args: { path: 'a.ts' },
        result: {
          status: 'success',
          value: { content: 'hello' },
        },
      },
    } as never)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'content_delta',
      delta: { type: 'tool_use', toolUseId: 'c1', toolName: 'Read', status: 'complete' },
    })
    expect(events[1]).toMatchObject({
      type: 'content_delta',
      delta: {
        type: 'tool_result',
        toolUseId: 'c1',
        summary: JSON.stringify({ content: 'hello' }),
        isError: false,
      },
    })
  })

  it('still accepts flat legacy tool-call-completed', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-completed',
      callId: 'c1',
      name: 'shell',
      args: { command: 'ls' },
      result: 'ok',
    } as never)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'content_delta',
      delta: { type: 'tool_use', toolUseId: 'c1', toolName: 'Bash', status: 'complete' },
    })
    expect(events[1]).toMatchObject({
      type: 'content_delta',
      delta: { type: 'tool_result', toolUseId: 'c1', summary: 'ok' },
    })
  })

  it('maps token-delta and turn-ended usage', () => {
    const tokenEvents = mapInteractionUpdate('m1', {
      type: 'token-delta',
      tokens: 1200,
    } as never, { contextWindow: 200_000 })
    expect(tokenEvents[0]).toMatchObject({
      type: 'message_usage',
      messageId: 'm1',
      inputTokens: 1200,
      contextTokens: 1200,
      contextWindow: 200_000,
    })

    const ended = mapInteractionUpdate('m1', {
      type: 'turn-ended',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        reasoningTokens: 3,
      },
    } as never, { contextWindow: 100_000 })
    expect(ended[0]).toMatchObject({
      type: 'message_usage',
      inputTokens: 13,
      outputTokens: 8,
      contextWindow: 100_000,
    })
    expect(ended[1]).toEqual({ type: 'status_change', status: 'idle' })
  })

  it('ignores shell-output-delta entirely (final result comes from tool-call-completed)', () => {
    // SDK 1.0.24: shell-output-delta is { type, event: Record } only.
    expect(mapInteractionUpdate('m1', {
      type: 'shell-output-delta',
      event: { callId: 'shell-1', stdout: 'line\n' },
    } as never)).toEqual([])

    expect(mapInteractionUpdate('m1', {
      type: 'shell-output-delta',
      event: { stdout: 'orphan\n' },
    } as never)).toEqual([])
  })

  it('maps updateTodos toolCall into todos_updated', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      callId: 't1',
      toolCall: {
        type: 'updateTodos',
        args: {
          todos: [{ id: '1', content: 'A', status: 'pending' }],
        },
      },
    } as never)
    expect(events.some((e) => e.type === 'todos_updated')).toBe(true)
  })

  it('emits summary text from summary payload (not only summary-completed)', () => {
    const fromSummary = mapInteractionUpdate('m1', {
      type: 'summary',
      summary: 'compacted context',
    } as never)
    expect(fromSummary[0]).toMatchObject({
      type: 'content_delta',
      delta: { type: 'text', text: '\ncompacted context\n' },
    })

    expect(mapInteractionUpdate('m1', {
      type: 'summary-completed',
    } as never)).toEqual([])
  })

  it('maps todos payloads and task-started aliases', () => {
    const todos = mapInteractionUpdate('m1', {
      type: 'unknown-todos',
      todos: [{ id: '1', content: 'A', status: 'pending' }],
    } as never)
    expect(todos[0]).toMatchObject({ type: 'todos_updated' })

    const task = mapInteractionUpdate('m1', {
      type: 'task-started',
      taskId: 't1',
      description: 'Explore',
    } as never)
    expect(task[0]).toMatchObject({ type: 'task_started', taskId: 't1' })
  })
})

describe('extractToolCallParts', () => {
  it('prefers nested toolCall over flat fields', () => {
    const parts = extractToolCallParts({
      callId: 'x',
      name: 'ignored',
      toolCall: { type: 'edit', args: { path: 'a' } },
    })
    expect(parts.toolType).toBe('edit')
    expect(parts.args).toEqual({ path: 'a' })
  })
})

describe('mapConversationStep', () => {
  it('finalizes toolCall steps without re-emitting assistant text', () => {
    const textSteps = mapConversationStep('m1', {
      type: 'assistantMessage',
      message: { text: 'hello' },
    } as never)
    expect(textSteps).toEqual([])

    const toolSteps = mapConversationStep('m1', {
      type: 'toolCall',
      callId: 'c9',
      message: {
        type: 'grep',
        args: { pattern: 'foo' },
        result: { status: 'success', value: { matches: 1 } },
      },
    } as never)
    expect(toolSteps).toHaveLength(1)
    expect(toolSteps[0]).toMatchObject({
      type: 'content_delta',
      delta: { type: 'tool_use', toolName: 'Grep', status: 'complete', toolUseId: 'c9' },
    })
    // No tool_result — onDelta owns results (append-only would duplicate).
    expect(toolSteps.some((e) =>
      e.type === 'content_delta' && e.delta.type === 'tool_result',
    )).toBe(false)
  })

  it('skips SDK-shaped toolCall steps with no callId (does not invent tool_ ids)', () => {
    const steps = mapConversationStep('m1', {
      type: 'toolCall',
      message: {
        type: 'shell',
        args: { command: 'echo hi' },
      },
    } as never)
    expect(steps).toEqual([])
  })

  it('uses resolveCallId bridge for SDK-shaped steps without callId', () => {
    const bridge = new CursorTurnCallIdBridge()
    bridge.observeDelta({
      type: 'tool-call-started',
      callId: 'real-call-1',
      toolCall: { type: 'shell', args: { command: 'ls' } },
    } as never)

    const steps = mapConversationStep('m1', {
      type: 'toolCall',
      message: {
        type: 'shell',
        args: { command: 'ls' },
      },
    } as never, {
      resolveCallId: () => bridge.claimNextCallId(),
    })
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      type: 'content_delta',
      delta: { type: 'tool_use', toolUseId: 'real-call-1', toolName: 'Bash', status: 'complete' },
    })
  })
})
