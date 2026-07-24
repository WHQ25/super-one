import { describe, it, expect } from 'vitest'
import {
  chatCompletionToMessage,
  chatUsageToMessageUsage,
  chatErrorToMessageError,
  messageIdFromChatId,
} from './response'

describe('chat→message non-stream conversion', () => {
  it('converts a basic text response', () => {
    const result = chatCompletionToMessage({
      id: 'chatcmpl_1',
      model: 'gpt-4',
      choices: [
        {
          message: { role: 'assistant', content: 'Hello there' },
          finish_reason: 'stop',
        },
      ],
    })
    expect(result.id).toBe('msg_chatcmpl_1')
    expect(result.type).toBe('message')
    expect(result.role).toBe('assistant')
    expect(result.model).toBe('gpt-4')
    expect(result.stop_reason).toBe('end_turn')
    expect(result.stop_sequence).toBeNull()
    const content = result.content as Record<string, unknown>[]
    expect(content[0].type).toBe('text')
    expect((content[0] as Record<string, unknown>).text).toBe('Hello there')
  })

  it('extracts reasoning_content into a thinking block', () => {
    const result = chatCompletionToMessage({
      id: 'x',
      model: 'o1',
      choices: [
        {
          message: {
            role: 'assistant',
            reasoning_content: 'Need to inspect the code.',
            content: 'Done',
          },
          finish_reason: 'stop',
        },
      ],
    })
    const content = result.content as Record<string, unknown>[]
    expect(content[0].type).toBe('thinking')
    expect((content[0] as Record<string, unknown>).thinking).toBe('Need to inspect the code.')
    expect(content[1].type).toBe('text')
    expect((content[1] as Record<string, unknown>).text).toBe('Done')
  })

  it('splits a leading think block into reasoning + answer', () => {
    const result = chatCompletionToMessage({
      id: 'z',
      model: 'deepseek',
      choices: [
        {
          message: { role: 'assistant', content: '<think>weighing options</think>Final answer.' },
          finish_reason: 'stop',
        },
      ],
    })
    const content = result.content as Record<string, unknown>[]
    expect(content[0].type).toBe('thinking')
    expect((content[0] as Record<string, unknown>).thinking).toBe('weighing options')
    expect(content[1].type).toBe('text')
    expect((content[1] as Record<string, unknown>).text).toBe('Final answer.')
  })

  it('maps tool calls into tool_use content blocks', () => {
    const result = chatCompletionToMessage({
      id: 'y',
      model: 'gpt-4',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call_9', type: 'function', function: { name: 'ls', arguments: '{"path":"/"}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    })
    const content = result.content as Record<string, unknown>[]
    const toolUse = content.find((c) => c.type === 'tool_use') as Record<string, unknown>
    expect(toolUse.id).toBe('call_9')
    expect(toolUse.name).toBe('ls')
    expect(toolUse.input).toEqual({ path: '/' })
    expect(result.stop_reason).toBe('tool_use')
  })

  it('maps finish_reason=length to stop_reason=max_tokens', () => {
    const result = chatCompletionToMessage({
      id: 'y',
      model: 'gpt-4',
      choices: [{ message: { role: 'assistant', content: 'partial' }, finish_reason: 'length' }],
    })
    expect(result.stop_reason).toBe('max_tokens')
  })

  it('maps finish_reason=content_filter to stop_reason=end_turn', () => {
    const result = chatCompletionToMessage({
      id: 'y',
      model: 'gpt-4',
      choices: [{ message: { role: 'assistant', content: 'partial' }, finish_reason: 'content_filter' }],
    })
    expect(result.stop_reason).toBe('end_turn')
  })

  it('remaps usage field names and cached tokens', () => {
    const usage = chatUsageToMessageUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 4 },
    })
    expect(usage.input_tokens).toBe(10)
    expect(usage.output_tokens).toBe(5)
    expect(usage.total_tokens).toBe(15)
    expect((usage.cache_read_input_tokens)).toBe(4)
  })

  it('defaults usage to zeros when absent', () => {
    expect(chatUsageToMessageUsage(undefined)).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    })
  })

  it('normalizes OpenAI error objects', () => {
    const err = chatErrorToMessageError({
      error: { message: 'bad key', type: 'invalid_request_error', code: 'x' },
    })
    expect(err.type).toBe('error')
    expect((err.error as Record<string, unknown>).message).toBe('bad key')
    expect((err.error as Record<string, unknown>).type).toBe('invalid_request_error')
  })

  it('handles empty error response', () => {
    const err = chatErrorToMessageError(null)
    expect(err.type).toBe('error')
    expect((err.error as Record<string, unknown>).type).toBe('upstream_error')
  })

  it('prefixes message id with msg_', () => {
    expect(messageIdFromChatId('chatcmpl_123')).toBe('msg_chatcmpl_123')
  })

  it('preserves existing msg_ prefix', () => {
    expect(messageIdFromChatId('msg_123')).toBe('msg_123')
  })

  it('handles null content (tool-only response)', () => {
    const result = chatCompletionToMessage({
      id: 'x',
      model: 'gpt-4',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    })
    const content = result.content as Record<string, unknown>[]
    expect(content.length).toBe(1)
    expect(content[0].type).toBe('tool_use')
  })
})
