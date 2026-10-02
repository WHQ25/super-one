import { createHash } from 'node:crypto'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpAppsError, assertMcpAppSize, mcpAppResourceUri,
  MCP_APP_HTML_MAX_BYTES, MCP_APP_DATA_MAX_BYTES, MCP_APP_OUTPUT_MAX_BYTES,
  type McpAppToolResult, type McpToolDescriptor, type McpAppsProvider, type McpAppsBinding, type McpAppOrigin,
} from '@superone/shared/mcp-apps'
import { mcpAppPresentation } from '@superone/shared/mcp-apps-metadata'
import { mcpServerConfigFingerprint } from '@superone/runtime/mcp-apps/identity'
import type { McpServerConfig } from '@superone/shared/agent-types'
import type { MiniAppToolDefinition } from '@superone/shared/miniapp-types'
import type { MiniappToolReply } from '../mcp/miniapp-mcp-tools'
import { listMcpConfigs } from '../mcp-config-service'
import { ensureShellPath } from '../shell-path'
import log from '../logger'
import { HOST_CLIENT_DISCOVERY_TIMEOUT_MS, connectHostClient, hostClientConfig, readTools } from './host-client'
import { CompatRecords } from './compat-records'
import { getCompatSession, setCompatSession, type CompatSession } from './compat-registry'

const TOOLS_REFRESH_COOLDOWN_MS = 10_000
/** Non-App servers need only one probe per node/config, not one extra spawn per session. */
const discovery = new Map<string, { configKey: string; isApp: boolean }>()
const preparing = new Map<string, { key: string; session: LocalCompatSession; promise: Promise<CompatSession> }>()
const sessionConfigKey = (cwd: string, configs: McpServerConfig[]): string => createHash('sha256').update(JSON.stringify({ cwd, configs })).digest('hex')
const isModelVisible = (tool: McpToolDescriptor): boolean => tool._meta?.ui?.visibility?.includes('model') ?? true
const structuredSummary = (value: unknown): string => {
  const text = JSON.stringify(value)
  return text.length <= 24_000 ? text : `${text.slice(0, 24_000)}\n[Structured result summary truncated; full data is available in the View.]`
}

export function compatConfigFingerprint(cwd: string, config: McpServerConfig): string {
  return createHash('sha256').update(JSON.stringify({ cwd, type: config.type,
    server: mcpServerConfigFingerprint(config) })).digest('hex')
}

interface Connection {
  appId: string
  binding: McpAppsBinding
  client: Client
  tools: Map<string, McpToolDescriptor>
  toolsRefresh?: Promise<Map<string, McpToolDescriptor>>
  lastToolsRefresh: number
  connected: boolean
}

export class LocalCompatSession implements CompatSession {
  readonly omittedServers = new Set<string>()
  private readonly connections = new Map<string, Connection>()
  private readonly clients = new Set<Client>()
  private readonly records: CompatRecords
  private closed = false
  configKey = ''
  constructor(readonly sessionId: string, readonly cwd: string, private readonly discoveryTimeoutMs = HOST_CLIENT_DISCOVERY_TIMEOUT_MS) { this.records = new CompatRecords(sessionId) }

  async discover(configs: McpServerConfig[]): Promise<void> {
    this.configKey = sessionConfigKey(this.cwd, configs)
    if (this.closed) return
    await ensureShellPath()
    if (this.closed) return
    // Phase 1 is local stdio only. HTTP/SSE and auth stay on the native path.
    await Promise.all(configs.filter(c => !c.disabled && c.name !== 'superone' &&
      (c.type === 'stdio' || !c.type) && !!c.command).map(c => this.connect(c)))
  }

  private async connect(config: McpServerConfig): Promise<void> {
    if (this.closed) return
    const fingerprint = compatConfigFingerprint(this.cwd, config)
    const key = `local:${fingerprint}`
    // Validate environment/config changes without putting credentials in the durable binding.
    const configKey = sessionConfigKey(this.cwd, [config])
    const cached = discovery.get(key)
    if (cached?.configKey === configKey && !cached.isApp) return
    const stdio = hostClientConfig(config)
    if (stdio?.type !== 'stdio') return
    try {
      const { client, tools } = await connectHostClient('superone-mcp-apps-compat', stdio, this.cwd, this.discoveryTimeoutMs)
      this.clients.add(client)
      const isApp = [...tools.values()].some(tool => tool._meta?.ui !== undefined || !!mcpAppResourceUri(tool))
      discovery.set(key, { configKey, isApp })
      if (!isApp || this.closed) { await client.close(); this.clients.delete(client); return }
      const binding: McpAppsBinding = { node: 'local', session: this.sessionId, server: config.name,
        configGeneration: 0, configFingerprint: fingerprint }
      const appId = `mcp-app:${config.name}:${fingerprint.slice(0, 16)}`
      const connection: Connection = { appId, binding, client, connected: true, tools, lastToolsRefresh: -Infinity }
      client.onclose = () => { connection.connected = false }
      this.connections.set(appId, connection)
      this.omittedServers.add(config.name)
    } catch (error) {
      // A failed probe proves no extension coverage. Keep this session's native path.
      log.debug('[McpAppsCompat] discovery stayed native', { server: config.name,
        reason: error instanceof Error ? error.message : String(error) })
    }
  }

  catalog(): Array<{ appId: string; tools: MiniAppToolDefinition[] }> {
    if (this.closed) return []
    return [...this.connections.values()].map(connection => ({ appId: connection.appId,
      tools: [...connection.tools.values()].filter(isModelVisible).map(tool => ({
        name: tool.name, description: tool.description ?? tool.name, displayName: tool.title,
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} }, standalone: true,
      })) }))
  }

  private connection(appId: string): Connection {
    const connection = this.connections.get(appId)
    if (this.closed || !connection?.connected) throw new McpAppsError('not_connected', 'MCP Apps server is disconnected')
    return connection
  }

  private refreshTools(connection: Connection): Promise<Map<string, McpToolDescriptor>> {
    if (connection.toolsRefresh) return connection.toolsRefresh
    if (Date.now() - connection.lastToolsRefresh < TOOLS_REFRESH_COOLDOWN_MS) return Promise.resolve(connection.tools)
    connection.lastToolsRefresh = Date.now()
    const refresh = readTools(connection.client).then(tools => {
      this.connection(connection.appId)
      connection.tools = tools
      return tools
    }).finally(() => { if (connection.toolsRefresh === refresh) connection.toolsRefresh = undefined })
    connection.toolsRefresh = refresh
    return refresh
  }

  async call(appId: string, toolName: string, input: Record<string, unknown>): Promise<MiniappToolReply> {
    const connection = this.connection(appId)
    const tool = connection.tools.get(toolName)
    if (!tool || !isModelVisible(tool)) throw new McpAppsError('denied', 'This tool is not available to the model')
    assertMcpAppSize(input)
    // The miniapp_call executor has already made its permission decision. No automatic retries.
    let result: McpAppToolResult
    try { result = await connection.client.callTool({ name: toolName, arguments: input }) as McpAppToolResult }
    catch (error) {
      throw new McpAppsError('unknown_outcome', `MCP App call was dispatched; do not retry: ${error instanceof Error ? error.message : String(error)}`)
    }
    assertMcpAppSize(result, MCP_APP_OUTPUT_MAX_BYTES)
    const resourceUri = mcpAppResourceUri(tool)
    const record = resourceUri ? this.records.record({
      binding: connection.binding, origin: { providerSessionId: this.sessionId },
      resourceUri, toolName, presentation: mcpAppPresentation(tool), toolInput: input, toolResult: result,
      status: result.isError ? 'error' : 'result',
    }) : undefined
    return {
      content: [
        ...(record ? [{ type: 'text' as const, text: record.marker }] : []),
        ...result.content as MiniappToolReply['content'],
        // Cursor keeps only content. Preserve structured output in a model-visible text block too.
        ...(result.structuredContent !== undefined ? [{ type: 'text' as const, text: structuredSummary(result.structuredContent) }] : []),
      ],
      ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent as Record<string, unknown> } : {}),
      ...(result.isError ? { isError: true } : {}),
    }
  }

  attach(event: Parameters<CompatSession['attach']>[0]): ReturnType<CompatSession['attach']> { return this.records.attach(event) }

  provider(binding: McpAppsBinding, origin: McpAppOrigin): McpAppsProvider {
    const connection = [...this.connections.values()].find(c => c.binding.server === binding.server)
    if (!connection || binding.node !== 'local' || binding.session !== this.sessionId ||
      binding.configFingerprint !== connection.binding.configFingerprint || binding.account !== connection.binding.account ||
      binding.configGeneration !== connection.binding.configGeneration || origin.providerSessionId !== this.sessionId) {
      throw new McpAppsError('invalid', 'MCP Apps compatibility binding mismatch')
    }
    const check = (signal?: AbortSignal): void => {
      if (signal?.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      this.connection(connection.appId)
    }
    return {
      binding,
      ready: async signal => { check(signal); return { mode: 'gateway', resourceRead: true, toolCall: true, authenticate: false } },
      tools: async options => { check(); return options?.refresh ? this.refreshTools(connection) : connection.tools },
      readResource: async (req, signal) => {
        check(signal)
        const result = await connection.client.readResource({ uri: req.uri }, { signal })
        assertMcpAppSize(result, req.transient ? MCP_APP_OUTPUT_MAX_BYTES : MCP_APP_HTML_MAX_BYTES + MCP_APP_DATA_MAX_BYTES)
        return result
      },
      callTool: async (req, signal) => {
        check(signal)
        assertMcpAppSize(req.args)
        let result: McpAppToolResult
        try {
          result = await connection.client.callTool({ name: req.tool, arguments: req.args as Record<string, unknown>, ...(req.meta ? { _meta: req.meta } : {}) }, undefined, { signal }) as McpAppToolResult
        } catch (error) {
          throw new McpAppsError('unknown_outcome', `MCP App call was dispatched; do not retry: ${error instanceof Error ? error.message : String(error)}`)
        }
        assertMcpAppSize(result, MCP_APP_OUTPUT_MAX_BYTES)
        return { result, outcome: 'completed' }
      },
      // Provider RPC disposes its handle after each request, not the shared session client.
      dispose: () => undefined,
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.records.clear()
    await Promise.all([...this.clients].map(client => client.close().catch(() => undefined)))
    this.clients.clear()
    this.connections.clear()
    this.omittedServers.clear()
  }
}

/** Single flight for prewarm/start. The first turn waits for bounded discovery. */
export function prepareCompatSession(sessionId: string, cwd: string): Promise<CompatSession> {
  const configs = listMcpConfigs(cwd)
  const key = sessionConfigKey(cwd, configs)
  const pending = preparing.get(sessionId)
  const existing = getCompatSession(sessionId)
  if (pending?.key === key && existing === pending.session) return pending.promise
  if (existing instanceof LocalCompatSession && existing.configKey === key) return Promise.resolve(existing)
  const session = new LocalCompatSession(sessionId, cwd)
  setCompatSession(sessionId, session)
  const promise = (async () => {
    await existing?.close()
    await session.discover(configs)
    if (getCompatSession(sessionId) !== session) throw new McpAppsError('cancelled', 'MCP Apps discovery was superseded')
    return session
  })().finally(() => { if (preparing.get(sessionId)?.session === session) preparing.delete(sessionId) })
  preparing.set(sessionId, { key, session, promise })
  return promise
}
