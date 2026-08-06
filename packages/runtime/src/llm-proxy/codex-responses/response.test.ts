import { describe, it, expect } from 'vitest'
import { chatCompletionToResponse, chatUsageToResponsesUsage, chatErrorToResponseError } from './response'

describe('chat→responses non-stream conversion', () => {
  it('extracts reasoning_details into a reasoning output item', () => {
    const result = chatCompletionToResponse({
      id: 'chatcmpl_minimax',
      object: 'chat.completion',
      created: 123,
      model: 'MiniMax-M2.7',
      choices: [
        {
          message: {
            role: 'assistant',
            reasoning_details: [{ type: 'reasoning_text', text: 'Need to inspect the code.' }],
            content: 'Done',
          },
          finish_reason: 'stop',
        },
      ],
    })
    const output = result.output as Record<string, unknown>[]
    expect(output[0].type).toBe('reasoning')
    expect((output[0].summary as Record<string, unknown>[])[0].text).toBe('Need to inspect the code.')
    expect((output[1].content as Record<string, unknown>[])[0].text).toBe('Done')
    expect(result.status).toBe('completed')
    expect(result.id).toBe('resp_chatcmpl_minimax')
  })

  it('maps tool calls into function_call output items', () => {
    const result = chatCompletionToResponse({
      id: 'x',
      model: 'gpt-4o',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'ls', arguments: '{"path":"/"}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    })
    const output = result.output as Record<string, unknown>[]
    const fc = output.find((o) => o.type === 'function_call') as Record<string, unknown>
    expect(fc.call_id).toBe('call_9')
    expect(fc.name).toBe('ls')
    expect(fc.arguments).toBe('{"path":"/"}')
    expect(fc.id).toBe('fc_call_9')
  })

  it('marks status incomplete and adds incomplete_details on length finish', () => {
    const result = chatCompletionToResponse({
      id: 'y',
      model: 'm',
      choices: [{ message: { role: 'assistant', content: 'partial' }, finish_reason: 'length' }],
    })
    expect(result.status).toBe('incomplete')
    expect(result.incomplete_details).toEqual({ reason: 'max_output_tokens' })
  })

  it('splits a leading <think> block into reasoning + answer', () => {
    const result = chatCompletionToResponse({
      id: 'z',
      model: 'deepseek',
      choices: [{ message: { role: 'assistant', content: '<think>weighing options</think>Final answer.' }, finish_reason: 'stop' }],
    })
    const output = result.output as Record<string, unknown>[]
    expect(output[0].type).toBe('reasoning')
    expect((output[0].summary as Record<string, unknown>[])[0].text).toBe('weighing options')
    expect((output[1].content as Record<string, unknown>[])[0].text).toBe('Final answer.')
  })

  it('remaps usage field names and cached tokens', () => {
    const usage = chatUsageToResponsesUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 4 },
    })
    expect(usage.input_tokens).toBe(10)
    expect(usage.output_tokens).toBe(5)
    expect(usage.total_tokens).toBe(15)
    expect((usage.input_tokens_details as Record<string, unknown>).cached_tokens).toBe(4)
  })

  it('defaults usage to zeros when absent', () => {
    expect(chatUsageToResponsesUsage(undefined)).toEqual({ input_tokens: 0, output_tokens: 0, total_tokens: 0 })
  })

  it('normalizes MiniMax base_resp errors into Responses error shape', () => {
    const err = chatErrorToResponseError({ base_resp: { status_code: 2013, status_msg: 'invalid role' } })
    const error = err.error as Record<string, unknown>
    expect(error.message).toBe('invalid role')
    expect(error.code).toBe(2013)
    expect(error.type).toBe('upstream_error')
  })

  it('passes through standard OpenAI error objects', () => {
    const err = chatErrorToResponseError({ error: { message: 'bad key', type: 'invalid_request_error', code: 'x' } })
    const error = err.error as Record<string, unknown>
    expect(error.message).toBe('bad key')
    expect(error.type).toBe('invalid_request_error')
    expect(error.code).toBe('x')
  })
})
