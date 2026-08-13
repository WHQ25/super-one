import type { McpServerConfig as CursorMcpServerConfig } from '@cursor/sdk'
import { toCursorMcpConfig } from '@superone/cursor'
import { listMcpConfigs } from '../mcp-config-service'
import { getSuperoneMcpHttpConfig } from '../mcp/superone-mcp-stdio-state'

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

  // HTTP, not stdio. The stdio bridge waits up to ~45s for host IPC before it
  // even answers initialize — Cursor SDK then sits on its 60s MCP connect
  // timeout and the first turn looks frozen. Codex already uses this HTTP
  // endpoint; the listener is up at app boot.
  const superone = getSuperoneMcpHttpConfig(superoneSessionId)
  if (superone) {
    servers[SUPERONE_MCP_NAME] = {
      type: 'http',
      url: superone.url,
      headers: superone.headers,
    }
  }

  return servers
}
