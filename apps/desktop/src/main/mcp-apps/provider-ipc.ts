import { ipcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppsProviderRpcRequest, McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'
import type { Session } from '../session/types'

/** The environment API has one local/remote route; no Codex-specific renderer IPC. */
export function registerMcpAppsProviderIpc(getSession: (id: string) => Session | null): void {
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_MCP_APPS_PROVIDER, async (_event, connectionId: string, input: McpAppsProviderRpcRequest): Promise<McpAppsRpcResult> => {
    try {
      if (connectionId !== 'local') {
        const { getEnvironmentHost } = await import('../environment/environment-host')
        return getEnvironmentHost().requestMcpAppsProvider(connectionId, input)
      }
      const session = getSession(input.binding.session)
      if (!session?.getMcpAppsProvider) throw new McpAppsError('not_connected', 'MCP Apps session unavailable')
      return dispatchMcpAppsProviderRequest(input, await session.getMcpAppsProvider(input.binding, input.origin))
    } catch (error) {
      return { ok: false, error: error instanceof McpAppsError ? error.toJSON() : { code: 'not_connected', message: error instanceof Error ? error.message : String(error) } }
    }
  })
}
