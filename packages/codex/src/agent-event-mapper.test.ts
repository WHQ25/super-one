import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  createCodexAgentEventMapper,
  mapCodexThreadItem,
} from './agent-event-mapper'

describe('Codex AgentEvent mapper', () => {
  it('counts retried errors and attaches structured failure detail when the turn gives up', () => {
    const events: AgentEvent[] = []
    const mapper = createCodexAgentEventMapper({
      messageId: 'message-retry',
      emit: (event) => events.push(event),
      model: 'gpt-5.4',
      now: () => 1_000,
    })

    mapper.start('thread-retry')
    // Retried errors are not terminal — they must not surface as a failure…
    mapper.apply({ method: 'error', params: { message: 'stream reset', willRetry: true } })
    mapper.apply({ method: 'error', params: { message: 'stream reset', willRetry: true } })
    expect(events.some((e) => e.type === 'message_error')).toBe(false)

    // …but the give-up must report how many attempts they burned.
    mapper.apply({ method: 'error', params: { message: 'API error (status 429): rate limit reached' } })

    const failure = events.find((e) => e.type === 'message_error')
    expect(failure).toMatchObject({
      messageId: 'message-retry',
      errorInfo: {
        raw: 'API error (status 429): rate limit reached',
        code: 'rate_limit',
        httpStatus: 429,
        retries: { attempts: 2 },
      },
    })
  })

  it('projects the desktop item, usage, MCP, and lifecycle semantics', () => {
    const events: AgentEvent[] = []
    const mapper = createCodexAgentEventMapper({
      messageId: 'message-1',
      emit: (event) => events.push(event),
      model: 'gpt-5.4',
      now: () => 1_000,
    })

    mapper.start('thread-1')
    mapper.apply({
      method: 'item/started',
      params: { item: { id: 'reason-1', type: 'reasoning', summary: [{ text: 'Inspect' }] } },
    })
    mapper.apply({
      method: 'item/reasoning/summary_text_delta',
      params: { itemId: 'reason-1', delta: ' details' },
    })
    mapper.apply({
      method: 'item/started',
      params: { item: { id: 'answer-1', type: 'agentMessage', text: '' } },
    })
    const delta = mapper.apply({
      method: 'item/agentMessage/delta',
      params: { itemId: 'answer-1', delta: 'done' },
    })
    mapper.apply({
      method: 'thread/tokenUsage/updated',
      params: {
        tokenUsage: {
          last: { inputTokens: 12, cachedInputTokens: 2, outputTokens: 4 },
          total: { inputTokens: 12, cachedInputTokens: 2, outputTokens: 4 },
          modelContextWindow: 128_000,
        },
      },
    })
    mapper.apply({
      method: 'mcpServer/startupStatus/updated',
      params: { name: 'superone', status: 'ready' },
    })
    mapper.apply({
      method: 'turn/completed',
      params: { turn: { id: 'turn-1', status: 'completed' } },
    })

    expect(delta.textDelta).toBe('done')
    expect(events.map((event) => event.type)).toEqual([
      'message_start',
      'status_change',
      'codex_thread_started',
      'codex_item_delta',
      'codex_item_delta',
      'codex_item_delta',
      'codex_item_delta',
      'message_usage',
      'codex_mcp_startup',
      'message_complete',
      'status_change',
    ])
    const complete = events.find((event) => event.type === 'message_complete')
    expect(complete?.metadata?.codex).toMatchObject({
      threadId: 'thread-1',
      turnId: 'turn-1',
      model: 'gpt-5.4',
      usage: { lastInputTokens: 12, lastOutputTokens: 4, contextWindow: 128_000 },
    })
    expect((complete?.metadata?.codex as unknown as { finalResponse: string }).finalResponse).toBe('done')
  })

  it('keeps desktop Grok-style collaboration item normalization', () => {
    expect(mapCodexThreadItem({
      id: 'collab-1',
      type: 'collabAgentToolCall',
      tool: 'spawn_agent',
      status: 'completed',
      new_thread_id: 'child-1',
      agents_states: { 'child-1': { status: 'running', message: 'working' } },
    })).toMatchObject({
      id: 'collab-1',
      type: 'collab_tool_call',
      tool: 'spawnAgent',
      receiverThreadIds: ['child-1'],
      agentsStates: { 'child-1': { status: 'running', message: 'working' } },
    })
  })

  it('maps contextCompaction lifecycle to the shared compact UI without a Codex item', () => {
    const events: AgentEvent[] = []
    let now = 500
    const mapper = createCodexAgentEventMapper({
      messageId: 'compact-message',
      emit: (event) => events.push(event),
      turnKind: 'compact',
      now: () => now,
    })

    mapper.start('thread-1')
    mapper.apply({
      method: 'thread/tokenUsage/updated',
      params: {
        tokenUsage: {
          last: { inputTokens: 9_000, cachedInputTokens: 0, outputTokens: 0 },
          total: { inputTokens: 9_000, cachedInputTokens: 0, outputTokens: 0 },
          modelContextWindow: 128_000,
        },
      },
    })
    now = 1_000
    mapper.apply({
      method: 'item/started',
      params: {
        turnId: 'compact-turn',
        startedAtMs: 1_000,
        item: { id: 'compact-item', type: 'contextCompaction' },
      },
    })
    now = 2_250
    mapper.apply({
      method: 'item/completed',
      params: {
        turnId: 'compact-turn',
        completedAtMs: 2_250,
        item: { id: 'compact-item', type: 'contextCompaction' },
      },
    })
    mapper.apply({
      method: 'thread/compacted',
      params: { threadId: 'thread-1', turnId: 'compact-turn' },
    })

    const compactEvents = events.filter((event) => event.type === 'compact_boundary')
    expect(compactEvents).toEqual([{
      type: 'compact_boundary',
      trigger: 'manual',
      preTokens: 9_000,
      postTokens: 9_000,
      durationMs: 1_250,
      messageId: 'compact-message',
    }])
    expect(events.filter((event) => event.type === 'status_indicator')).toEqual([
      { type: 'status_indicator', indicator: 'compacting' },
      { type: 'status_indicator', indicator: null, compactResult: 'success' },
    ])
    expect(mapper.items()).toEqual([])
  })

  it('keeps async agent delivery out of the inline final response', () => {
    const events: AgentEvent[] = []
    const mapper = createCodexAgentEventMapper({ messageId: 'm', emit: (event) => events.push(event) })
    mapper.start('t')
    const questions = [
      { title: 'Which environment?', options: ['Staging', 'Production'] },
      { title: 'What deadline?', options: null },
    ]
    mapper.apply({ method: 'item/started', params: { item: { id: 'bg', type: 'agentMessage', text: '', delivery: 'async', questions } } })
    expect(mapper.apply({ method: 'item/agentMessage/delta', params: { itemId: 'bg', delta: 'background' } }).textDelta).toBeNull()
    mapper.apply({ method: 'item/completed', params: { item: { id: 'bg', type: 'agentMessage', text: 'background', delivery: 'async' } } })
    mapper.apply({ method: 'item/completed', params: { item: { id: 'inline', type: 'agentMessage', text: 'answer' } } })
    mapper.apply({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } })
    const complete = events.find((event) => event.type === 'message_complete')
    expect(complete?.metadata?.codex?.finalResponse).toBe('answer')
    expect(mapper.items()[0]).toMatchObject({ delivery: 'async', text: 'background', questions })
  })

  it('preserves 149 image failures and structured safety errors', () => {
    expect(mapCodexThreadItem({
      id: 'image',
      type: 'imageGeneration',
      status: 'failed',
      failure: { type: 'usageLimitExceeded', limitId: 'images', resetsAt: 42 },
    })).toMatchObject({ failure: { type: 'usageLimitExceeded', limitId: 'images', resetsAt: 42 } })

    const events: AgentEvent[] = []
    const mapper = createCodexAgentEventMapper({ messageId: 'm', emit: (event) => events.push(event) })
    mapper.start('t')
    mapper.apply({
      method: 'error',
      params: { message: 'review denied', codexErrorInfo: 'misalignmentPolicyViolation' },
    })
    expect(events.find((event) => event.type === 'message_error')).toMatchObject({
      errorInfo: { code: 'misalignmentPolicyViolation' },
    })
  })
})
