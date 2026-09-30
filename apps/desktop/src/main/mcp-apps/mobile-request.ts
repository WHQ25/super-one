import type { McpAppDeviceRequest } from '@superone/shared/agent-types'
import type { McpAppHostRequest, McpAppHostResult, McpAppRequester } from '@superone/shared/mcp-apps'
import { mcpAppSessionKey } from './session-key'

/**
 * Scope a paired device's View operation to the session its command named. The caller
 * has already checked that the project owns that session; the device never supplies
 * the key itself.
 */
export function deviceMcpAppHostRequest(projectPath: string, sessionId: string, request: McpAppDeviceRequest): McpAppHostRequest {
  // Links open on the device; a request that says otherwise is not one the phone builds.
  if ((request.operation as string) === 'openLink') throw new Error('invalid mcp_app_request operation')
  return { ...request, sessionKey: mcpAppSessionKey(projectPath, sessionId) }
}

export async function executeDeviceMcpAppRequest(request: McpAppHostRequest, requester: Extract<McpAppRequester, { kind: 'mobile' }>, signal = new AbortController().signal): Promise<McpAppHostResult> {
  const { executeMcpAppHostRequest } = await import('./executor')
  return executeMcpAppHostRequest(request, requester, signal)
}
