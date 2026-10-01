import type { AgentEvent } from '@superone/shared/agent-types'
import type { MiniAppToolDefinition } from '@superone/shared/miniapp-types'
import type { McpAppsBinding, McpAppOrigin, McpAppsProvider } from '@superone/shared/mcp-apps'
import type { MiniappToolReply } from '../mcp/miniapp-mcp-tools'

/** Lightweight registry: importing the host MCP surface must not load the client SDK. */
export interface CompatSession {
  readonly omittedServers: Set<string>
  catalog(): Array<{ appId: string; tools: MiniAppToolDefinition[] }>
  call(appId: string, tool: string, input: Record<string, unknown>): Promise<MiniappToolReply>
  attach(event: AgentEvent): AgentEvent
  provider(binding: McpAppsBinding, origin: McpAppOrigin): McpAppsProvider
  close(): Promise<void>
}

const sessions = new Map<string, CompatSession>()
export const getCompatSession = (sessionId: string): CompatSession | undefined => sessions.get(sessionId)
export const setCompatSession = (sessionId: string, session: CompatSession): void => { sessions.set(sessionId, session) }

export async function closeCompatSession(sessionId: string, expected?: CompatSession): Promise<void> {
  const session = expected ?? sessions.get(sessionId)
  if (sessions.get(sessionId) === session) sessions.delete(sessionId)
  await session?.close()
}
