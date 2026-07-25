import type { McpServerConfig as CursorMcpServerConfig } from '@cursor/sdk'
import type { McpServerConfig } from '@superone/shared/agent-types'
import { listMcpConfigs } from '../mcp-config-service'
import { getSuperoneMcpStdioConfig } from '../mcp/superone-mcp-stdio-state'

const SUPERONE_MCP_NAME = 'superone'

/** Map SuperOne MCP configs (+ SuperOne host MCP) to Cursor SDK mcpServers. */
export function buildCursorMcpServers(
  cwd: string,
  superoneSessionId: string,
): Record<string, CursorMcpServerConfig> {
  const servers: Record<string, CursorMcpServerConfig> = {}

  for (const config of listMcpConfigs(cwd)) {
    if (config.disabled) continue
    const mapped = toCursorMcpConfig(config)
    if (mapped) servers[config.name] = mapped
  }

  const superone = getSuperoneMcpStdioConfig(superoneSessionId)
  if (superone) {
    servers[SUPERONE_MCP_NAME] = {
      type: 'stdio',
      command: superone.command,
      args: superone.args,
      env: superone.env,
      cwd,
    }
  }

  return servers
}

export function toCursorMcpConfig(config: McpServerConfig): CursorMcpServerConfig | null {
  if (config.type === 'http' || config.type === 'sse') {
    if (!config.url) return null
    return {
      type: config.type,
      url: config.url,
      headers: config.headers,
    }
  }
  // default stdio
  if (!config.command) return null
  return {
    type: 'stdio',
    command: config.command,
    args: config.args,
    env: config.env,
  }
}

export function mcpServersToStatus(
  servers: Record<string, CursorMcpServerConfig>,
): Array<{ name: string; status: string }> {
  return Object.keys(servers).map((name) => ({ name, status: 'connected' }))
}

/** Cloud VMs have no host cwd; strip stdio cwd so remote MCP maps cleanly. */
export function stripStdioCwd(
  servers: Record<string, CursorMcpServerConfig>,
): Record<string, CursorMcpServerConfig> {
  const out: Record<string, CursorMcpServerConfig> = {}
  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg.type === 'http' || cfg.type === 'sse') {
      out[name] = cfg
      continue
    }
    const { cwd: _cwd, ...rest } = cfg as { cwd?: string } & CursorMcpServerConfig
    out[name] = rest as CursorMcpServerConfig
  }
  return out
}
