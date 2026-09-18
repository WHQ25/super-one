import { describe, it, expect, vi } from 'vitest'
import { CodexResponsesTransformer } from './transformer'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function sseResponse(blocks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block))
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
}

describe('CodexResponsesTransformer (@musistudio endpoint surface)', () => {
  const transformer = new CodexResponsesTransformer()

  it('declares the /responses endpoint', () => {
    expect(transformer.name).toBe('codex-responses')
    expect(transformer.endPoint).toBe('/responses')
  })

  it('transformRequestOut converts a Responses request into a chat request', async () => {
    const chat = await transformer.transformRequestOut({
      model: 'kimi,kimi-k2',
      instructions: 'Be concise.',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    })
    expect(chat.input).toBeUndefined()
    const messages = chat.messages as Record<string, unknown>[]
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toBe('hi')
  })

  it('forwards SuperOne function tools and logs only conversion counts', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      const chat = await transformer.transformRequestOut({
        model: 'kimi,kimi-k2', instructions: 'private prompt',
        tools: [
          { type: 'function', name: 'mcp__superone__session_rename', description: 'private description', parameters: { type: 'object' } },
          { type: 'namespace', name: 'private namespace', tools: [] },
        ],
      })
      expect(chat.tools).toEqual([
        { type: 'function', function: { name: 'mcp__superone__session_rename', description: 'private description', parameters: { type: 'object' } } },
      ])
      const output = stderr.mock.calls.map(([text]) => String(text)).join('')
      expect(output).toContain('[codex-mcp-tools]')
      expect(output).toContain('"input":{"total":2,"function":1,"namespace":1,"other":0,"superone":1}')
      expect(output).toContain('"output":{"total":1,"function":1,"namespace":0,"other":0,"superone":1}')
      expect(output).not.toContain('private')
      expect(output).not.toContain('session_rename')
    } finally { stderr.mockRestore() }
  })

  it('transformResponseIn maps a JSON chat completion into a Responses object', async () => {
    const upstream = jsonResponse({
      id: 'chatcmpl_1',
      model: 'kimi-k2',
      choices: [{ message: { role: 'assistant', content: 'Hello there' }, finish_reason: 'stop' }],
    })
    const out = await transformer.transformResponseIn(upstream)
    const body = await out.json()
    expect(body.object).toBe('response')
    expect(body.status).toBe('completed')
    const message = (body.output as Record<string, unknown>[]).find((o) => o.type === 'message') as Record<string, unknown>
    expect((message.content as Record<string, unknown>[])[0].text).toBe('Hello there')
  })

  it('transformResponseIn maps an error JSON into a Responses error shape', async () => {
    const upstream = jsonResponse({ error: { message: 'bad key', type: 'invalid_request_error' } }, 401)
    const out = await transformer.transformResponseIn(upstream)
    expect(out.status).toBe(401)
    const body = await out.json()
    expect(body.error.message).toBe('bad key')
    expect(body.error.type).toBe('invalid_request_error')
  })

  it('transformResponseIn converts a chat SSE stream into Responses SSE', async () => {
    const upstream = sseResponse([
      `data: ${JSON.stringify({ id: 'c1', model: 'm', choices: [{ delta: { content: 'Hi' } }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'c1', model: 'm', choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ])
    const out = await transformer.transformResponseIn(upstream)
    expect(out.headers.get('content-type')).toContain('text/event-stream')
    const text = await out.text()
    expect(text).toContain('event: response.created')
    expect(text).toContain('event: response.output_text.delta')
    expect(text).toContain('event: response.completed')
    expect(text).toContain('"delta":"Hi"')
  })
})
