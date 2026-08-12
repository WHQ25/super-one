import type { McpServerConfig as CursorMcpServerConfig } from '@cursor/sdk'
import { toCursorMcpConfig } from '@superone/cursor'
import { listMcpConfigs } from '../mcp-config-service'
import { getSuperoneMcpStdioConfig } from '../mcp/superone-mcp-stdio-state'

export {
  toCursorMcpConfig,
  mcpServersToStatus,
  stripStdioCwd,
} from '@superone/cursor'

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
