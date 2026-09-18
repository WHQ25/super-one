import type { IncomingMessage, ServerResponse } from 'http'
import log from '../logger'

const METHODS = new Set(['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'ping'])

/** Only protocol metadata: never log headers, request bodies, or tool arguments. */
export function observeMcpHttpRequest(req: IncomingMessage, res: ServerResponse) {
  const startedAt = Date.now()
  const context: {
    sessionId?: string
    rpcMethod?: string
    reason?: string
  } = {}
  let logged = false
  const complete = (aborted: boolean) => {
    if (logged) return
    logged = true
    const failed = aborted || res.statusCode >= 400
    if (!failed && context.rpcMethod !== 'initialize' && context.rpcMethod !== 'tools/list') return
    const fields = JSON.stringify({
      ...context,
      method: ['POST', 'GET', 'DELETE'].includes(req.method ?? '') ? req.method : 'other',
      status: res.statusCode, aborted, elapsedMs: Date.now() - startedAt,
      hasAuthorization: Boolean(req.headers.authorization),
      hasSessionHeader: Boolean(req.headers['x-superone-session-id']),
      hasTransportId: Boolean(req.headers['mcp-session-id']),
    })
    if (failed) log.warn('[mcp-http] request %s', fields)
    else log.info('[mcp-http] request %s', fields)
  }
  res.once('finish', () => complete(false))
  res.once('close', () => complete(!res.writableFinished))
  return {
    // Only supply the session ID after authentication has succeeded.
    authenticated(sessionId: string) { context.sessionId = sessionId },
    parsed(body: unknown) {
      const method = body && typeof body === 'object' && 'method' in body ? body.method : undefined
      context.rpcMethod = typeof method === 'string' && METHODS.has(method) ? method : 'other'
    },
    rejected(reason: string) { context.reason = reason },
  }
}
