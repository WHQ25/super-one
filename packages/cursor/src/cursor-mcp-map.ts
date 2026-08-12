import type { McpServerConfig as CursorMcpServerConfig } from '@cursor/sdk'
import type { McpServerConfig } from '@superone/shared/agent-types'

/** Map a SuperOne MCP server config to Cursor SDK mcpServers entry. */
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

/** Convert Cursor mcpServers map into a simple connected-status list. */
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
