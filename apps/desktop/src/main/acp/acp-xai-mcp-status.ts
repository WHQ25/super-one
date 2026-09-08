/**
 * Grok MCP liveness notifications → SuperOne `McpServerInfo`.
 *
 * Wire: `x.ai/mcp/server_status`, `x.ai/mcp/init_progress`,
 * `x.ai/mcp/tools_changed`, `x.ai/mcp_initialized`, `x.ai/mcp/servers_updated`.
 */
import type { McpServerInfo, McpToolInfo } from '@superone/shared/agent-types'

export const XAI_MCP_SERVER_STATUS = 'x.ai/mcp/server_status'
export const XAI_MCP_INIT_PROGRESS = 'x.ai/mcp/init_progress'
export const XAI_MCP_TOOLS_CHANGED = 'x.ai/mcp/tools_changed'
export const XAI_MCP_INITIALIZED = 'x.ai/mcp_initialized'
export const XAI_MCP_SERVERS_UPDATED = 'x.ai/mcp/servers_updated'
export const XAI_MODELS_UPDATE = 'x.ai/models/update'
export const XAI_SESSION_USAGE = 'x.ai/session/usage'
export const XAI_UPDATE_MCP_SERVERS = 'x.ai/session/update_mcp_servers'

export const XAI_MCP_NOTIFICATION_METHODS = [
  XAI_MCP_SERVER_STATUS,
  `_${XAI_MCP_SERVER_STATUS}`,
  XAI_MCP_INIT_PROGRESS,
  `_${XAI_MCP_INIT_PROGRESS}`,
  XAI_MCP_TOOLS_CHANGED,
  `_${XAI_MCP_TOOLS_CHANGED}`,
  XAI_MCP_INITIALIZED,
  `_${XAI_MCP_INITIALIZED}`,
  XAI_MCP_SERVERS_UPDATED,
  `_${XAI_MCP_SERVERS_UPDATED}`,
  XAI_MODELS_UPDATE,
  `_${XAI_MODELS_UPDATE}`,
] as const

export interface GrokMcpInitProgress {
  connected: number
  total: number
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function str(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function num(o: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

function grokStatusToInfo(raw: string | undefined): McpServerInfo['status'] {
  const s = (raw ?? '').toLowerCase()
  if (s === 'ready' || s === 'connected') return 'connected'
  if (s === 'initializing' || s === 'pending' || s === 'connecting') return 'pending'
  if (s === 'needsauth' || s === 'needs_auth' || s === 'needs-auth') return 'needs-auth'
  if (s === 'disabled') return 'disabled'
  return 'failed'
}

function parseTools(raw: unknown): McpToolInfo[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: McpToolInfo[] = []
  for (const item of raw) {
    const o = asRecord(item)
    if (!o) continue
    const name = str(o, 'name')
    if (!name) continue
    out.push({
      name,
      ...(str(o, 'description', 'displayName', 'display_name')
        ? { description: str(o, 'description', 'displayName', 'display_name') }
        : {}),
    })
  }
  return out.length ? out : undefined
}

export function parseGrokMcpServerStatus(raw: unknown): McpServerInfo | null {
  const o = asRecord(raw)
  if (!o) return null
  const name = str(o, 'name', 'serverName', 'server_name')
  if (!name) return null
  const tools = parseTools(o.tools)
  const statusRaw = str(o, 'status')
  return {
    name,
    status: grokStatusToInfo(statusRaw),
    ...(str(o, 'detail', 'error', 'reason') ? { error: str(o, 'detail', 'error', 'reason') } : {}),
    ...(tools ? { tools, toolCount: tools.length } : {}),
    ...(statusRaw === 'needsAuth' || statusRaw === 'needs_auth' || statusRaw === 'needs-auth'
      ? { authStatus: 'needs-auth' as const }
      : {}),
  }
}

export function parseGrokMcpInitProgress(raw: unknown): GrokMcpInitProgress | null {
  const o = asRecord(raw)
  if (!o) return null
  const total = num(o, 'total')
  if (total == null) return null
  return {
    total: Math.max(0, Math.trunc(total)),
    connected: Math.max(0, Math.trunc(num(o, 'connected') ?? 0)),
  }
}

export function parseGrokMcpServersUpdated(raw: unknown): McpServerInfo[] | null {
  const o = asRecord(raw)
  if (!o) return null
  const list = o.mcpServers ?? o.mcp_servers ?? o.servers
  if (!Array.isArray(list)) return null
  const out: McpServerInfo[] = []
  for (const item of list) {
    const parsed = parseGrokMcpServerStatus(item)
    if (parsed) out.push(parsed)
    else {
      const rec = asRecord(item)
      const name = rec ? str(rec, 'name') : typeof item === 'string' ? item : undefined
      if (name) out.push({ name, status: 'pending' })
    }
  }
  return out
}

export function upsertMcpServer(servers: McpServerInfo[], next: McpServerInfo): McpServerInfo[] {
  const idx = servers.findIndex((s) => s.name === next.name)
  if (idx < 0) return [...servers, next]
  const copy = [...servers]
  copy[idx] = { ...copy[idx], ...next }
  return copy
}

export function parseGrokSessionUsage(raw: unknown): { totalTokens: number; inputTokens: number; outputTokens: number } | null {
  const o = asRecord(raw)
  if (!o) return null
  const usage = asRecord(o.usage) ?? o
  const input = num(usage, 'inputTokens', 'input_tokens') ?? 0
  const output = num(usage, 'outputTokens', 'output_tokens') ?? 0
  const cacheRead = num(usage, 'cacheReadTokens', 'cache_read_tokens', 'cachedInputTokens') ?? 0
  const total = input + output
  if (total <= 0 && cacheRead <= 0) return null
  return { totalTokens: total, inputTokens: input, outputTokens: output }
}
