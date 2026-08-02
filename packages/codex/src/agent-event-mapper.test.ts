import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import {
  createCodexAgentEventMapper,
  mapCodexThreadItem,
} from './agent-event-mapper'

describe('Codex AgentEvent mapper', () => {
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
})
