import { ipcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { MCP_MENTION_QUERY_MAX_CHARS, isMcpMentionSearchTool, mcpMentionItems, type McpMentionSearchResult, type McpMentionSource } from '@superone/shared/mcp-app-mentions'
import { mcpAppIcon, mcpAppPresentation, mcpAppPresentationIcon } from '@superone/shared/mcp-apps-metadata'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'
import type { Session } from '../session/types'
import { assertHostRenderer, findHostTools, hostProvider, hostRpcFailure, hostSessionResolver, untilAborted, type HostToolCandidate } from './host-tools'

async function searchSource(session: Session, { binding, origin, tool }: HostToolCandidate, query: string, signal: AbortSignal): Promise<McpMentionSource> {
  const presentation = mcpAppPresentation(tool)
  const icon = mcpAppIcon(tool.serverInfo?.icons) ?? mcpAppPresentationIcon(presentation)
  const source: McpMentionSource = { server: binding.server, tool: tool.name, title: presentation.serverTitle ?? binding.server, ...(icon ? { icon } : {}), items: [] }
  try {
    const provider = await hostProvider(session, binding, origin, signal)
    try {
      const { result } = await untilAborted(provider.callTool({ tool: tool.name, args: { query }, origin }, signal), signal)
      return result.isError ? { ...source, failed: true } : { ...source, items: mcpMentionItems(result.structuredContent) }
    } finally { provider.dispose() }
  } catch {
    return { ...source, failed: true }
  }
}

/**
 * Composer @-mention search: every server tool that declares `mentions/search`, asked in parallel.
 * Typing `@` is a user action, so it may load the session and start its harness.
 */
export function registerMcpAppMentionIpc(getSession: (id: string) => Session | null, resumeSession: (id: string) => Session): void {
  const sessionFor = hostSessionResolver(getSession, resumeSession)

  ipcMain.handle(AgentIpcChannels.MCP_APP_MENTION_SEARCH, async (event, projectPath: string, sessionId: string, query: string): Promise<McpAppsRpcResult<McpMentionSearchResult>> => {
    try {
      assertHostRenderer(event)
      if (parseRemoteProjectKey(projectPath)) return { ok: true, value: { sources: [], unavailable: 'remote' } }
      const session = sessionFor(sessionId, false)
      if (!session || !(await session.getMcpAppsHostBindings?.({ start: true }))?.length) return { ok: true, value: { sources: [] } }
      const signal = AbortSignal.timeout(15_000)
      const { candidates, incomplete } = await findHostTools(session, isMcpMentionSearchTool, signal)
      const text = typeof query === 'string' ? query.slice(0, MCP_MENTION_QUERY_MAX_CHARS) : ''
      const sources = await Promise.all(candidates.map(candidate => searchSource(session, candidate, text, signal)))
      return { ok: true, value: { sources, ...(incomplete ? { incomplete: true as const } : {}) } }
    } catch (error) { return hostRpcFailure(error) }
  })
}
