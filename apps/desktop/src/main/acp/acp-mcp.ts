import type { McpServer } from '@agentclientprotocol/sdk'
import type { McpServerConfig } from '@superone/shared/agent-types'
import { listMcpConfigs } from '../mcp-config-service'
import {
  getSuperoneMcpHttpConfig,
  getSuperoneMcpStdioConfig,
} from '../mcp/superone-mcp-stdio-state'
import type { AcpAgentCapabilities } from './acp-config'

export const SUPERONE_ACP_MCP_NAME = 'superone'

function bearerTokenMeta(file: string | undefined): { _meta: { 'x.ai/mcp/bearerTokenFile': string } } | Record<string, never> {
  const tokenFile = file?.trim()
  if (!tokenFile) return {}
  return { _meta: { 'x.ai/mcp/bearerTokenFile': tokenFile } }
}

export function buildSuperoneAcpMcpServer(
  superoneSessionId: string,
  caps: AcpMcpTransportCaps = { http: false, sse: false },
): McpServer | null {
  if (caps.http) {
    const config = getSuperoneMcpHttpConfig(superoneSessionId)
    if (config) {
      return {
        type: 'http',
        name: SUPERONE_ACP_MCP_NAME,
        url: config.url,
        headers: Object.entries(config.headers).map(([name, value]) => ({ name, value })),
      }
    }
  }

  const config = getSuperoneMcpStdioConfig(superoneSessionId)
  if (!config) return null
  return {
    name: SUPERONE_ACP_MCP_NAME,
    command: config.command,
    args: config.args,
    env: Object.entries(config.env).map(([name, value]) => ({ name, value })),
  }
}

/** Agent MCP transport support used when filtering user-configured servers. */
export interface AcpMcpTransportCaps {
  http: boolean
  sse: boolean
}

export function mcpTransportCapsFromAgent(
  caps: AcpAgentCapabilities | null | undefined,
): AcpMcpTransportCaps {
  return {
    http: caps?.mcp.http === true,
    sse: caps?.mcp.sse === true,
  }
}

/**
 * Map a SuperOne MCP config entry to an ACP session/new McpServer descriptor.
 * Returns null when disabled, incomplete, or transport unsupported by the agent.
 */
export function toAcpMcpServer(
  config: McpServerConfig,
  caps: AcpMcpTransportCaps,
): McpServer | null {
  if (config.disabled) return null
  const name = acpMcpName(config.name)
  if (!name) return null

  if (config.type === 'http') {
    if (!caps.http) return null
    const url = config.url?.trim()
    if (!url) return null
    return {
      type: 'http',
      name,
      url,
      headers: Object.entries(config.headers ?? {}).map(([n, value]) => ({ name: n, value })),
      ...bearerTokenMeta(config.bearerTokenFile),
    }
  }

  if (config.type === 'sse') {
    if (!caps.sse) return null
    const url = config.url?.trim()
    if (!url) return null
    return {
      type: 'sse',
      name,
      url,
      headers: Object.entries(config.headers ?? {}).map(([n, value]) => ({ name: n, value })),
      ...bearerTokenMeta(config.bearerTokenFile),
    }
  }

  // stdio (default) — always supported by ACP agents that accept mcpServers.
  const command = config.command?.trim()
  if (!command) return null
  return {
    name,
    command,
    args: Array.isArray(config.args) ? config.args.map(String) : [],
    env: Object.entries(config.env ?? {}).map(([n, value]) => ({ name: n, value: String(value) })),
  }
}

/**
 * Build the full mcpServers list for session/new: SuperOne first, then enabled user MCPs.
 * Skips user servers that collide with the SuperOne reserved name.
 */
export function buildAcpSessionMcpServers(opts: {
  cwd: string
  superoneSessionId?: string
  agentCapabilities?: AcpAgentCapabilities | null
  /** Inject for tests — defaults to listMcpConfigs(cwd). */
  listConfigs?: (cwd: string) => McpServerConfig[]
  /**
   * When false, omit `scope: 'project'` servers. Grok does not treat every
   * host project file as project-scoped, so the host must gate them itself.
   * Default true keeps non-Grok sessions unchanged.
   */
  includeProjectScope?: boolean
}): McpServer[] {
  const servers: McpServer[] = []
  const reserved = new Set<string>()
  const caps = mcpTransportCapsFromAgent(opts.agentCapabilities)

  if (opts.superoneSessionId) {
    const superone = buildSuperoneAcpMcpServer(opts.superoneSessionId, caps)
    if (superone) {
      servers.push(superone)
      reserved.add(SUPERONE_ACP_MCP_NAME)
    }
  }

  const list = opts.listConfigs ?? listMcpConfigs
  const includeProject = opts.includeProjectScope !== false
  for (const cfg of list(opts.cwd)) {
    if (!includeProject && cfg.scope === 'project') continue
    if (reserved.has(cfg.name)) continue
    const mapped = toAcpMcpServer(cfg, caps)
    if (!mapped) continue
    // Deduplicate by name (listMcpConfigs already prefers user then project, first wins).
    if (reserved.has(mapped.name)) continue
    servers.push(mapped)
    reserved.add(mapped.name)
  }

  return servers
}

/** Same identity `toAcpMcpServer` writes onto the ACP descriptor. */
function acpMcpName(name: string | undefined): string {
  return name?.trim() ?? ''
}

/** Names Grok would not treat as project-scoped, so the host must drop them itself. */
export function projectScopedMcpNames(
  cwd: string,
  listConfigs?: (cwd: string) => McpServerConfig[],
): Set<string> {
  const list = listConfigs ?? listMcpConfigs
  const names = new Set<string>()
  for (const cfg of list(cwd)) {
    if (cfg.scope !== 'project') continue
    const name = acpMcpName(cfg.name)
    if (name) names.add(name)
  }
  return names
}

/**
 * Drop project-scope servers from an already-built ACP list.
 * Used by every grok-build update, including reload and reconnect.
 */
export function omitUntrustedProjectMcpServers<T>(
  servers: T[],
  cwd: string,
  listConfigs?: (cwd: string) => McpServerConfig[],
): T[] {
  const blocked = projectScopedMcpNames(cwd, listConfigs)
  if (blocked.size === 0) return servers
  return servers.filter((server) => {
    const raw = server && typeof server === 'object' && 'name' in server
      ? (server as { name?: unknown }).name
      : undefined
    if (typeof raw !== 'string') return true
    const name = acpMcpName(raw)
    return !name || !blocked.has(name)
  })
}
