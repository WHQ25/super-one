import type { McpServer } from '@agentclientprotocol/sdk'
import type { McpServerConfig } from '@superone/shared/agent-types'
import { listMcpConfigs } from '../mcp-config-service'
import { getSuperoneMcpStdioConfig } from '../mcp/superone-mcp-stdio-state'
import type { AcpAgentCapabilities } from './acp-config'

export const SUPERONE_ACP_MCP_NAME = 'superone'

export function buildSuperoneAcpMcpServer(superoneSessionId: string): McpServer | null {
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
  const name = config.name?.trim()
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
}): McpServer[] {
  const servers: McpServer[] = []
  const reserved = new Set<string>()

  if (opts.superoneSessionId) {
    const superone = buildSuperoneAcpMcpServer(opts.superoneSessionId)
    if (superone) {
      servers.push(superone)
      reserved.add(SUPERONE_ACP_MCP_NAME)
    }
  }

  const caps = mcpTransportCapsFromAgent(opts.agentCapabilities)
  const list = opts.listConfigs ?? listMcpConfigs
  for (const cfg of list(opts.cwd)) {
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
