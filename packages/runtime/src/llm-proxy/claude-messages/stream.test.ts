import { describe, it, expect } from 'vitest'
import { convertChatSseText, ChatToMessagesState, feedSseBlock } from './stream'

function chunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

describe('chat SSE → messages SSE conversion', () => {
  it('emits message_start + text deltas + message_delta + message_stop for a text stream', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'Hel' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'lo' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: {}, finish_reason: 'stop' }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('event: message_start')
    expect(out).toContain('event: content_block_start')
    expect(out).toContain('event: content_block_delta')
    expect(out).toContain('event: content_block_stop')
    expect(out).toContain('event: message_delta')
    expect(out).toContain('event: message_stop')
    expect(out).toContain('"text":"Hel"')
    expect(out).toContain('"text":"lo"')
    expect(out).toContain('"stop_reason":"end_turn"')
  })

  it('emits thinking content block for reasoning_content deltas', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { reasoning_content: 'thinking...' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'answer' } }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('"type":"thinking"')
    expect(out).toContain('"type":"thinking_delta"')
    expect(out).toContain('"thinking":"thinking..."')
    expect(out).toContain('"type":"text"')
    expect(out).toContain('"type":"text_delta"')
    expect(out).toContain('"text":"answer"')
  })

  it('emits tool_use content block for streamed tool calls', () => {
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
    expect(out).toContain('"type":"tool_use"')
    expect(out).toContain('"id":"call_1"')
    expect(out).toContain('"name":"ls"')
    expect(out).toContain('"type":"input_json_delta"')
    expect(out).toContain('"partial_json":"{\\"path\\":')
    expect(out).toContain('"partial_json":"\\"/\\"}"')
    expect(out).toContain('"stop_reason":"tool_use"')
  })

  it('emits response.failed and message_stop on an error event', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'partial' } }] }) +
      `event: error\ndata: ${JSON.stringify({ error: { message: 'bad request', type: 'invalid_request_error' } })}\n\n`
    const out = convertChatSseText(input)
    expect(out).toContain('event: message_stop')
    expect(out).toContain('bad request')
  })

  it('carries usage into the message_delta event', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'hi' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('"input_tokens":3')
    expect(out).toContain('"output_tokens":1')
  })

  it('handles empty stream with only DONE', () => {
    const out = convertChatSseText('data: [DONE]\n\n')
    expect(out).toContain('event: message_start')
    expect(out).toContain('event: message_delta')
    expect(out).toContain('event: message_stop')
  })

  it('handles multiple tool calls in parallel', () => {
    const input =
      chunk({
        id: 'c1',
        model: 'm',
        choices: [{
          delta: {
            tool_calls: [
              { index: 0, id: 'call_1', function: { name: 'ls', arguments: '' } },
              { index: 1, id: 'call_2', function: { name: 'cat', arguments: '' } },
            ],
          },
        }],
      }) +
      chunk({
        id: 'c1',
        model: 'm',
        choices: [{
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: '{"p":' } },
              { index: 1, function: { arguments: '{"f":' } },
            ],
          },
        }],
      }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('"id":"call_1"')
    expect(out).toContain('"id":"call_2"')
    expect(out).toContain('"name":"ls"')
    expect(out).toContain('"name":"cat"')
  })

  it('handles tool-only response (no text)', () => {
    const input =
      chunk({
        id: 'c1',
        model: 'm',
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'ls', arguments: '{}' } }] } }],
      }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('"type":"tool_use"')
    expect(out).not.toContain('"type":"text"')
  })

  it('handles interleaved reasoning, text, and tool calls', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { reasoning_content: 'thinking' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'answer' } }] }) +
      chunk({
        id: 'c1',
        model: 'm',
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'ls', arguments: '{}' } }] } }],
      }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    const thinkingStart = out.indexOf('"type":"thinking"')
    const textStart = out.indexOf('"type":"text"')
    const toolStart = out.indexOf('"type":"tool_use"')
    expect(thinkingStart).toBeGreaterThan(-1)
    expect(textStart).toBeGreaterThan(thinkingStart)
    expect(toolStart).toBeGreaterThan(textStart)
  })

  it('handles length finish reason', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'partial' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: {}, finish_reason: 'length' }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('"stop_reason":"max_tokens"')
  })

  it('handles function_call finish reason as tool_use', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'partial' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: {}, finish_reason: 'function_call' }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('"stop_reason":"tool_use"')
  })

  it('uses message id from chat completion id', () => {
    const input =
      chunk({ id: 'chatcmpl_abc', model: 'm', choices: [{ delta: { content: 'hi' } }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    expect(out).toContain('"id":"msg_chatcmpl_abc"')
  })

  it('emits content_block_stop for each block before message_delta', () => {
    const input =
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { reasoning_content: 'thinking' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'answer' } }] }) +
      chunk({ id: 'c1', model: 'm', choices: [{ delta: {}, finish_reason: 'stop' }] }) +
      'data: [DONE]\n\n'
    const out = convertChatSseText(input)
    const stopCount = (out.match(/event: content_block_stop/g) || []).length
    expect(stopCount).toBe(2)
  })
})

describe('ChatToMessagesState', () => {
  it('finalizes correctly after partial content', () => {
    const state = new ChatToMessagesState()
    const events = state.handleChatChunk({
      id: 'c1',
      model: 'm',
      choices: [{ delta: { content: 'Hello' } }],
    })
    expect(events.some((e) => e.includes('message_start'))).toBe(true)
    expect(events.some((e) => e.includes('text_delta'))).toBe(true)

    const finalEvents = state.finalize()
    expect(finalEvents.some((e) => e.includes('content_block_stop'))).toBe(true)
    expect(finalEvents.some((e) => e.includes('message_delta'))).toBe(true)
    expect(finalEvents.some((e) => e.includes('message_stop'))).toBe(true)
  })

  it('handles failedEvent', () => {
    const state = new ChatToMessagesState()
    const event = state.failedEvent('Something went wrong', 'server_error')
    expect(event).toContain('message_stop')
    expect(event).toContain('Something went wrong')
  })

  it('does not double-finalize', () => {
    const state = new ChatToMessagesState()
    state.handleChatChunk({ id: 'c1', model: 'm', choices: [{ delta: { content: 'hi' } }] })
    const first = state.finalize()
    const second = state.finalize()
    expect(second).toEqual([])
  })
})

describe('feedSseBlock', () => {
  it('handles non-JSON data gracefully', () => {
    const state = new ChatToMessagesState()
    const result = feedSseBlock(state, 'data: not json\n\n')
    expect(result.events).toEqual([])
    expect(result.failed).toBe(false)
  })

  it('handles blocks without data', () => {
    const state = new ChatToMessagesState()
    const result = feedSseBlock(state, 'event: ping\n\n')
    expect(result.events).toEqual([])
    expect(result.failed).toBe(false)
  })
})
