import {
  boundedToolAppAttachment,
  mcpAppResourceUri,
  type McpAppsBinding,
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

  update(statuses: readonly ClaudeMcpStatusServer[]): void {
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

/**
 * MCP result from an SDK `tool_use_result` or `mcp_call` response. Claude
 * post-processes `content` into a string (the JSON of `structuredContent` when
 * present), so the server's own text blocks are not recoverable.
 */
export function claudeMcpToolResult(raw: unknown, isError: boolean): McpAppToolResult | undefined {
  const rec = record(raw)
  if (!rec || !('content' in rec)) return undefined
  const content = typeof rec.content === 'string'
    ? [{ type: 'text', text: rec.content }]
    : Array.isArray(rec.content) ? rec.content : []
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

  /** `tool_result` for a call seen by `toolUse`; `toolUseResult` is the SDK user message field. */
  toolResult(toolUseId: string, toolUseResult: unknown, isError: boolean): ToolAppAttachment | undefined {
    const call = this.calls.get(toolUseId)
    if (!call) return undefined
    this.calls.delete(toolUseId)
    const toolResult = claudeMcpToolResult(toolUseResult, isError)
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
