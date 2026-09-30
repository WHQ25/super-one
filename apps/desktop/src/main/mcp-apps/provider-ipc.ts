import { ipcMain, shell } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import { McpAppsError, type McpAppsBinding, type McpAppOrigin } from '@superone/shared/mcp-apps'
import type { McpAppsProviderRpcRequest, McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'
import type { Session } from '../session/types'
import { authenticateMcpApp } from './auth'
import { registerMcpAppDocumentIpc } from './document-ipc'

let registered = false

/** The one local/remote route for provider operations; no harness-specific renderer IPC. */
export async function routeMcpAppsProviderRequest(
  getSession: (id: string) => Session | null,
  connectionId: string,
  input: McpAppsProviderRpcRequest,
  signal = new AbortController().signal,
  options: { propagateTransportErrors?: boolean } = {},
): Promise<McpAppsRpcResult> {
  try {
    if (connectionId !== 'local') {
      const { getEnvironmentHost } = await import('../environment/environment-host')
      return await getEnvironmentHost().requestMcpAppsProvider(connectionId, input)
    }
    const session = getSession(input.binding.session)
    if (!session?.getMcpAppsProvider) throw new McpAppsError('not_connected', 'MCP Apps session unavailable')
    return dispatchMcpAppsProviderRequest(input, await session.getMcpAppsProvider(input.binding, input.origin), signal)
  } catch (error) {
    if (options.propagateTransportErrors && (error as { transport?: boolean })?.transport === true) throw error
    return { ok: false, error: error instanceof McpAppsError ? error.toJSON() : { code: 'not_connected', message: error instanceof Error ? error.message : String(error) } }
  }
}

export function registerMcpAppsProviderIpc(getSession: (id: string) => Session | null): void {
  if (registered) return
  registered = true
  registerMcpAppDocumentIpc()
  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_MCP_APPS_PROVIDER, (_event, connectionId: string, input: McpAppsProviderRpcRequest) =>
    routeMcpAppsProviderRequest(getSession, connectionId, input))

  ipcMain.handle(AgentIpcChannels.ENVIRONMENT_MCP_APPS_AUTHENTICATE, (_event, connectionId: string, target: { binding: McpAppsBinding; origin: McpAppOrigin }) =>
    authenticateMcpApp({
      request: (op) => routeMcpAppsProviderRequest(getSession, connectionId, { ...op, binding: target.binding, origin: target.origin }),
      openUrl: (url) => shell.openExternal(url),
      hostCallback: connectionId !== 'local',
    }, new AbortController().signal))
}
