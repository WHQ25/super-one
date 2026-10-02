import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { FetchLike, Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { McpAppsError, MCP_APPS_EXTENSION, assertMcpAppSize,
  MCP_APP_HTML_MAX_BYTES, MCP_APP_DATA_MAX_BYTES, MCP_APP_OUTPUT_MAX_BYTES,
  type McpAppOrigin, type McpAppsBinding, type McpAppsProvider, type McpAppToolResult, type McpToolDescriptor,
} from '@superone/shared/mcp-apps'
import { buildSafeEnv } from '../spawn-env'
import { ensureShellPath } from '../shell-path'

/**
 * SuperOne's own MCP client: what a harness's connection does not expose (full
 * tool `_meta`, request `_meta`) reached by connecting to the server directly.
 */

export const HOST_CLIENT_DISCOVERY_TIMEOUT_MS = 10_000
const TOOLS_REFRESH_COOLDOWN_MS = 10_000
const IDLE_CLOSE_MS = 5 * 60_000
/** Renew a little before expiry so a request never leaves with a dead token. */
const TOKEN_RENEW_MARGIN_MS = 60_000

/** tools/list _meta is an open JSON bag; malformed visibility must grant neither surface. */
export function normalizeTool(tool: McpToolDescriptor): McpToolDescriptor {
  const ui = tool._meta?.ui
  if (ui === undefined) return tool
  if (ui && typeof ui === 'object' && !Array.isArray(ui) &&
    (ui.visibility === undefined || (Array.isArray(ui.visibility) && ui.visibility.every(value => value === 'model' || value === 'app')))) return tool
  return { ...tool, _meta: { ...tool._meta, ui: { ...(ui && typeof ui === 'object' ? ui : {}), visibility: [] } } }
}

export async function readTools(client: Client, timeoutMs = HOST_CLIENT_DISCOVERY_TIMEOUT_MS): Promise<Map<string, McpToolDescriptor>> {
  const tools = new Map<string, McpToolDescriptor>()
  const serverInfo = client.getServerVersion()
  const deadline = Date.now() + timeoutMs
  let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
    const timeout = deadline - Date.now()
    if (timeout <= 0) throw new McpAppsError('timeout', 'MCP Apps tool discovery timed out')
    const result = await client.listTools(cursor ? { cursor } : undefined, { timeout })
    for (const tool of result.tools as McpToolDescriptor[]) tools.set(tool.name, { ...normalizeTool(tool), serverInfo })
    cursor = result.nextCursor
    if (!cursor) return tools
  }
  throw new McpAppsError('invalid', 'MCP tool discovery exceeded pagination limit')
}

/** A server config SuperOne can reach itself; anything else (SDK, hosted proxies) stays with the harness. */
export type HostClientConfig =
  | { type: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { type: 'http' | 'sse'; url: string; headers: Record<string, string> }

const strings = (value: unknown): Record<string, string> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {}

export function hostClientConfig(config: unknown): HostClientConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  const value = config as Record<string, unknown>
  if ((value.type === undefined || value.type === 'stdio') && typeof value.command === 'string' && value.command) {
    const args = Array.isArray(value.args) && value.args.every(arg => typeof arg === 'string') ? value.args as string[] : []
    return { type: 'stdio', command: value.command, args, env: strings(value.env) }
  }
  if ((value.type === 'http' || value.type === 'sse') && typeof value.url === 'string' && URL.canParse(value.url)) {
    const protocol = new URL(value.url).protocol
    if (protocol === 'https:' || protocol === 'http:') return { type: value.type, url: value.url, headers: strings(value.headers) }
  }
  return null
}

export function stdioTransport(config: Extract<HostClientConfig, { type: 'stdio' }>, cwd: string): StdioClientTransport {
  return new StdioClientTransport({ command: config.command, args: config.args, cwd,
    env: buildSafeEnv(config.env) as Record<string, string>, stderr: 'ignore' })
}

function transport(config: HostClientConfig, cwd: string, fetch?: FetchLike): Transport {
  if (config.type === 'stdio') return stdioTransport(config, cwd)
  const options = { requestInit: { headers: config.headers }, ...(fetch ? { fetch } : {}) }
  return config.type === 'http' ? new StreamableHTTPClientTransport(new URL(config.url), options) : new SSEClientTransport(new URL(config.url), options)
}

/** An HTTP 401/403 reads as sign-in, not as a broken server. */
function connectError(error: unknown): McpAppsError {
  if (error instanceof McpAppsError) return error
  const code = (error as { code?: unknown })?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === 401 || code === 403 || /\b(401|403)\b/.test(message)) return new McpAppsError('auth_required', 'MCP server requires sign-in')
  return new McpAppsError('not_connected', message)
}

/** An OAuth access token a harness holds for a server. */
export interface HostClientToken { accessToken: string; expiresAt?: number }

/** Where an HTTP server's token comes from when its config carries no `Authorization` header. */
export interface HostClientTokenSource {
  read(config: Extract<HostClientConfig, { type: 'http' | 'sse' }>): HostClientToken | null
  /** Ask the harness to renew its token; `read` returns the renewed one afterwards. */
  renew(): Promise<void>
}

const hasAuthorization = (headers: Record<string, string>): boolean => Object.keys(headers).some(name => name.toLowerCase() === 'authorization')

/**
 * Adds the harness's bearer token to requests for the server's own origin;
 * nothing else ever sees it. An expiring token, or a 401, asks the harness to
 * renew it once; no token at all is a sign-in.
 */
export function bearerFetch(config: Extract<HostClientConfig, { type: 'http' | 'sse' }>, source: HostClientTokenSource): FetchLike {
  const origin = new URL(config.url).origin
  let current: HostClientToken | null = null
  const usable = (token: HostClientToken | null) => token && (token.expiresAt === undefined || token.expiresAt - Date.now() > TOKEN_RENEW_MARGIN_MS) ? token : null
  const resolve = async (renew: boolean): Promise<HostClientToken> => {
    const stored = source.read(config)
    if (!stored) throw new McpAppsError('auth_required', 'MCP server requires sign-in')
    if (!renew && usable(stored)) return stored
    await source.renew()
    const renewed = usable(source.read(config))
    if (!renewed) throw new McpAppsError('auth_required', 'MCP server requires sign-in')
    return renewed
  }
  return async (url, init) => {
    if (new URL(url).origin !== origin) return fetch(url, init)
    current = usable(current) ?? await resolve(false)
    const send = (token: HostClientToken) => {
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${token.accessToken}`)
      return fetch(url, { ...init, headers })
    }
    const response = await send(current)
    if (response.status !== 401) return response
    current = await resolve(true)
    return send(current)
  }
}

/** Connected client with its first tools/list, or a typed failure; nothing is left running on failure. */
export async function connectHostClient(name: string, config: HostClientConfig, cwd: string, timeoutMs = HOST_CLIENT_DISCOVERY_TIMEOUT_MS, token?: HostClientTokenSource): Promise<{ client: Client; tools: Map<string, McpToolDescriptor> }> {
  if (config.type === 'stdio') await ensureShellPath()
  const client = new Client({ name, version: '1.0.0' }, { capabilities: { extensions: MCP_APPS_EXTENSION } })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const tools = await Promise.race([
      (async () => {
        const fetch = config.type !== 'stdio' && token && !hasAuthorization(config.headers) ? bearerFetch(config, token) : undefined
        await client.connect(transport(config, cwd, fetch))
        return readTools(client, timeoutMs)
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new McpAppsError('timeout', 'MCP server did not answer in time')), timeoutMs)
      }),
    ])
    return { client, tools }
  } catch (error) {
    await client.close().catch(() => undefined)
    throw connectError(error)
  } finally { if (timer) clearTimeout(timer) }
}

interface Connection {
  key: string
  client: Client
  tools: Map<string, McpToolDescriptor>
  toolsRefresh?: Promise<Map<string, McpToolDescriptor>>
  lastToolsRefresh: number
  connected: boolean
  idle?: ReturnType<typeof setTimeout>
}

export interface HostClientProviderDeps {
  /** The server's current config as the harness reports it. */
  config: () => unknown
  cwd: () => string | undefined
  /** Whose credentials the connection carries (account, credential domain); a change reconnects. */
  credentialScope?: () => string
  /** Current provider session; a request's origin must match it. */
  providerSessionId: () => string | null | undefined
  /** Recheck account/configuration identity before every dispatch. */
  assertBinding: () => void
  /** Token for an HTTP server whose config carries no `Authorization` header. */
  token?: HostClientTokenSource
  /** The harness's own sign-in for this server; the next connect picks up its result. */
  authenticate?: McpAppsProvider['authenticate']
  submitAuthCallback?: McpAppsProvider['submitAuthCallback']
}

/**
 * One direct connection per server for a harness session, opened on first use
 * and closed after idling. A changed config (or cwd) replaces the connection.
 */
export class HostClients {
  private readonly connections = new Map<string, Connection>()
  private readonly connecting = new Map<string, { key: string; promise: Promise<Connection> }>()
  private closed = false

  constructor(private readonly clientName: string, private readonly idleCloseMs = IDLE_CLOSE_MS) {}

  private async connection(server: string, deps: HostClientProviderDeps): Promise<Connection> {
    if (this.closed) throw new McpAppsError('not_connected', 'MCP server connection closed')
    const config = hostClientConfig(deps.config())
    const cwd = deps.cwd()
    if (!config || !cwd) throw new McpAppsError('not_connected', 'This MCP server cannot be reached directly')
    // The key covers env, headers and whose token: a changed credential must reconnect, never reuse.
    const key = createHash('sha256').update(JSON.stringify({ cwd, config, credentials: deps.credentialScope?.() })).digest('hex')
    const current = this.connections.get(server)
    if (current?.key === key && current.connected) return this.touch(server, current)
    if (current) this.drop(server, current)
    const pending = this.connecting.get(server)
    if (pending?.key === key) return pending.promise
    const promise = connectHostClient(this.clientName, config, cwd, HOST_CLIENT_DISCOVERY_TIMEOUT_MS, deps.token).then(({ client, tools }) => {
      const connection: Connection = { key, client, tools, lastToolsRefresh: Date.now(), connected: true }
      if (this.closed || this.connecting.get(server)?.promise !== promise) {
        void client.close().catch(() => undefined)
        throw new McpAppsError('cancelled', 'MCP server connection was superseded')
      }
      client.onclose = () => { connection.connected = false }
      this.connections.set(server, connection)
      return this.touch(server, connection)
    }).finally(() => { if (this.connecting.get(server)?.promise === promise) this.connecting.delete(server) })
    this.connecting.set(server, { key, promise })
    return promise
  }

  private touch(server: string, connection: Connection): Connection {
    if (connection.idle) clearTimeout(connection.idle)
    connection.idle = setTimeout(() => this.drop(server, connection), this.idleCloseMs)
    connection.idle.unref?.()
    return connection
  }

  private drop(server: string, connection: Connection): void {
    if (connection.idle) clearTimeout(connection.idle)
    connection.connected = false
    if (this.connections.get(server) === connection) this.connections.delete(server)
    void connection.client.close().catch(() => undefined)
  }

  private refreshTools(connection: Connection): Promise<Map<string, McpToolDescriptor>> {
    if (connection.toolsRefresh) return connection.toolsRefresh
    if (Date.now() - connection.lastToolsRefresh < TOOLS_REFRESH_COOLDOWN_MS) return Promise.resolve(connection.tools)
    connection.lastToolsRefresh = Date.now()
    const refresh = readTools(connection.client).then(tools => {
      connection.tools = tools
      return tools
    }).finally(() => { if (connection.toolsRefresh === refresh) connection.toolsRefresh = undefined })
    connection.toolsRefresh = refresh
    return refresh
  }

  provider(binding: McpAppsBinding, deps: HostClientProviderDeps): McpAppsProvider {
    let disposed = false
    const live = async (signal?: AbortSignal, origin?: McpAppOrigin): Promise<Connection> => {
      if (disposed) throw new McpAppsError('not_connected', 'MCP App provider was disposed')
      if (signal?.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled before dispatch')
      if (origin && origin.providerSessionId !== deps.providerSessionId()) throw new McpAppsError('invalid', 'MCP App session binding mismatch')
      deps.assertBinding()
      const connection = await this.connection(binding.server, deps)
      deps.assertBinding()
      return connection
    }
    /** After the harness signs in, connect afresh so the new credentials are used. */
    const reconnectAfter = <T>(work: Promise<T>): Promise<T> => work.then((value) => {
      const current = this.connections.get(binding.server)
      if (current) this.drop(binding.server, current)
      return value
    })
    return {
      binding,
      ready: async signal => {
        await live(signal)
        return { mode: 'gateway', resourceRead: true, toolCall: true, authenticate: !!deps.authenticate }
      },
      tools: async options => {
        const connection = await live()
        return options?.refresh ? this.refreshTools(connection) : connection.tools
      },
      readResource: async (req, signal) => {
        // A View may read any resource of its own server; only a View document must be `ui://`.
        if (!req.uri.startsWith('ui://') && !req.transient) throw new McpAppsError('invalid', 'MCP App resources must use ui://')
        const connection = await live(signal, req.origin)
        const result = await connection.client.readResource({ uri: req.uri }, { signal })
        assertMcpAppSize(result, req.transient ? MCP_APP_OUTPUT_MAX_BYTES : MCP_APP_HTML_MAX_BYTES + MCP_APP_DATA_MAX_BYTES)
        return result
      },
      callTool: async (req, signal) => {
        assertMcpAppSize(req.args)
        const connection = await live(signal, req.origin)
        let result: McpAppToolResult
        try {
          result = await connection.client.callTool({ name: req.tool, arguments: req.args as Record<string, unknown>, ...(req.meta ? { _meta: req.meta } : {}) }, undefined, { signal }) as McpAppToolResult
        } catch (error) {
          throw new McpAppsError('unknown_outcome', `MCP App call was dispatched; do not retry: ${error instanceof Error ? error.message : String(error)}`)
        }
        assertMcpAppSize(result, MCP_APP_OUTPUT_MAX_BYTES)
        return { result, outcome: 'completed' }
      },
      ...(deps.authenticate ? { authenticate: (req, signal) => reconnectAfter(deps.authenticate!(req, signal)) } : {}),
      ...(deps.submitAuthCallback ? { submitAuthCallback: (req, signal) => reconnectAfter(deps.submitAuthCallback!(req, signal)) } : {}),
      dispose: () => { disposed = true },
    }
  }

  close(): void {
    this.closed = true
    for (const [server, connection] of this.connections) this.drop(server, connection)
    this.connecting.clear()
  }
}
