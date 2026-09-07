import type { RelayClient } from '@superone/relay-client'
import type { McpServerInfo, RemoteCommand } from '@superone/shared/agent-types'
import { randomId } from './ids'

export type McpServerRow = {
  name: string
  status: McpServerInfo['status']
  /** One line under the name: the tool count when it is up, the reason when it is not. */
  detail: string
  /** Which of the three status tones to paint. */
  tone: 'ok' | 'warn' | 'bad' | 'off'
}

const TONES: Record<McpServerInfo['status'], McpServerRow['tone']> = {
  connected: 'ok',
  pending: 'warn',
  'needs-auth': 'warn',
  failed: 'bad',
  disabled: 'off',
}

/**
 * What a server's row says, in the desktop popup's vocabulary.
 *
 * A count is the useful fact when a server is up — "connected" alone does not
 * say whether it brought anything — and the failure reason is the useful fact
 * when it is not.
 */
export function mcpServerRow(server: McpServerInfo): McpServerRow {
  const tools = server.toolCount ?? server.tools?.length ?? 0
  const detail = server.status === 'connected' ? `${tools} ${tools === 1 ? 'tool' : 'tools'}`
    : server.status === 'pending' ? 'Connecting…'
    : server.status === 'needs-auth' ? 'Needs sign-in on the desktop'
    : server.status === 'disabled' ? 'Disabled'
    : server.error?.split('\n')[0] || 'Failed to start'
  return { name: server.name, status: server.status, detail, tone: TONES[server.status] }
}

export function mcpServerRows(servers: readonly McpServerInfo[]): McpServerRow[] {
  return servers.map(mcpServerRow)
}

/**
 * Read the session's MCP servers.
 *
 * Read-only on purpose: the desktop popup can reconnect and start an OAuth
 * flow, and a phone that cannot finish one should not offer to begin it.
 */
export async function requestMcpServers(
  client: Pick<RelayClient, 'request'>,
  projectPath: string,
): Promise<{ rows: McpServerRow[]; error?: string }> {
  const reply = await client.request({
    type: 'list_mcp_servers', requestId: randomId(), projectPath,
  } as RemoteCommand) as { servers?: McpServerInfo[]; error?: string }
  if (typeof reply?.error === 'string' && reply.error) return { rows: [], error: reply.error }
  return { rows: mcpServerRows(Array.isArray(reply?.servers) ? reply.servers : []) }
}
