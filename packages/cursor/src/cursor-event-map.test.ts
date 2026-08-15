import { describe, expect, it } from 'vitest'
import { applyContentDelta } from '@superone/shared/content-delta'
import type { AgentEvent, ContentBlock } from '@superone/shared/agent-types'
import {
  CursorTurnCallIdBridge,
  CursorTurnUsage,
  extractToolCallParts,
  mapConversationStep,
  mapCursorContextUsageInfo,
  mapInteractionUpdate,
  mapSdkMessageLifecycle,
} from './cursor-event-map'

function applyEvents(events: AgentEvent[], content: ContentBlock[] = []): ContentBlock[] {
  let next = content
  for (const event of events) {
    if (event.type === 'content_delta') next = applyContentDelta(next, event.delta)
  }
  return next
}

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
    expect(events[0]).toMatchObject({
      delta: { type: 'tool_use', input: JSON.stringify({ path: 'a.ts', file_path: 'a.ts' }) },
    })
    expect(events[1]).toMatchObject({
      type: 'content_delta',
      delta: {
        type: 'tool_result',
        toolUseId: 'c1',
        summary: JSON.stringify({ content: 'hello' }, null, 2),
        isError: false,
      },
    })
  })

  it('formats shell tool_result as stdout, not exitCode JSON', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-completed',
      callId: 'c1',
      toolCall: {
        type: 'shell',
        args: { command: 'bun run test' },
        result: {
          status: 'success',
          value: {
            exitCode: 0,
            signal: '',
            stdout: 'ok\n',
            stderr: '',
            executionTime: 30_000,
          },
        },
      },
    } as never)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({
      type: 'content_delta',
      delta: {
        type: 'tool_result',
        toolUseId: 'c1',
        summary: 'ok\n',
        isError: false,
      },
    })
  })

  it('formats grep workspaceResults as match lines, not JSON', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-completed',
      callId: 'g1',
      toolCall: {
        type: 'grep',
        args: { pattern: 'workspaceResults' },
        result: {
          status: 'success',
          value: {
            workspaceResults: {
              '/Users/me/proj': {
                type: 'content',
                output: {
                  matches: [{ file: 'docs/design/cursor-sdk-harness.md', lineNumber: 10, line: 'GrepSuccessSchema' }],
                  totalMatches: 1,
                },
              },
            },
          },
        },
      },
    } as never)
    expect(events[0]).toMatchObject({
      delta: { type: 'tool_use', toolName: 'Grep', toolUseId: 'g1' },
    })
    expect(events[1]).toMatchObject({
      delta: {
        type: 'tool_result',
        toolUseId: 'g1',
        summary: 'docs/design/cursor-sdk-harness.md:10:GrepSuccessSchema',
      },
    })
  })

  it('does not invent a tool id when callId is missing', () => {
    expect(mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      toolCall: { type: 'shell', args: { command: 'ls' } },
    } as never)).toEqual([])
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

  it('maps token-delta as generated-output increment, not billed input or context', () => {
    const tokenEvents = mapInteractionUpdate('m1', {
      type: 'token-delta',
      tokens: 3,
    } as never, { contextWindow: 200_000 })
    expect(tokenEvents[0]).toMatchObject({
      type: 'message_usage',
      messageId: 'm1',
      inputTokens: 0,
      outputTokens: 3,
    })
    expect(tokenEvents[0]).not.toHaveProperty('contextTokens')

    const ended = mapInteractionUpdate('m1', {
      type: 'turn-ended',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2_000_000,
        cacheWriteTokens: 1,
        reasoningTokens: 3,
      },
    } as never, { contextWindow: 100_000 })
    expect(ended[0]).toMatchObject({
      type: 'message_usage',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2_000_000,
      contextTokens: 2_000_011,
      contextWindow: 100_000,
    })
    expect(ended[1]).toEqual({ type: 'status_change', status: 'idle' })
  })

  it('accumulates token-delta output without wiping input', () => {
    const turnUsage = new CursorTurnUsage()
    mapInteractionUpdate('m1', {
      type: 'turn-ended',
      usage: {
        inputTokens: 80,
        outputTokens: 4,
        cacheReadTokens: 5_000_000,
        cacheWriteTokens: 20,
      },
    } as never, { turnUsage })

    const first = mapInteractionUpdate('m1', { type: 'token-delta', tokens: 1 } as never, { turnUsage })
    const second = mapInteractionUpdate('m1', { type: 'token-delta', tokens: 2 } as never, { turnUsage })
    expect(first[0]).toMatchObject({
      type: 'message_usage',
      inputTokens: 80,
      outputTokens: 5,
    })
    expect(second[0]).toMatchObject({
      type: 'message_usage',
      inputTokens: 80,
      outputTokens: 7,
    })
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

  it('unwraps Cursor MCP envelope to mcp__server__tool so SuperOne tool UI can parse it', () => {
    const started = mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      callId: 'c1',
      toolCall: {
        type: 'mcp',
        args: {
          providerIdentifier: 'superone',
          toolName: 'session_read',
          args: { sessionId: 's1', from: 0 },
        },
      },
    } as never)
    expect(started[0]).toMatchObject({
      type: 'content_delta',
      delta: {
        type: 'tool_use',
        toolUseId: 'c1',
        toolName: 'mcp__superone__session_read',
        status: 'streaming',
        input: JSON.stringify({ sessionId: 's1', from: 0 }),
      },
    })

    const completed = mapInteractionUpdate('m1', {
      type: 'tool-call-completed',
      callId: 'c1',
      toolCall: {
        type: 'mcp',
        args: {
          providerIdentifier: 'superone',
          toolName: 'session_read',
          args: { sessionId: 's1' },
        },
        result: { status: 'success', value: { messages: [] } },
      },
    } as never)
    expect(completed[0]).toMatchObject({
      type: 'content_delta',
      delta: {
        type: 'tool_use',
        toolName: 'mcp__superone__session_read',
        status: 'complete',
        input: JSON.stringify({ sessionId: 's1' }),
      },
    })
  })

  it('does not remap SuperOne MCP names through native tool aliases', () => {
    // session_read contains "read"; session_search contains "search".
    const read = mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      callId: 'c1',
      toolCall: {
        type: 'mcp',
        args: { providerIdentifier: 'superone', toolName: 'session_read', args: {} },
      },
    } as never)
    expect(read[0]).toMatchObject({
      delta: { type: 'tool_use', toolName: 'mcp__superone__session_read' },
    })

    const search = mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      callId: 'c2',
      toolCall: {
        type: 'mcp',
        args: { providerIdentifier: 'superone', toolName: 'session_search', args: { query: 'auth' } },
      },
    } as never)
    expect(search[0]).toMatchObject({
      delta: { type: 'tool_use', toolName: 'mcp__superone__session_search' },
    })
  })

  it('unwraps third-party MCP envelopes the same way', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      callId: 'c1',
      toolCall: {
        type: 'mcp',
        args: {
          providerIdentifier: 'git',
          toolName: 'diff',
          args: { staged: true },
        },
      },
    } as never)
    expect(events[0]).toMatchObject({
      delta: {
        type: 'tool_use',
        toolName: 'mcp__git__diff',
        input: JSON.stringify({ staged: true }),
      },
    })
  })

  it('keeps MCP display name when the envelope is incomplete', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      callId: 'c1',
      toolCall: {
        type: 'mcp',
        args: { toolName: 'session_read' },
      },
    } as never)
    expect(events[0]).toMatchObject({
      delta: { type: 'tool_use', toolName: 'MCP' },
    })
  })

  it('normalizes Cursor native args so ToolBlock can show file names', () => {
    const read = mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      callId: 'c1',
      toolCall: { type: 'read', args: { path: 'src/main.ts' } },
    } as never)
    expect(read[0]).toMatchObject({
      delta: {
        type: 'tool_use',
        toolName: 'Read',
        input: JSON.stringify({ path: 'src/main.ts', file_path: 'src/main.ts' }),
      },
    })

    const write = mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      callId: 'c2',
      toolCall: { type: 'write', args: { path: 'a.ts', fileText: 'export {}' } },
    } as never)
    expect(write[0]).toMatchObject({
      delta: {
        type: 'tool_use',
        toolName: 'Write',
        input: JSON.stringify({
          path: 'a.ts',
          fileText: 'export {}',
          file_path: 'a.ts',
          content: 'export {}',
        }),
      },
    })

    const glob = mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      callId: 'c3',
      toolCall: { type: 'glob', args: { globPattern: '**/*.ts', targetDirectory: 'src' } },
    } as never)
    expect(glob[0]).toMatchObject({
      delta: {
        type: 'tool_use',
        toolName: 'Glob',
        input: JSON.stringify({
          globPattern: '**/*.ts',
          targetDirectory: 'src',
          pattern: '**/*.ts',
          path: 'src',
        }),
      },
    })
  })

  it('stamps parentToolUseId on nested task tool calls so they stay inside the subagent card', () => {
    const started = mapInteractionUpdate('m1', {
      type: 'tool-call-delta',
      callId: 'task-1',
      taskUpdate: {
        type: 'tool-call-started',
        callId: 'grep-1',
        toolCall: { type: 'grep', args: { pattern: 'ToolBlock' } },
      },
    } as never)
    expect(started[0]).toMatchObject({
      type: 'content_delta',
      delta: {
        type: 'tool_use',
        toolUseId: 'grep-1',
        toolName: 'Grep',
        parentToolUseId: 'task-1',
      },
    })

    const completed = mapInteractionUpdate('m1', {
      type: 'tool-call-delta',
      callId: 'task-1',
      taskUpdate: {
        type: 'tool-call-completed',
        callId: 'grep-1',
        toolCall: {
          type: 'grep',
          args: { pattern: 'ToolBlock' },
          result: { status: 'success', value: { matches: 1 } },
        },
      },
    } as never)
    expect(completed[0]).toMatchObject({
      delta: { type: 'tool_use', toolUseId: 'grep-1', parentToolUseId: 'task-1' },
    })
    expect(completed[1]).toMatchObject({
      delta: { type: 'tool_result', toolUseId: 'grep-1', parentToolUseId: 'task-1' },
    })
  })

  it('stamps parentToolUseId on nested task text so it does not leak into the main transcript', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-delta',
      callId: 'task-1',
      taskUpdate: { type: 'text-delta', text: 'looking at the diff' },
    } as never)
    expect(events[0]).toMatchObject({
      type: 'content_delta',
      delta: { type: 'text', text: 'looking at the diff', parentToolUseId: 'task-1' },
    })
  })

  it('does not stamp parentToolUseId on top-level tool calls', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      callId: 'c1',
      toolCall: { type: 'grep', args: { pattern: 'x' } },
    } as never)
    const delta = (events[0] as { delta: Record<string, unknown> }).delta
    expect(delta.toolUseId).toBe('c1')
    expect(delta.parentToolUseId).toBeUndefined()
  })

  it('emits task_started with toolUseId so the subagent card can track progress', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-started',
      callId: 'task-1',
      toolCall: {
        type: 'task',
        args: { description: 'Cursor edit diff UI', prompt: 'inspect the diff UI' },
      },
    } as never)
    expect(events[0]).toMatchObject({
      delta: { type: 'tool_use', toolName: 'Agent', toolUseId: 'task-1' },
    })
    expect(events[1]).toMatchObject({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'task-1',
      description: 'Cursor edit diff UI',
    })
  })

  it('ignores nested shell-output-delta the same as top-level', () => {
    expect(mapInteractionUpdate('m1', {
      type: 'tool-call-delta',
      callId: 'task-1',
      taskUpdate: { type: 'shell-output-delta', event: { stdout: 'line\n' } },
    } as never)).toEqual([])
  })

  it('merges Cursor Edit result.diffString into tool_use input', () => {
    const events = mapInteractionUpdate('m1', {
      type: 'tool-call-completed',
      callId: 'c1',
      toolCall: {
        type: 'edit',
        args: { path: 'a.ts' },
        result: {
          status: 'success',
          value: { diffString: '--- a\n+++ b\n', linesAdded: 1, linesRemoved: 1 },
        },
      },
    } as never)
    expect(events[0]).toMatchObject({
      delta: {
        type: 'tool_use',
        toolName: 'Edit',
        input: JSON.stringify({
          path: 'a.ts',
          diffString: '--- a\n+++ b\n',
          linesAdded: 1,
          linesRemoved: 1,
          file_path: 'a.ts',
          diff: '--- a\n+++ b\n',
        }),
      },
    })
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

  it('ignores ConversationStep.id so onStep patches the live callId instead of forking a row', () => {
    const bridge = new CursorTurnCallIdBridge()
    bridge.observeDelta({
      type: 'tool-call-started',
      callId: 'real-call-1',
      toolCall: { type: 'shell', args: { command: 'bun run test' } },
    } as never)

    const steps = mapConversationStep('m1', {
      type: 'toolCall',
      id: 'step-uuid',
      message: {
        type: 'shell',
        args: { command: 'bun run test' },
      },
    } as never, {
      resolveCallId: () => bridge.claimNextCallId(),
    })
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      type: 'content_delta',
      delta: { type: 'tool_use', toolUseId: 'real-call-1', toolName: 'Bash' },
    })
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

  it('records nested tool-call-delta callIds so onStep can patch the child row', () => {
    const bridge = new CursorTurnCallIdBridge()
    bridge.observeDelta({
      type: 'tool-call-delta',
      callId: 'task-1',
      taskUpdate: {
        type: 'tool-call-started',
        callId: 'grep-1',
        toolCall: { type: 'grep', args: { pattern: 'x' } },
      },
    } as never)
    expect(bridge.claimNextCallId()).toBe('grep-1')
    expect(bridge.claimNextCallId()).toBeNull()
  })

  it('unwraps MCP envelopes on toolCall steps', () => {
    const steps = mapConversationStep('m1', {
      type: 'toolCall',
      callId: 'c9',
      message: {
        type: 'mcp',
        args: {
          providerIdentifier: 'superone',
          toolName: 'session_list',
          args: { limit: 10 },
        },
      },
    } as never)
    expect(steps[0]).toMatchObject({
      delta: {
        type: 'tool_use',
        toolName: 'mcp__superone__session_list',
        input: JSON.stringify({ limit: 10 }),
      },
    })
  })

  it('collapses started + completed + onStep(with extra id) into one Bash row showing stdout', () => {
    const started = {
      type: 'tool-call-started',
      callId: 'c1',
      toolCall: { type: 'shell', args: { command: 'bun run test' } },
    } as never
    const completed = {
      type: 'tool-call-completed',
      callId: 'c1',
      toolCall: {
        type: 'shell',
        args: { command: 'bun run test' },
        result: {
          status: 'success',
          value: { exitCode: 0, signal: '', stdout: 'ok\n', stderr: '', executionTime: 1 },
        },
      },
    } as never
    const bridge = new CursorTurnCallIdBridge()
    bridge.observeDelta(started)

    let content = applyEvents(mapInteractionUpdate('m1', started))
    content = applyEvents(mapInteractionUpdate('m1', completed), content)
    content = applyEvents(mapConversationStep('m1', {
      type: 'toolCall',
      id: 'step-uuid',
      message: { type: 'shell', args: { command: 'bun run test' } },
    } as never, { resolveCallId: () => bridge.claimNextCallId() }), content)

    const uses = content.filter((b) => b.type === 'tool_use')
    const results = content.filter((b) => b.type === 'tool_result')
    expect(uses).toHaveLength(1)
    expect(uses[0]).toMatchObject({ toolUseId: 'c1', toolName: 'Bash' })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ toolUseId: 'c1', summary: 'ok\n' })
  })
})

describe('mapSdkMessageLifecycle', () => {
  it('unwraps MCP envelopes on tool_call replay', () => {
    const events = mapSdkMessageLifecycle('m1', {
      type: 'tool_call',
      agent_id: 'a',
      run_id: 'r',
      call_id: 'c1',
      name: 'mcp',
      status: 'completed',
      args: {
        providerIdentifier: 'superone',
        toolName: 'session_read',
        args: { sessionId: 's1' },
      },
      result: { messages: [] },
    } as never, { includeContent: true })
    expect(events[0]).toMatchObject({
      delta: {
        type: 'tool_use',
        toolName: 'mcp__superone__session_read',
        toolUseId: 'c1',
        input: JSON.stringify({ sessionId: 's1' }),
      },
    })
  })
})

describe('mapCursorContextUsageInfo', () => {
  const usage = {
    inputTokens: 80,
    outputTokens: 20,
    cacheReadTokens: 1_400_000,
    cacheWriteTokens: 7_000,
  }

  it('returns billed categories without inventing a percentage when no window is known', () => {
    expect(mapCursorContextUsageInfo(usage)).toMatchObject({
      totalTokens: 1_407_100,
      maxTokens: 0,
      percentage: 0,
      categories: [
        { name: 'input', tokens: 80 },
        { name: 'output', tokens: 20 },
        { name: 'cacheRead', tokens: 1_400_000 },
        { name: 'cacheWrite', tokens: 7_000 },
      ],
    })
  })

  it('uses prompt occupancy (input + cache) against a known window', () => {
    expect(mapCursorContextUsageInfo(usage, { maxTokens: 300_000, model: 'opus' })).toMatchObject({
      totalTokens: 1_407_080,
      maxTokens: 300_000,
      percentage: 100,
      model: 'opus',
    })
  })
})
