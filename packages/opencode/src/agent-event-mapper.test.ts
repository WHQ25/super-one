import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { createOpenCodeAgentEventMapper } from './agent-event-mapper'

describe('OpenCode AgentEvent mapper', () => {
  it('projects assistant snapshots, tools, interactions, todos, and metadata', () => {
    const events: AgentEvent[] = []
    const mapper = createOpenCodeAgentEventMapper({
      messageId: 'message-1',
      emit: (event) => events.push(event),
      now: () => 2_000,
      contextWindowForModel: () => 128_000,
    })
    mapper.start('open-session-1')

    mapper.apply({
      type: 'message.part.updated',
      properties: {
        sessionID: 'open-session-1',
        part: { id: 'part-1', messageID: 'assistant-1', type: 'text', text: 'hello', time: { start: 1 } },
      },
    } as never)
    expect(mapper.apply({
      type: 'message.updated',
      properties: {
        sessionID: 'open-session-1',
        info: {
          id: 'assistant-1',
          role: 'assistant',
          providerID: 'openai',
          modelID: 'gpt-5.4',
          agent: 'build',
          cost: 0.1,
          finish: null,
          tokens: { input: 10, output: 5, reasoning: 2, total: 20, cache: { read: 2, write: 1 } },
        },
      },
    } as never).textDelta).toBe('hello')
    mapper.apply({
      type: 'message.part.updated',
      properties: {
        sessionID: 'open-session-1',
        part: {
          id: 'tool-part',
          messageID: 'assistant-1',
          type: 'tool',
          tool: 'shell',
          callID: 'call-1',
          state: { status: 'completed', input: { command: 'pwd' }, output: '/tmp', time: { start: 1, end: 2 } },
        },
      },
    } as never)
    mapper.apply({
      type: 'todo.updated',
      properties: {
        sessionID: 'open-session-1',
        todos: [{ content: 'check output', status: 'in_progress', priority: 'high' }],
      },
    } as never)
    mapper.apply({
      type: 'permission.v2.asked',
      properties: {
        sessionID: 'open-session-1',
        id: 'permission-1',
        action: 'bash',
        resources: ['pwd'],
        metadata: { command: 'pwd' },
        save: ['pwd'],
        source: { callID: 'call-1' },
      },
    } as never)
    mapper.apply({
      type: 'question.v2.asked',
      properties: {
        sessionID: 'open-session-1',
        id: 'question-1',
        questions: [{ question: 'Continue?', header: 'Confirm', options: [{ label: 'Yes' }] }],
      },
    } as never)
    mapper.apply({
      type: 'session.status',
      properties: { sessionID: 'open-session-1', status: { type: 'idle' } },
    } as never)

    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'message_start',
      'provider_session_id',
      'content_delta',
      'message_usage',
      'todos_updated',
      'permission_request',
      'ask_user_question',
      'message_complete',
    ]))
    const toolBlocks = events
      .filter((event) => event.type === 'content_delta')
      .map((event) => event.delta)
    expect(toolBlocks).toContainEqual(expect.objectContaining({ type: 'tool_use', toolName: 'Bash', toolUseId: 'call-1' }))
    expect(toolBlocks).toContainEqual(expect.objectContaining({ type: 'tool_result', toolUseId: 'call-1', summary: '/tmp' }))
    const complete = events.find((event) => event.type === 'message_complete')
    expect(complete?.metadata).toMatchObject({ model: 'openai/gpt-5.4', agent: 'build', costUsd: 0.1 })
  })

  it('emits retries without completing the turn', () => {
    const events: AgentEvent[] = []
    const mapper = createOpenCodeAgentEventMapper({
      messageId: 'message-2',
      emit: (event) => events.push(event),
      now: () => 1_000,
    })
    mapper.start()
    const result = mapper.apply({
      type: 'session.status',
      properties: { status: { type: 'retry', attempt: 2, next: 1_500, message: 'rate limited' } },
    } as never)
    expect(result.terminal).toBe(false)
    expect(events).toContainEqual({
      type: 'api_retry',
      attempt: 2,
      delayMs: 500,
      message: 'rate limited',
    })
  })
})
