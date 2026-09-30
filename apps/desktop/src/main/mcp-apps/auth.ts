import { createServer } from 'node:http'
import type { McpAppsProviderRpcRequest, McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'
import type { McpAppsAuthStart } from '@superone/shared/mcp-apps'

type ProviderOperation = Omit<McpAppsProviderRpcRequest, 'binding' | 'origin'>

export interface McpAppsAuthDeps {
  /** One provider operation, already bound to the View's binding and origin. */
  request: (op: ProviderOperation) => Promise<McpAppsRpcResult>
  openUrl: (url: string) => Promise<void>
  /**
   * The harness runs on another machine, so its own localhost listener is
   * unreachable from the user's browser: listen here and hand the redirect back.
   */
  hostCallback: boolean
  timeoutMs?: number
  pollMs?: number
}

const CALLBACK_PATH = '/mcp-oauth-callback'
const DONE_PAGE = '<!doctype html><meta charset="utf-8"><title>SuperOne</title><p>Sign-in finished. You can return to SuperOne.</p>'

interface LoopbackCallback {
  redirectUri: string
  callbackUrl: Promise<string>
  close(): void
}

/** RFC 8252 loopback redirect: any port on 127.0.0.1, one request, then closed. */
async function startLoopbackCallback(): Promise<LoopbackCallback> {
  let resolve!: (url: string) => void
  const callbackUrl = new Promise<string>((r) => { resolve = r })
  const server = createServer((req, res) => {
    if (!req.url?.startsWith(CALLBACK_PATH)) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE)
    resolve(`${redirectUri}${req.url.slice(CALLBACK_PATH.length)}`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}${CALLBACK_PATH}`
  return { redirectUri, callbackUrl, close: () => server.close() }
}

function failure(code: 'invalid' | 'timeout' | 'cancelled', message: string): McpAppsRpcResult<null> {
  return { ok: false, error: { code, message } }
}

function untilAbortOrTimeout<T>(promise: Promise<T>, signal: AbortSignal, deadline: number): Promise<T | 'timeout' | 'cancelled'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()))
    const onAbort = () => resolve('cancelled')
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, () => resolve('cancelled')).finally(() => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    })
  })
}

/**
 * Signs the View's MCP server in through its harness, then waits until the
 * provider stops reporting `auth_required`. Tokens stay with the harness; the
 * host only opens the authorization page and, for remote harnesses, relays
 * the redirect.
 */
export async function authenticateMcpApp(deps: McpAppsAuthDeps, signal: AbortSignal): Promise<McpAppsRpcResult<null>> {
  const deadline = Date.now() + (deps.timeoutMs ?? 5 * 60_000)
  const listener = deps.hostCallback ? await startLoopbackCallback() : undefined
  try {
    const started = await deps.request({ operation: 'authenticate', ...(listener ? { redirectUri: listener.redirectUri } : {}) })
    if (!started.ok) return started
    const { authUrl, completion } = started.value as McpAppsAuthStart
    if (authUrl) {
      const protocol = URL.canParse(authUrl) ? new URL(authUrl).protocol : ''
      if (protocol !== 'https:' && protocol !== 'http:') return failure('invalid', 'The MCP server returned an unsupported sign-in URL')
      await deps.openUrl(authUrl)
    }
    if (completion === 'host-callback') {
      if (!listener) return failure('invalid', 'The harness expects a host callback that was not requested')
      const callbackUrl = await untilAbortOrTimeout(listener.callbackUrl, signal, deadline)
      if (callbackUrl === 'timeout') return failure('timeout', 'Timed out waiting for sign-in')
      if (callbackUrl === 'cancelled') return failure('cancelled', 'Sign-in cancelled')
      const submitted = await deps.request({ operation: 'submitAuthCallback', callbackUrl })
      if (!submitted.ok) return submitted
    }
    listener?.close()
    while (Date.now() < deadline) {
      if (signal.aborted) return failure('cancelled', 'Sign-in cancelled')
      const tools = await deps.request({ operation: 'tools' })
      if (tools.ok) return { ok: true, value: null }
      if (tools.error.code !== 'auth_required') return tools
      await new Promise((r) => setTimeout(r, deps.pollMs ?? 1_500))
    }
    return failure('timeout', 'Timed out waiting for sign-in')
  } finally {
    listener?.close()
  }
}
