import { describe, it, expect } from 'vitest'
import { claudeMessagesToChatCompletions } from './request'

describe('claude messages → chat request conversion', () => {
  it('converts a basic text request', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'openai,gpt-4',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Hello' }],
      },
      'openai',
    )
    expect(result.model).toBe('gpt-4')
    expect(result.max_tokens).toBe(1000)
    const messages = result.messages as Record<string, unknown>[]
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('Hello')
  })

  it('converts a system prompt string to a system message', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'openai',
    )
    const messages = result.messages as Record<string, unknown>[]
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toBe('You are helpful.')
    expect(messages[1].role).toBe('user')
  })

  it('converts a system prompt array to a system message', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        system: [{ type: 'text', text: 'You are helpful.' }, { type: 'text', text: 'Be concise.' }],
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'openai',
    )
    const messages = result.messages as Record<string, unknown>[]
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toBe('You are helpful.\n\nBe concise.')
  })

  it('converts image content blocks', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this?' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
            ],
          },
        ],
      },
      'openai',
    )
    const messages = result.messages as Record<string, unknown>[]
    const content = messages[0].content as Record<string, unknown>[]
    expect(content[0].type).toBe('text')
    expect(content[0].text).toBe('What is this?')
    expect(content[1].type).toBe('image_url')
    expect((content[1].image_url as Record<string, unknown>).url).toContain('data:image/png;base64,abc')
  })

  it('converts assistant tool_use to OpenAI tool_calls', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'List files' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'tool_use', name: 'ls', input: { path: '/' } },
            ],
          },
        ],
      },
      'openai',
    )
    const messages = result.messages as Record<string, unknown>[]
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBeNull()
    const toolCalls = messages[1].tool_calls as Record<string, unknown>[]
    expect(toolCalls[0].id).toBe('call_1')
    expect((toolCalls[0].function as Record<string, unknown>).name).toBe('ls')
    expect((toolCalls[0].function as Record<string, unknown>).arguments).toBe('{"path":"/"}')
  })

  it('converts tool_result messages', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'List files' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', type: 'tool_use', name: 'ls', input: {} }],
          },
          { role: 'tool', tool_use_id: 'call_1', content: 'file1.txt\nfile2.txt' },
        ],
      },
      'openai',
    )
    const messages = result.messages as Record<string, unknown>[]
    expect(messages[2].role).toBe('tool')
    expect(messages[2].tool_call_id).toBe('call_1')
    expect(messages[2].content).toBe('file1.txt\nfile2.txt')
  })

  it('maps enabled thinking with high budget to reasoning_effort=high', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'o1',
        max_tokens: 2000,
        thinking: { type: 'enabled', budget_tokens: 1500 },
        messages: [{ role: 'user', content: 'Think' }],
      },
      'openai',
    )
    expect(result.reasoning_effort).toBe('high')
  })

  it('maps enabled thinking with medium budget to reasoning_effort=medium', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'o1',
        max_tokens: 2000,
        thinking: { type: 'enabled', budget_tokens: 600 },
        messages: [{ role: 'user', content: 'Think' }],
      },
      'openai',
    )
    expect(result.reasoning_effort).toBe('medium')
  })

  it('maps enabled thinking with low budget to reasoning_effort=low', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'o1',
        max_tokens: 2000,
        thinking: { type: 'enabled', budget_tokens: 100 },
        messages: [{ role: 'user', content: 'Think' }],
      },
      'openai',
    )
    expect(result.reasoning_effort).toBe('low')
  })

  it('maps adaptive thinking to reasoning_effort=medium', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'o1',
        thinking: { type: 'adaptive' },
        messages: [{ role: 'user', content: 'Think' }],
      },
      'openai',
    )
    expect(result.reasoning_effort).toBe('medium')
  })

  it('omits reasoning_effort when thinking is disabled', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'o1',
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: 'Think' }],
      },
      'openai',
    )
    expect(result.reasoning_effort).toBeUndefined()
  })

  it('omits reasoning_effort for non-reasoning models', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        thinking: { type: 'enabled', budget_tokens: 1000 },
        messages: [{ role: 'user', content: 'Think' }],
      },
      'openai',
    )
    expect(result.reasoning_effort).toBeUndefined()
  })

  it('strips the provider prefix from the model name', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'openai,gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'openai',
    )
    expect(result.model).toBe('gpt-4')
  })

  it('does not strip prefix when model has no comma', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'openai',
    )
    expect(result.model).toBe('gpt-4')
  })

  it('converts tools from Anthropic to OpenAI format', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Get weather' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            input_schema: { type: 'object', properties: { location: { type: 'string' } } },
          },
        ],
      },
      'openai',
    )
    const tools = result.tools as Record<string, unknown>[]
    expect(tools[0].type).toBe('function')
    expect((tools[0].function as Record<string, unknown>).name).toBe('get_weather')
    expect((tools[0].function as Record<string, unknown>).description).toBe('Get weather')
  })

  it('converts tool_choice from Anthropic to OpenAI format', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Get weather' }],
        tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
        tool_choice: { type: 'tool', name: 'get_weather' },
      },
      'openai',
    )
    const toolChoice = result.tool_choice as Record<string, unknown>
    expect(toolChoice.type).toBe('function')
    expect((toolChoice.function as Record<string, unknown>).name).toBe('get_weather')
  })

  it('injects stream_options.include_usage when streaming', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      },
      'openai',
    )
    expect(result.stream).toBe(true)
    expect((result.stream_options as Record<string, unknown>).include_usage).toBe(true)
  })

  it('omits stream_options when not streaming', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'openai',
    )
    expect(result.stream_options).toBeUndefined()
  })

  it('uses max_completion_tokens for o-series models', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'o1',
        max_tokens: 500,
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'openai',
    )
    expect(result.max_completion_tokens).toBe(500)
    expect(result.max_tokens).toBeUndefined()
  })

  it('uses max_tokens for non-o-series models', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        max_tokens: 500,
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'openai',
    )
    expect(result.max_tokens).toBe(500)
    expect(result.max_completion_tokens).toBeUndefined()
  })

  it('passes through temperature and top_p', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        temperature: 0.7,
        top_p: 0.9,
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'openai',
    )
    expect(result.temperature).toBe(0.7)
    expect(result.top_p).toBe(0.9)
  })

  it('passes through stop_sequences as stop', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        stop_sequences: ['END'],
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'openai',
    )
    expect(result.stop).toEqual(['END'])
  })

  it('merges mid-stream system messages into head', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        system: 'You are Codex.',
        messages: [
          { role: 'system', content: 'Permissions block' },
          { role: 'user', content: 'AGENTS.md' },
          { role: 'system', content: 'Collaboration Mode: Default' },
          { role: 'user', content: 'hello' },
        ],
      },
      'openai',
    )
    const messages = result.messages as Record<string, unknown>[]
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('You are Codex.')
    expect(messages[0].content).toContain('Permissions block')
    expect(messages[0].content).toContain('Collaboration Mode: Default')
    expect(messages[1].role).toBe('user')
    expect(messages[2].role).toBe('user')
  })

  it('preserves assistant thinking_content in the message', () => {
    const result = claudeMessagesToChatCompletions(
      {
        model: 'gpt-4',
        messages: [
          { role: 'assistant', reasoning_content: 'I need to think.', content: 'Done.' },
        ],
      },
      'openai',
    )
    const messages = result.messages as Record<string, unknown>[]
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].content).toBe('Done.')
    expect(messages[0].reasoning_content).toBe('I need to think.')
  })
})
