import type { McpServer } from '@agentclientprotocol/sdk'
import { getSuperoneMcpStdioConfig } from '../mcp/superone-mcp-stdio-state'

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
