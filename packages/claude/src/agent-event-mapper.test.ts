import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  createClaudeAgentEventMapper,
  isResumeDropsTurnRefusal,
  RESUME_DROPS_TURN_REFUSAL_PREFIX,
} from './agent-event-mapper'

describe('createClaudeAgentEventMapper', () => {
  it('maps streaming text, thinking, tool input, and stream boundaries like desktop', () => {
    const events: AgentEvent[] = []
    const mapper = createClaudeAgentEventMapper({
      messageId: 'm1',
      emit: (event) => events.push(event),
      now: () => 123,
    })

    mapper.apply({
      type: 'stream_event',
      parent_tool_use_id: 'parent-1',
      event: { type: 'message_start', message: { id: 'api-1', model: 'claude-x' } },
    })
    mapper.apply({
      type: 'stream_event',
      parent_tool_use_id: 'parent-1',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    })
    mapper.apply({
      type: 'stream_event',
      parent_tool_use_id: 'parent-1',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reason' } },
    })
    mapper.apply({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'Bash' } },
    })
    mapper.apply({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"command":' } },
    })
    const text = mapper.apply({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'hello' } },
    })
    mapper.apply({ type: 'stream_event', event: { type: 'message_stop' } })

    expect(text.textDelta).toBe('hello')
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'stream_message_start', messageId: 'm1', apiMessageId: 'api-1' }),
      expect.objectContaining({ type: 'content_delta', delta: expect.objectContaining({ type: 'thinking', thinking: 'reason', parentToolUseId: 'parent-1' }) }),
      expect.objectContaining({ type: 'content_delta', delta: expect.objectContaining({ type: 'tool_use', toolUseId: 'tu1', status: 'streaming' }) }),
      expect.objectContaining({ type: 'tool_input_delta', toolUseId: 'tu1', partialJson: '{"command":' }),
      expect.objectContaining({ type: 'content_delta', delta: { type: 'text', text: 'hello', parentToolUseId: null } }),
      expect.objectContaining({ type: 'stream_message_stop', messageId: 'm1' }),
    ]))
  })

  it('preserves desktop tool-result classification and task metadata', () => {
    const events: AgentEvent[] = []
    const mapper = createClaudeAgentEventMapper({ messageId: 'm1', emit: (event) => events.push(event) })

    mapper.apply({
      type: 'assistant',
      message: { content: [
        { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'false' } },
        { type: 'tool_use', id: 'task-1', name: 'TaskCreate', input: { subject: 'Ship' } },
      ] },
    })
    mapper.apply({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: 'Exit code 1', is_error: true }] },
      tool_use_result: 'Error: Exit code 1',
    })
    mapper.apply({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'task-1', content: '{"task":{"id":"7","subject":"Ship"}}' }] },
      tool_use_result: { task: { id: '7', subject: 'Ship' } },
    })

    const results = events.filter(
      (event): event is Extract<AgentEvent, { type: 'content_delta' }> =>
        event.type === 'content_delta' && event.delta.type === 'tool_result',
    )
    expect(results[0]?.delta).toMatchObject({ toolUseId: 'bash-1' })
    expect(results[0]?.delta && 'isError' in results[0].delta).toBe(false)
    expect(results[1]?.delta).toMatchObject({
      toolUseId: 'task-1',
      todoToolName: 'TaskCreate',
      toolTodos: [{ content: 'Ship', status: 'pending', taskId: '7' }],
    })
  })

  it('maps rich system, progress, suggestion, and rate-limit events', () => {
    const events: AgentEvent[] = []
    const mapper = createClaudeAgentEventMapper({ messageId: 'm1', emit: (event) => events.push(event) })

    mapper.apply({ type: 'system', subtype: 'hook_started', hook_id: 'h1', hook_name: 'lint', hook_event: 'PostToolUse' })
    mapper.apply({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 100 } })
    mapper.apply({ type: 'system', subtype: 'task_started', task_id: 'bg1', tool_use_id: 'tu1', description: 'work' })
    mapper.apply({ type: 'system', subtype: 'task_progress', task_id: 'bg1', description: 'half', usage: { total_tokens: 9, tool_uses: 2, duration_ms: 50 } })
    mapper.apply({ type: 'tool_progress', tool_use_id: 'tu1', tool_name: 'Bash', elapsed_time_seconds: 2 })
    mapper.apply({ type: 'prompt_suggestion', suggestion: 'next' })
    mapper.apply({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.8 } })

    expect(events.map((event) => event.type)).toEqual([
      'hook_started',
      'compact_boundary',
      'task_started',
      'task_progress',
      'tool_progress',
      'prompt_suggestion',
      'rate_limit',
    ])
  })

  it('attaches desktop result metadata and terminal events', () => {
    const events: AgentEvent[] = []
    const mapper = createClaudeAgentEventMapper({
      messageId: 'm1',
      emit: (event) => events.push(event),
      startedAt: 100,
      now: () => 250,
    })
    mapper.apply({
      type: 'assistant',
      uuid: 'assistant-uuid',
      message: { id: 'step-1', usage: { input_tokens: 7, output_tokens: 1 }, content: [] },
    })
    const result = mapper.apply({
      type: 'result',
      subtype: 'success',
      session_id: 'sdk-session',
      result: 'done',
      duration_api_ms: 90,
      total_cost_usd: 0.01,
      num_turns: 1,
      fast_mode_state: 'off',
      fast_mode_disabled_reason: 'preference',
      modelUsage: {
        'claude-x': {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0.001,
          canonicalModel: 'claude-x-canonical',
          provider: 'firstParty',
        },
      },
    })

    expect(result).toMatchObject({ isResult: true, resultIsError: false, resultText: 'done' })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'message_usage', inputTokens: 7 }),
      expect.objectContaining({
        type: 'message_complete',
        messageId: 'm1',
        metadata: expect.objectContaining({
          durationMs: 150,
          durationApiMs: 90,
          costUsd: 0.01,
          forkAnchorId: 'assistant-uuid',
          usage: expect.objectContaining({ inputTokens: 7 }),
          fastModeState: 'off',
          fastModeDisabledReason: 'preference',
          modelUsage: expect.objectContaining({
            'claude-x': expect.objectContaining({
              canonicalModel: 'claude-x-canonical',
              provider: 'firstParty',
            }),
          }),
        }),
      }),
      expect.objectContaining({ type: 'status_change', status: 'idle' }),
    ]))
  })

  it('maps a rejected rate-limit result with success subtype to a typed failure', () => {
    const resetsAt = 1_787_635_200
    const events: AgentEvent[] = []
    const mapper = createClaudeAgentEventMapper({ messageId: 'm-rate-limit', emit: (event) => events.push(event) })

    mapper.apply({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt, rateLimitType: 'five_hour' },
    })
    mapper.apply({
      type: 'assistant',
      error: 'rate_limit',
      message: { id: 'step-rate-limit', model: '<synthetic>', content: [] },
    })
    const result = mapper.apply({
      type: 'result',
      subtype: 'success',
      is_error: true,
      terminal_reason: 'api_error',
      api_error_status: 429,
      errors: [],
      result: "You've hit your session limit · resets 1:20pm (Asia/Shanghai)",
    })

    expect(result.resultIsError).toBe(true)
    expect(events.find((event) => event.type === 'message_complete')).toBeUndefined()
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message_error',
      messageId: 'm-rate-limit',
      error: "You've hit your session limit · resets 1:20pm (Asia/Shanghai)",
      errorInfo: expect.objectContaining({
        code: 'rate_limit',
        httpStatus: 429,
        terminalReason: 'api_error',
        resetsAt,
      }),
    }))
  })

  it('does not turn an allowed-warning rate-limit event into a failed turn', () => {
    const events: AgentEvent[] = []
    const mapper = createClaudeAgentEventMapper({ messageId: 'm-warning', emit: (event) => events.push(event) })

    mapper.apply({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed_warning', resetsAt: 1_787_635_200, utilization: 0.8 },
    })
    const result = mapper.apply({ type: 'result', subtype: 'success', result: 'done' })

    expect(result.resultIsError).toBe(false)
    expect(events).toContainEqual(expect.objectContaining({ type: 'message_complete', messageId: 'm-warning' }))
    expect(events.find((event) => event.type === 'message_error')).toBeUndefined()
  })

  it('maps session_init fastModeDisabledReason from system/init', () => {
    const events: AgentEvent[] = []
    const mapper = createClaudeAgentEventMapper({ messageId: 'm1', emit: (event) => events.push(event) })
    mapper.apply({
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      model: 'claude-x',
      tools: [],
      mcp_servers: [],
      permissionMode: 'default',
      slash_commands: ['help', 'exit'],
      terminal_slash_commands: ['exit', 'statusline'],
      skills: [],
      claude_code_version: '1',
      cwd: '/tmp',
      fast_mode_state: 'off',
      fast_mode_disabled_reason: 'model_not_allowed',
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'session_init',
      session: expect.objectContaining({
        fastModeState: 'off',
        fastModeDisabledReason: 'model_not_allowed',
        slashCommands: ['help', 'exit'],
        terminalSlashCommands: ['exit', 'statusline'],
      }),
    }))
  })

  it('matches SDK resume-drops-turn refusal prefix and rejects unrelated errors', () => {
    expect(isResumeDropsTurnRefusal(`${RESUME_DROPS_TURN_REFUSAL_PREFIX} extra user message`)).toBe(true)
    expect(isResumeDropsTurnRefusal('failure-1; failure-2')).toBe(false)
    expect(isResumeDropsTurnRefusal('Resume rejected')).toBe(false)
  })

  it('decorates typed result errors with the desktop message semantics', () => {
    const events: AgentEvent[] = []
    const mapper = createClaudeAgentEventMapper({ messageId: 'm1', emit: (event) => events.push(event) })
    mapper.apply({ type: 'assistant', error: 'model_not_found', message: { content: [] } })
    const result = mapper.apply({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      api_error_status: 404,
      errors: ['missing model'],
    })

    expect(result.resultError).toBe('Model not available for this provider (HTTP 404): missing model')
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message_error',
        error: 'Model not available for this provider (HTTP 404): missing model',
      }),
      expect.objectContaining({ type: 'status_change', status: 'idle' }),
    ]))
  })
})
