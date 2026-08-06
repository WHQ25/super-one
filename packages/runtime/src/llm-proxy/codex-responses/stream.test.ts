import { describe, it, expect } from 'vitest'
import { convertChatSseText } from './stream'

function chunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

describe('chat SSE → responses SSE conversion', () => {
  it('emits created + text deltas + completed for a text stream', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'Hel' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'lo' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: {}, finish_reason: 'stop' }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('event: response.created')
    expect(out).toContain('event: response.output_text.delta')
    expect(out).toContain('event: response.output_text.done')
    expect(out).toContain('event: response.completed')
    expect(out).toContain('"delta":"Hel"')
    expect(out).toContain('"text":"Hello"')
  })

  it('emits reasoning summary events for reasoning deltas', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { reasoning_content: 'thinking...' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'answer' } }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('event: response.reasoning_summary_part.added')
    expect(out).toContain('event: response.reasoning_summary_text.delta')
    expect(out).toContain('event: response.reasoning_summary_text.done')
    expect(out).toContain('event: response.output_text.delta')
  })

  it('emits function_call events for streamed tool calls', () => {
    const input =
      chunk({
        id: 'c1',
        model: 'm',
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'ls', arguments: '' } }] } }],
      }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"/"}' } }] } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('"type":"function_call"')
    expect(out).toContain('event: response.function_call_arguments.delta')
    expect(out).toContain('event: response.function_call_arguments.done')
    expect(out).toContain('event: response.output_item.done')
    expect(out).toContain('"arguments":"{\\"path\\":\\"/\\"}"')
    expect(out).toContain('"call_id":"call_1"')
  })

  it('emits response.failed and no response.completed on an error event', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'partial' } }] }) +
      `event: error\ndata: ${JSON.stringify({ error: { message: 'bad request', type: 'invalid_request_error' } })}\n\n`
    const out = convertChatSseText(input)
    expect(out).toContain('event: response.failed')
    expect(out).toContain('bad request')
    expect(out).not.toContain('event: response.completed')
  })

  it('splits an inline <think> block into reasoning then text', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: '<think>weigh' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: ' options</think>Answer' } }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('event: response.reasoning_summary_text.delta')
    expect(out).toContain('event: response.output_text.delta')
    expect(out).toContain('"text":"Answer"')
    expect(out).not.toContain('<think>')
  })

  it('carries usage into the completed response', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'hi' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('"input_tokens":3')
    expect(out).toContain('"output_tokens":1')
  })
})
