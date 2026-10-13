import { createServer, type ServerResponse } from 'node:http'

/** A local OpenAI chat stream for native integration checks; no external model. */
export async function startOpenCodeModelProvider(autoReply?: string) {
  const requests: Array<{ authorization?: string; body: Record<string, unknown> }> = []
  const pending: Array<{ response: ServerResponse; index: number }> = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    if (!request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return }
    const parsed = JSON.parse(body)
    const title = (parsed.messages as Array<{ role: string; content: unknown }>).some(message =>
      message.role === 'system' && typeof message.content === 'string' && message.content.includes('You are a title generator'))
    const index = title ? 0 : requests.push({ authorization: request.headers.authorization, body: parsed })
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    response.flushHeaders()
    if (title || autoReply !== undefined) finish({ response, index }, title ? 'Native fixture' : autoReply!)
    else pending.push({ response, index })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  function finish(entry: { response: ServerResponse; index: number }, text: string, tool?: { name: string; arguments: string }) {
    const chunk = (delta: unknown, finish_reason: string | null = null) => entry.response.write(`data: ${JSON.stringify({
      id: `fixture-${entry.index}`, object: 'chat.completion.chunk', created: 0, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`)
    chunk({ role: 'assistant' })
    if (tool) chunk({ tool_calls: [{ index: 0, id: `call-${entry.index}`, type: 'function', function: tool }] })
    else chunk({ content: text })
    chunk({}, tool ? 'tool_calls' : 'stop')
    entry.response.end('data: [DONE]\n\n')
  }
  return {
    baseUrl, requests,
    finish(text: string) {
      let entry = pending.shift()
      while (entry?.response.destroyed) entry = pending.shift()
      if (!entry) throw new Error('No native model request is pending')
      finish(entry, text)
    },
    callTool(name: string, args: Record<string, unknown> = {}) {
      const entry = pending.shift()
      if (!entry) throw new Error('No native model request is pending')
      finish(entry, '', { name, arguments: JSON.stringify(args) })
    },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }),
  }
}

export function nativeModelFixtureConfig(baseURL: string) {
  return { warming: false, providers: { superone_fixture: {
    package: '@opencode/ai/providers/openai-compatible', env: ['SUPERONE_FIXTURE_KEY'],
    settings: { baseURL }, models: { fixture: { modelID: 'fixture', capabilities: { tools: true } } },
  } }, model: 'superone_fixture/fixture', small_model: 'superone_fixture/fixture' }
}
