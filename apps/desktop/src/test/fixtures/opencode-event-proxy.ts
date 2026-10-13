import { createServer, type ServerResponse } from 'node:http'

/** Drops only observation; upstream commands and durable storage keep running. */
export async function startOpenCodeEventProxy(baseUrl: string) {
  const streams = new Set<ServerResponse>()
  const requests: Array<{ path: string; method: string }> = []
  let blocked = false
  const server = createServer(async (request, response) => {
    const path = request.url!, method = request.method!
    requests.push({ path, method })
    if (path === '/api/event' && blocked) { response.writeHead(503); response.end('{}'); return }
    const signal = new AbortController()
    response.on('close', () => signal.abort())
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const headers = new Headers()
      for (const key of ['authorization', 'content-type', 'accept']) {
        const value = request.headers[key]
        if (typeof value === 'string') headers.set(key, value)
      }
      const upstream = await fetch(`${baseUrl}${path}`, { method, headers, signal: signal.signal, ...(body.length ? { body } : {}) })
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
      if (path === '/api/event') { streams.add(response); response.flushHeaders() }
      if (upstream.body) for await (const chunk of upstream.body) response.write(chunk)
      response.end()
    } catch { if (!response.destroyed) response.destroy() }
    finally { streams.delete(response) }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as { port: number }).port
  return { baseUrl: `http://127.0.0.1:${port}`, requests,
    disconnect() { blocked = true; for (const response of streams) response.destroy() },
    allowReconnect() { blocked = false },
    async close() { for (const response of streams) response.destroy(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) },
  }
}
