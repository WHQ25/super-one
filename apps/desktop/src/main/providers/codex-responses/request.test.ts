import { describe, it, expect } from 'vitest'
import { responsesToChatCompletions } from './request'
import { resolveCodexChatReasoning } from './reasoning'

describe('responses→chat request conversion', () => {
  it('injects stream_options.include_usage when streaming', () => {
    const result = responsesToChatCompletions({
      model: 'kimi-k2.6',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      stream: true,
    })
    expect(result.stream).toBe(true)
    expect((result.stream_options as Record<string, unknown>).include_usage).toBe(true)
  })

  it('omits stream_options when not streaming', () => {
    const result = responsesToChatCompletions({
      model: 'kimi-k2.6',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    })
    expect(result.stream_options).toBeUndefined()
  })

  it('merges include_usage into existing stream_options', () => {
    const result = responsesToChatCompletions({
      model: 'kimi-k2.6',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      stream: true,
      stream_options: { continuous_usage_stats: true },
    })
    const opts = result.stream_options as Record<string, unknown>
    expect(opts.include_usage).toBe(true)
    expect(opts.continuous_usage_stats).toBe(true)
  })

  it('maps messages, tools and limits', () => {
    const result = responsesToChatCompletions({
      model: 'gpt-5.4',
      instructions: 'You are concise.',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Weather?' },
            { type: 'input_image', image_url: 'data:image/png;base64,abc' },
            { type: 'input_text', text: 'Use Celsius.' },
          ],
        },
        { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"Tokyo"}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'Sunny' },
      ],
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object' },
          strict: true,
        },
      ],
      tool_choice: { type: 'function', name: 'get_weather' },
      max_output_tokens: 100,
      reasoning: { effort: 'high' },
      stream: true,
    }, resolveCodexChatReasoning('custom:openai-compatible'))

    const messages = result.messages as Record<string, unknown>[]
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    const userContent = messages[1].content as Record<string, unknown>[]
    expect(userContent[0].type).toBe('text')
    expect(userContent[1].type).toBe('image_url')
    expect(userContent[2].type).toBe('text')
    expect(userContent[2].text).toBe('Use Celsius.')
    const toolCall = (messages[2].tool_calls as Record<string, unknown>[])[0]
    expect(toolCall.id).toBe('call_1')
    expect(messages[3].role).toBe('tool')

    const tool = (result.tools as Record<string, unknown>[])[0]
    expect((tool.function as Record<string, unknown>).name).toBe('get_weather')
    expect((tool.function as Record<string, unknown>).strict).toBe(true)
    expect((result.tool_choice as Record<string, Record<string, unknown>>).function.name).toBe('get_weather')
    expect(result.max_tokens).toBe(100)
    expect(result.reasoning_effort).toBe('high')
  })

  it('normalizes codex internal roles (developer/latest_reminder/unknown)', () => {
    const result = responsesToChatCompletions({
      model: 'gpt-5.4',
      input: [
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Follow project instructions.' }] },
        { type: 'message', role: 'latest_reminder', content: 'Keep the reply brief.' },
        { type: 'message', role: 'unknown_codex_role', content: 'Fallback content.' },
      ],
    })
    const messages = result.messages as Record<string, unknown>[]
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toBe('Follow project instructions.')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toBe('Keep the reply brief.')
    expect(messages[2].role).toBe('user')
    expect(messages[2].content).toBe('Fallback content.')
  })

  it('merges mid-stream system messages into head, preserving order', () => {
    const result = responsesToChatCompletions({
      model: 'MiniMax-M2.7',
      instructions: 'You are Codex.',
      input: [
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Permissions block' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'AGENTS.md' }] },
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Collaboration Mode: Default' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
      ],
    })
    const messages = result.messages as Record<string, unknown>[]
    messages.forEach((msg, idx) => {
      if (idx === 0) expect(msg.role).toBe('system')
      else expect(msg.role).not.toBe('system')
    })
    const head = messages[0].content as string
    expect(head).toContain('You are Codex.')
    expect(head).toContain('Permissions block')
    expect(head).toContain('Collaboration Mode: Default')
  })

  it('passes reasoning back to the following assistant message', () => {
    const result = responsesToChatCompletions({
      model: 'gpt-5.4',
      input: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Need to inspect the repo.' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I will check the files.' }] },
        { type: 'message', role: 'user', content: 'Continue' },
      ],
    })
    const messages = result.messages as Record<string, unknown>[]
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].content).toBe('I will check the files.')
    expect(messages[0].reasoning_content).toBe('Need to inspect the repo.')
    expect(messages[1].reasoning_content).toBeUndefined()
  })

  it('attaches trailing reasoning to the previous assistant message', () => {
    const result = responsesToChatCompletions({
      model: 'gpt-5.4',
      input: [
        { type: 'message', role: 'assistant', content: 'I checked the files.' },
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'The answer came from README.' }] },
        { type: 'message', role: 'user', content: 'Continue' },
      ],
    })
    const messages = result.messages as Record<string, unknown>[]
    expect(messages[0].reasoning_content).toBe('The answer came from README.')
    expect(messages[1].reasoning_content).toBeUndefined()
  })

  it('keeps embedded assistant reasoning_content', () => {
    const result = responsesToChatCompletions({
      model: 'gpt-5.4',
      input: [
        { type: 'message', role: 'assistant', reasoning_content: 'I need to preserve thinking history.', content: 'Done.' },
      ],
    })
    const messages = result.messages as Record<string, unknown>[]
    expect(messages[0].content).toBe('Done.')
    expect(messages[0].reasoning_content).toBe('I need to preserve thinking history.')
  })

  it('attaches reasoning to a tool-call assistant message', () => {
    const result = responsesToChatCompletions({
      model: 'gpt-5.4',
      input: [
        { type: 'reasoning', summary: 'Need to read a file.' },
        { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"README.md"}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'Readme content' },
      ],
    })
    const messages = result.messages as Record<string, unknown>[]
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].reasoning_content).toBe('Need to read a file.')
    expect((messages[0].tool_calls as Record<string, unknown>[])[0].id).toBe('call_1')
    expect(messages[1].role).toBe('tool')
  })
})
