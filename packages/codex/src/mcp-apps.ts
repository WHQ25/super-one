import type { CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { assertMcpAppSize, MCP_APP_HTML_MAX_BYTES, MCP_APP_DATA_MAX_BYTES, MCP_APP_OUTPUT_MAX_BYTES, boundedToolAppAttachment, McpAppsError, type McpAppsBinding, type McpAppOrigin, type McpAppsProvider, type McpAppReadResult, type McpAppToolResult, type McpToolDescriptor, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { readCodexMcpWwwAuthenticate } from './protocol-v154'
import { codexMcpAppsCatalog, invalidateCodexMcpAppsCatalog } from './mcp-apps-catalog'

export type McpAppsRequest = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>
const challenges = (value: unknown): string[] | undefined => value === undefined ? undefined : Array.isArray(value) ? value.map(String) : [String(value)]
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Codex serializes absent optional result fields as null; the MCP result schema only allows them absent. */
function codexToolResult(result: { content?: unknown; structuredContent?: unknown; _meta?: unknown; isError?: unknown }): McpAppToolResult {
  return {
    content: Array.isArray(result.content) ? result.content : [],
    ...(record(result.structuredContent) ? { structuredContent: record(result.structuredContent) } : {}),
    ...(record(result._meta) ? { _meta: record(result._meta) } : {}),
    ...(typeof result.isError === 'boolean' ? { isError: result.isError } : {}),
  }
}

/** Keep the provider's routing metadata even when ordinary third-party appContext is null. */
export function readCodexMcpAppFields(raw: Record<string, unknown>, previous?: CodexMcpToolCallItem): Partial<CodexMcpToolCallItem> {
  const ui = record(raw.mcpAppUi) ?? (typeof raw.mcpAppResourceUri === 'string' ? { resourceUri: raw.mcpAppResourceUri } : undefined)
  return {
    ...(typeof ui?.resourceUri === 'string' ? { mcpAppUi: { resourceUri: ui.resourceUri, ...(typeof ui.preferredModelDisplayMode === 'string' ? { preferredModelDisplayMode: ui.preferredModelDisplayMode } : {}) } } : previous?.mcpAppUi ? { mcpAppUi: previous.mcpAppUi } : {}),
    ...('appContext' in raw ? { appContext: record(raw.appContext) ?? null } : previous && 'appContext' in previous ? { appContext: previous.appContext } : {}),
    ...(previous?.app ? { app: previous.app } : {}),
  }
}

/** Bind an authoritative native item id; never correlate by tool name or arguments. */
export function attachCodexMcpApp(item: CodexMcpToolCallItem, binding: McpAppsBinding, threadId: string): CodexMcpToolCallItem {
  const uri = item.mcpAppUi?.resourceUri
  if (!uri?.startsWith('ui://') || item.appContext || item.server === 'codex_apps') return item
  const status: ToolAppAttachment['status'] = item.status === 'in_progress' ? 'pending' : item.error || item.status === 'failed' ? 'error' : 'result'
  const app: ToolAppAttachment = {
    ...item.app,
    appInstanceId: item.app?.appInstanceId ?? `codex:${binding.session}:${threadId}:${item.id}`,
    binding, origin: { providerSessionId: threadId }, harnessCallId: item.id, resourceUri: uri, toolName: item.tool,
    ...(record(item.arguments) ? { toolInput: record(item.arguments) } : {}),
    ...(item.result ? { toolResult: codexToolResult({ content: item.result.content, structuredContent: item.result.structuredContent, _meta: item.result.meta, isError: item.result.isError }) } : {}),
    status,
    ...(item.authRequired ? { error: { code: 'auth_required' as const, message: 'MCP authentication required', challenge: challenges(readCodexMcpWwwAuthenticate(item.result?.meta)) } } : item.error ? { error: { code: 'invalid' as const, message: item.error.message } } : {}),
  }
  return { ...item, app: boundedToolAppAttachment(app) }
}

/** Start discovery when a live attachment arrives, alongside its eventual HTML read. */
export function prewarmCodexMcpAppCatalog(item: CodexMcpToolCallItem, request: McpAppsRequest, connectionKey: object = request): void {
  const app = item.app, threadId = app?.origin?.providerSessionId
  if (!app || !threadId) return
  const provider = createCodexMcpAppsProvider(app.binding, threadId, request, connectionKey)
  // The actual View request still awaits catalog admission and reports failures.
  void provider.tools().catch(() => {}).finally(() => provider.dispose())
}

/** Native public-server provider shared by Electron and the headless node. */
export function createCodexMcpAppsProvider(binding: McpAppsBinding, threadId: string, request: McpAppsRequest, connectionKey: object = request): McpAppsProvider {
  let disposed = false
  const guard = (signal?: AbortSignal, origin?: McpAppOrigin) => {
    if (disposed) throw new McpAppsError('not_connected', 'MCP App provider was disposed')
    if (signal?.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled before dispatch')
    if (!threadId || (origin && origin.providerSessionId !== threadId)) throw new McpAppsError('invalid', 'MCP App thread binding mismatch')
    if (binding.server === 'codex_apps') throw new McpAppsError('invalid', 'Hosted connectors are not supported by this provider')
  }
  const invoke = async (method: string, params: Record<string, unknown>, signal?: AbortSignal, origin?: McpAppOrigin, mutates = false, maxBytes = MCP_APP_DATA_MAX_BYTES) => {
    guard(signal, origin)
    try {
      // No retry: cancellation after dispatch cannot establish whether a tool ran.
      const result = await request(method, { ...params, threadId, server: binding.server })
      if (signal?.aborted) throw new McpAppsError(mutates ? 'unknown_outcome' : 'cancelled', 'MCP App request cancelled after dispatch')
      const challenge = challenges(readCodexMcpWwwAuthenticate(record(result._meta)))
      if (challenge !== undefined) throw new McpAppsError('auth_required', 'MCP authentication required', challenge)
      assertMcpAppSize(result, maxBytes)
      return result
    } catch (error) {
      if (error instanceof McpAppsError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new McpAppsError(mutates ? 'unknown_outcome' : /timed? ?out|timeout/i.test(message) ? 'timeout' : 'not_connected', message)
    }
  }
  const catalog = (detail: 'toolsAndAuthOnly' | 'full' = 'toolsAndAuthOnly', refresh = false) => codexMcpAppsCatalog(connectionKey, JSON.stringify([threadId, binding, detail]), async () => {
    guard()
    let cursor: unknown
    const output: Record<string, unknown>[] = []
    for (let page = 0; page < 100; page++) {
      const result = await invoke('mcpServerStatus/list', { detail, ...(cursor ? { cursor } : {}) })
      output.push(...(Array.isArray(result.data) ? result.data : []).map(record).filter((s): s is Record<string, unknown> => !!s))
      cursor = result.nextCursor
      if (!cursor) return output
    }
    throw new McpAppsError('invalid', 'MCP tool discovery exceeded pagination limit')
  }, refresh ? threadId : undefined)
  const tools: McpAppsProvider['tools'] = async (options) => {
    guard()
    const server = (await catalog('toolsAndAuthOnly', options?.refresh)).find(s => s.name === binding.server)
    const output = new Map<string, McpToolDescriptor>()
    if (server?.authStatus === 'notLoggedIn') {
      // Login completion is observed by tools() polling, so never retain a
      // pre-login snapshot while the harness finishes its OAuth callback.
      invalidateCodexMcpAppsCatalog(connectionKey)
      throw new McpAppsError('auth_required', 'MCP authentication required')
    }
    const entries = record(server?.tools)
    for (const [name, value] of Object.entries(entries ?? {})) {
      const tool = record(value)
      const info = record(server?.serverInfo)
      if (tool) output.set(name, { ...tool, name, serverInfo: {
        ...(typeof info?.title === 'string' ? { title: info.title } : {}),
        ...(Array.isArray(info?.icons) ? { icons: info.icons } : {}),
      } } as unknown as McpToolDescriptor)
    }
    return output
  }
  return {
    binding,
    // The owning backend established the initialized 0.159 connection and advertised the UI extension.
    async ready(signal) { guard(signal); return { mode: 'native', resourceRead: true, toolCall: true, authenticate: true } },
    tools,
    async readResource(req, signal): Promise<McpAppReadResult> {
      if (!req.uri.startsWith('ui://')) throw new McpAppsError('invalid', 'MCP App resources must use ui://')
      // originCallId is deliberately omitted for public third-party servers.
      guard(signal, req.origin)
      const result = await invoke('mcpServer/resource/read', { uri: req.uri }, signal, req.origin, false, req.transient ? MCP_APP_OUTPUT_MAX_BYTES : MCP_APP_HTML_MAX_BYTES + MCP_APP_DATA_MAX_BYTES)
      const rawContents = Array.isArray(result.contents) ? result.contents : []
      let listMeta: Record<string, unknown> | undefined
      if (rawContents.some(value => record(value)?.uri === req.uri && !record(record(record(value)?._meta)?.ui))) {
        // Read-content UI metadata is authoritative. Full discovery also lists
        // resources/templates from unrelated hosted connectors and can take
        // seconds; use it only for servers that put UI metadata on the list entry.
        const server = (await catalog('full')).find(entry => entry.name === binding.server)
        const resource = (Array.isArray(server?.resources) ? server.resources : []).map(record).find(entry => entry?.uri === req.uri)
        listMeta = record(resource?._meta)
      }
      const contents = rawContents.map(value => {
        const content = value as McpAppReadResult['contents'][number]
        const meta = record(content._meta)
        if (record(meta?.ui)) return content
        const ui = { ...record(listMeta?.ui), ...record(meta?.ui) }
        return { ...content, ...(listMeta || meta ? { _meta: { ...listMeta, ...meta, ui } } : {}) }
      })
      return { contents, ...(record(result._meta) ? { _meta: record(result._meta) } : {}) }
    },
    async callTool(req, signal) {
      assertMcpAppSize(req.args)
      const result = await invoke('mcpServer/tool/call', { tool: req.tool, arguments: req.args ?? {}, ...(req.meta ? { _meta: req.meta } : {}) }, signal, req.origin, true, MCP_APP_OUTPUT_MAX_BYTES)
      return { result: codexToolResult(result), outcome: 'completed' }
    },
    // Codex receives the redirect on its own listener and completes the login in the background;
    // the host watches `tools()` stop reporting auth_required.
    async authenticate(_req, signal) {
      invalidateCodexMcpAppsCatalog(connectionKey)
      const result = await invoke('mcpServer/oauth/login', { name: binding.server }, signal)
      return typeof result.authorizationUrl === 'string'
        ? { authUrl: result.authorizationUrl, completion: 'harness' as const }
        : { completion: 'done' as const }
    },
    dispose() { disposed = true },
  }
}
