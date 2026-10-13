import { createServer } from 'node:http'

/** Isolated OAuth + stateless MCP provider. No accounts, models or real tokens. */
export async function startOpenCodeOAuthProvider() {
  let baseUrl = ''
  let authorized = false
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, baseUrl)
    const json = (body: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)) }
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return json({ resource: `${baseUrl}/mcp`, authorization_servers: [baseUrl], scopes_supported: ['mcp'] })
    }
    if (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/openid-configuration') {
      return json({ issuer: baseUrl, authorization_endpoint: `${baseUrl}/authorize`, token_endpoint: `${baseUrl}/token`,
        registration_endpoint: `${baseUrl}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
        token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'] })
    }
    if (url.pathname === '/authorize') {
      authorized = true
      const redirect = new URL(url.searchParams.get('redirect_uri')!)
      redirect.searchParams.set('code', 'fixture-code')
      redirect.searchParams.set('state', url.searchParams.get('state')!)
      response.writeHead(302, { location: redirect.href }).end()
      return
    }
    if (url.pathname === '/token') return json({ access_token: 'fixture-test-token', token_type: 'Bearer', expires_in: 3600 })
    let body = ''
    for await (const chunk of request) body += chunk
    if (url.pathname === '/register') {
      const registration = JSON.parse(body)
      return json({ ...registration, client_id: 'fixture-client', token_endpoint_auth_method: 'none' }, 201)
    }
    if (url.pathname === '/mcp') {
      if (request.headers.authorization !== 'Bearer fixture-test-token') {
        response.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"` }).end()
        return
      }
      if (request.method !== 'POST') { response.writeHead(405).end(); return }
      const rpc = JSON.parse(body)
      if (!('id' in rpc)) { response.writeHead(202).end(); return }
      const result = rpc.method === 'initialize' ? { protocolVersion: rpc.params.protocolVersion,
        capabilities: { tools: {} }, serverInfo: { name: 'superone-oauth-fixture', version: '1' } }
        : rpc.method === 'tools/list' ? { tools: [] } : {}
      return json({ jsonrpc: '2.0', id: rpc.id, result })
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { baseUrl, get authorized() { return authorized }, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }) }
}
