import type { Query } from '@anthropic-ai/claude-agent-sdk'
import {
  assertMcpAppSize,
  boundedToolAppAttachment,
  mcpAppResourceUri,
  McpAppsError,
  type McpAppOrigin,
  type McpAppReadResult,
  type McpAppsAuthStart,
  type McpAppsBinding,
  type McpAppsProvider,
  type McpAppToolResult,
  type McpToolDescriptor,
  type ToolAppAttachment,
} from '@superone/shared/mcp-apps'

/**
 * Makes Claude Code advertise the MCP Apps UI extension in MCP `initialize`.
 * The CLI reads it from its spawn env only; the same key in SDK
 * `settings.env` has no effect.
 */
export const CLAUDE_MCP_APPS_HOST_ENV = 'CLAUDE_CODE_MCP_APPS_HOST'

/**
 * Spawn env for every Claude query. SDK `Options.env` replaces the child env
 * instead of overlaying it, so an unset env starts from `process.env`.
 */
export function withMcpAppsHostEnv(
  env: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
  return { ...(env ?? process.env), [CLAUDE_MCP_APPS_HOST_ENV]: 'true' }
}

/** Tool entry of `Query.mcpServerStatus()`; `_meta` carries only the MCP Apps keys. */
export interface ClaudeMcpStatusTool {
  name: string
  description?: string
  annotations?: { readOnly?: boolean; destructive?: boolean; openWorld?: boolean }
  _meta?: Record<string, unknown>
}

export interface ClaudeMcpStatusServer {
  name: string
  status?: string
  config?: unknown
  tools?: ClaudeMcpStatusTool[]
}

/** How Claude Code spells a server inside `mcp__<server>__<tool>`. */
export function normalizeClaudeMcpServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** Claude reports hint annotations without the `Hint` suffix; restore the MCP names. */
export function toMcpToolDescriptor(tool: ClaudeMcpStatusTool): McpToolDescriptor {
  const a = tool.annotations
  const annotations = a && {
    ...(a.readOnly !== undefined ? { readOnlyHint: a.readOnly } : {}),
    ...(a.destructive !== undefined ? { destructiveHint: a.destructive } : {}),
    ...(a.openWorld !== undefined ? { openWorldHint: a.openWorld } : {}),
  }
  return {
    name: tool.name,
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    ...(annotations && Object.keys(annotations).length > 0 ? { annotations } : {}),
    ...(tool._meta ? { _meta: tool._meta as McpToolDescriptor['_meta'] } : {}),
  }
}

interface CatalogServer {
  config: unknown
  tools: Map<string, McpToolDescriptor>
}

/**
 * Server → tool UI metadata. `mcpServerStatus()` is the only place Claude
 * exposes tool `_meta`, so the backend refreshes this from it.
 */
export class ClaudeMcpAppsCatalog {
  private servers = new Map<string, CatalogServer>()
  private statuses = new Map<string, string>()
  private inflight: Promise<void> | null = null
  private refreshedAt = 0

  /**
   * Single-flight, and at most every `minIntervalMs` unless forced: a miss for
   * a server whose tools never load (still connecting, failed) must not
   * re-query per call. A failed load only leaves Views unattached; it never
   * rejects, because callers are tool rows and session start.
   */
  refresh(
    load: () => Promise<readonly ClaudeMcpStatusServer[] | undefined>,
    opts: { force?: boolean; minIntervalMs?: number; onError?: (error: unknown) => void } = {},
  ): Promise<void> {
    if (this.inflight) return this.inflight
    if (!opts.force && Date.now() - this.refreshedAt < (opts.minIntervalMs ?? 5_000)) return Promise.resolve()
    this.refreshedAt = Date.now()
    const run = async () => {
      try {
        const statuses = await load()
        if (statuses) this.update(statuses)
      } catch (error) {
        opts.onError?.(error)
      }
    }
    this.inflight = run().finally(() => { this.inflight = null })
    return this.inflight
  }

  update(statuses: readonly ClaudeMcpStatusServer[]): void {
    this.statuses = new Map(statuses.flatMap((s) => (s.status ? [[s.name, s.status] as const] : [])))
    this.servers = new Map(
      statuses
        .filter((s) => s.tools?.length)
        .map((s) => [s.name, { config: s.config, tools: new Map(s.tools!.map((t) => [t.name, toMcpToolDescriptor(t)])) }]),
    )
  }

  tools(server: string): Map<string, McpToolDescriptor> | undefined {
    return this.servers.get(server)?.tools
  }

  config(server: string): unknown {
    return this.servers.get(server)?.config
  }

  /** Connection status as `mcpServerStatus()` last reported it (`needs-auth`, `connected`, …). */
  status(server: string): string | undefined {
    return this.statuses.get(server)
  }

  /** Resolve `mcp__<server>__<tool>` to the raw server name; the longest server prefix wins. */
  resolve(qualifiedName: string): { server: string; tool: McpToolDescriptor } | undefined {
    let best: { server: string; tool: McpToolDescriptor; prefixLength: number } | undefined
    for (const [server, entry] of this.servers) {
      const prefix = `mcp__${normalizeClaudeMcpServerName(server)}__`
      if (!qualifiedName.startsWith(prefix) || (best && best.prefixLength >= prefix.length)) continue
      const tool = entry.tools.get(qualifiedName.slice(prefix.length))
      if (tool) best = { server, tool, prefixLength: prefix.length }
    }
    return best && { server: best.server, tool: best.tool }
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const contentBlocks = (content: unknown): unknown[] =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []

/**
 * MCP result from an SDK `tool_use_result` or `mcp_call` response. Claude
 * post-processes `content` into a string (the JSON of `structuredContent` when
 * present), so the server's own text blocks are not recoverable.
 *
 * Inside a subagent, `tool_use_result` carries only a size-capped `_meta`;
 * `blockContent` (the `tool_result` block the model saw) then stands in for
 * `content`, and `structuredContent` is unavailable.
 */
export function claudeMcpToolResult(raw: unknown, isError: boolean, blockContent?: unknown): McpAppToolResult | undefined {
  const rec = record(raw)
  if (!rec || (!('content' in rec) && blockContent === undefined)) return undefined
  const content = contentBlocks('content' in rec ? rec.content : blockContent)
  return {
    content,
    ...(rec.structuredContent !== undefined ? { structuredContent: rec.structuredContent } : {}),
    ...(record(rec._meta) ? { _meta: record(rec._meta) } : {}),
    ...(isError ? { isError: true } : {}),
  }
}

export interface ClaudeToolAppsOptions {
  catalog: ClaudeMcpAppsCatalog
  binding: (server: string) => McpAppsBinding
  /** Claude session id; absent until the CLI reports it. */
  providerSessionId: () => string | null | undefined
  /** Called when an MCP tool is not in the catalog yet, so the owner can refresh it. */
  onCatalogMiss?: () => void
}

/**
 * Builds the `ToolAppAttachment` for Claude tool calls whose tool declares a
 * `ui://` resource. The attachment is keyed by the `tool_use` id, never by
 * tool name or arguments.
 */
export class ClaudeToolApps {
  /** Every `mcp__` call until its result, so a catalog that lands late still resolves at result time. */
  private readonly calls = new Map<string, { toolName: string; input: Record<string, unknown> | undefined }>()

  constructor(private readonly opts: ClaudeToolAppsOptions) {}

  /** Complete `tool_use` block: the View can mount and receive `tool-input`. */
  toolUse(toolUseId: string, toolName: string, input: unknown): ToolAppAttachment | undefined {
    if (!toolName.startsWith('mcp__')) return undefined
    const call = { toolName, input: record(input) }
    this.calls.set(toolUseId, call)
    return this.attachment(toolUseId, call, { status: 'pending' })
  }

  /**
   * `tool_result` for a call seen by `toolUse`. `toolUseResult` is the SDK
   * user message field; `blockContent` is the `tool_result` block's content.
   */
  toolResult(toolUseId: string, toolUseResult: unknown, isError: boolean, blockContent?: unknown): ToolAppAttachment | undefined {
    const call = this.calls.get(toolUseId)
    if (!call) return undefined
    this.calls.delete(toolUseId)
    const toolResult = claudeMcpToolResult(toolUseResult, isError, blockContent)
    return this.attachment(toolUseId, call, {
      status: isError ? 'error' : 'result',
      ...(toolResult ? { toolResult } : {}),
    })
  }

  private attachment(
    toolUseId: string,
    call: { toolName: string; input: Record<string, unknown> | undefined },
    patch: Pick<ToolAppAttachment, 'status' | 'toolResult'>,
  ): ToolAppAttachment | undefined {
    const resolved = this.opts.catalog.resolve(call.toolName)
    if (!resolved) {
      this.opts.onCatalogMiss?.()
      return undefined
    }
    const resourceUri = mcpAppResourceUri(resolved.tool)
    if (!resourceUri) return undefined
    const binding = this.opts.binding(resolved.server)
    const providerSessionId = this.opts.providerSessionId()
    return boundedToolAppAttachment({
      appInstanceId: `claude:${binding.session}:${toolUseId}`,
      binding,
      ...(providerSessionId ? { origin: { providerSessionId } } : {}),
      harnessCallId: toolUseId,
      resourceUri,
      ...(call.input ? { toolInput: call.input } : {}),
      ...patch,
    })
  }
}

/**
 * SDK version whose internal `mcp_call` control request was verified against a
 * live CLI (result shape, `isError`, cancellation). A version test fails on an
 * SDK bump so the check is repeated before View tool calls ship on it.
 */
export const CLAUDE_MCP_CALL_VERIFIED_SDK = '0.3.285'

/** `Query.request` is internal; it is the only way to send `mcp_call`. */
type ControlRequest = (request: Record<string, unknown>, opts?: { signal?: AbortSignal }) => Promise<unknown>

function controlRequest(query: Query): ControlRequest | undefined {
  const request = (query as unknown as { request?: unknown }).request
  return typeof request === 'function' ? (request as ControlRequest).bind(query) : undefined
}

/**
 * MCP OAuth control methods exist on the runtime `Query` but not in its
 * public types. Without `redirectUri` the CLI receives the redirect on its own
 * localhost listener and reconnects; with one, the host must hand the callback
 * back and ask for a reconnect.
 */
interface ClaudeMcpAuthMethods {
  mcpAuthenticate(serverName: string, redirectUri?: string): Promise<{ authUrl?: string; redirectScheme?: string } | undefined>
  mcpSubmitOAuthCallbackUrl(serverName: string, callbackUrl: string): Promise<unknown>
}

function mcpAuthMethods(query: Query): ClaudeMcpAuthMethods | undefined {
  const q = query as unknown as Partial<ClaudeMcpAuthMethods>
  return typeof q.mcpAuthenticate === 'function' && typeof q.mcpSubmitOAuthCallbackUrl === 'function'
    ? (q as ClaudeMcpAuthMethods)
    : undefined
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new McpAppsError('cancelled', 'MCP App request cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export interface ClaudeMcpAppsProviderDeps {
  /** Live query of the bound session; revives an idle-released runtime. */
  query: () => Promise<Query | null>
  /** Current Claude session id; the View's origin must match it. */
  providerSessionId: () => string | null | undefined
  /** Fresh tool descriptors of the bound server. */
  tools: () => Promise<Map<string, McpToolDescriptor>>
  /** Server status from the catalog; may use a recent refresh. */
  serverStatus: () => Promise<string | undefined>
}

/**
 * Native provider over the Claude CLI's own MCP connection. It performs no
 * visibility or approval check: `mcp_call` runs any tool of the server, so
 * the host executor must gate every call before it reaches `callTool`.
 */
export function createClaudeMcpAppsProvider(binding: McpAppsBinding, deps: ClaudeMcpAppsProviderDeps): McpAppsProvider {
  let disposed = false

  const liveQuery = async (signal: AbortSignal, origin?: McpAppOrigin): Promise<Query> => {
    if (disposed) throw new McpAppsError('not_connected', 'MCP App provider was disposed')
    if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled before dispatch')
    const sessionId = deps.providerSessionId()
    if (origin && origin.providerSessionId !== sessionId) throw new McpAppsError('invalid', 'MCP App session binding mismatch')
    const query = await deps.query()
    if (!query) throw new McpAppsError('not_connected', 'Claude session is not running')
    return query
  }

  /**
   * Refused before dispatch, so the call is known not to have run. A server
   * that is not connected lists no tools; without this, the dispatch gate
   * would answer "not available to the App" instead of the real reason.
   */
  const assertConnected = async () => {
    const status = await deps.serverStatus()
    if (status === 'needs-auth') throw new McpAppsError('auth_required', 'MCP server requires sign-in')
    if (status !== 'connected') throw new McpAppsError('not_connected', `MCP server is ${status ?? 'unknown'}`)
  }

  return {
    binding,
    async ready(signal) {
      const query = await liveQuery(signal)
      return {
        mode: 'native',
        resourceRead: typeof query.readMcpResource === 'function',
        toolCall: controlRequest(query) !== undefined,
        authenticate: mcpAuthMethods(query) !== undefined,
      }
    },
    async tools() {
      const tools = await deps.tools()
      await assertConnected()
      return tools
    },
    async readResource(req, signal): Promise<McpAppReadResult> {
      if (!req.uri.startsWith('ui://')) throw new McpAppsError('invalid', 'MCP App resources must use ui://')
      const query = await liveQuery(signal, req.origin)
      await assertConnected()
      try {
        const result = await raceAbort(query.readMcpResource(binding.server, req.uri), signal)
        assertMcpAppSize(result)
        return { contents: result.contents }
      } catch (error) {
        if (error instanceof McpAppsError) throw error
        throw new McpAppsError('not_connected', errorMessage(error))
      }
    },
    async callTool(req, signal) {
      assertMcpAppSize(req.args)
      const query = await liveQuery(signal, req.origin)
      const request = controlRequest(query)
      if (!request) throw new McpAppsError('invalid', 'This Claude runtime cannot call MCP tools for a View')
      await assertConnected()
      const tool = `mcp__${normalizeClaudeMcpServerName(binding.server)}__${req.tool}`
      let response: unknown
      try {
        response = await request({ subtype: 'mcp_call', tool, arguments: req.args ?? {} }, { signal })
      } catch (error) {
        // Cancelling after dispatch cannot tell whether the tool ran.
        if (signal.aborted) throw new McpAppsError('unknown_outcome', 'MCP App tool call cancelled after dispatch')
        // A tool's own isError result and "could not run" reject identically,
        // so the View sees a failed result and the host treats it as uncertain.
        if ((error as { errorClass?: unknown }).errorClass === 'control_request_failed') {
          return { result: { content: [{ type: 'text', text: errorMessage(error) }], isError: true }, outcome: 'unknown_outcome' }
        }
        throw new McpAppsError('unknown_outcome', errorMessage(error))
      }
      const result = claudeMcpToolResult((response as { response?: unknown } | undefined)?.response, false)
      if (!result) throw new McpAppsError('unknown_outcome', 'Claude returned no MCP tool result')
      assertMcpAppSize(result)
      return { result, outcome: 'completed' }
    },
    async authenticate(req, signal): Promise<McpAppsAuthStart> {
      const auth = mcpAuthMethods(await liveQuery(signal))
      if (!auth) throw new McpAppsError('invalid', 'This Claude runtime cannot start MCP sign-in')
      try {
        const started = await raceAbort(auth.mcpAuthenticate(binding.server, req.redirectUri), signal)
        if (!started?.authUrl) return { completion: 'done' }
        // The CLI falls back to its own localhost listener when the server refuses the host's redirect.
        return { authUrl: started.authUrl, completion: started.redirectScheme === 'custom' ? 'host-callback' : 'harness' }
      } catch (error) {
        if (error instanceof McpAppsError) throw error
        throw new McpAppsError('not_connected', errorMessage(error))
      }
    },
    async submitAuthCallback(req, signal) {
      const query = await liveQuery(signal)
      const auth = mcpAuthMethods(query)
      if (!auth) throw new McpAppsError('invalid', 'This Claude runtime cannot finish MCP sign-in')
      try {
        await raceAbort(auth.mcpSubmitOAuthCallbackUrl(binding.server, req.callbackUrl), signal)
        // A submitted callback stores the token but leaves the server in needs-auth until reconnected.
        await raceAbort(query.reconnectMcpServer(binding.server), signal)
      } catch (error) {
        if (error instanceof McpAppsError) throw error
        throw new McpAppsError('not_connected', errorMessage(error))
      }
    },
    dispose() { disposed = true },
  }
}
