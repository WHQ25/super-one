import { createServer } from 'node:http'

/** Stateless MCP whose credential determines its entire tool surface. */
export async function startNativeScopeProvider() {
  const calls: Array<{ scope: string; nativeSessionId?: unknown }> = []
  const requests: Array<{ scope?: string; method?: string }> = []
  const server = createServer(async (request, response) => {
    const scope = /^Bearer (scope_[ab])$/.exec(request.headers.authorization ?? '')?.[1]
    if (!scope) { response.writeHead(401).end(); return }
    if (request.method !== 'POST') { response.writeHead(405).end(); return }
    let text = ''
    for await (const chunk of request) text += chunk
    const rpc = JSON.parse(text)
    requests.push({ scope, method: rpc.method })
    if (!('id' in rpc)) { response.writeHead(202).end(); return }
    let result: unknown = {}
    if (rpc.method === 'initialize') result = { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: scope, version: '1' } }
    if (rpc.method === 'tools/list') result = { tools: [{ name: scope, description: 'Return the authenticated fixture scope',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }
    if (rpc.method === 'tools/call') {
      calls.push({ scope, nativeSessionId: rpc.params._meta?.['ai.opencode/sessionID'] })
      result = { content: [{ type: 'text', text: scope }] }
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, calls, requests,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }) }
}
