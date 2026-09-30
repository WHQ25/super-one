import type { McpAppDeviceRequest } from '@superone/shared/agent-types'
import { sessionKey, sessionRef } from '@superone/shared/environment/refs'
import type { McpAppHostRequest, McpAppHostResult } from '@superone/shared/mcp-apps'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'

/** The node local MCP App bindings name; remote sessions use their connection. */
const LOCAL_ENVIRONMENT = 'local'

/**
 * Scope a paired device's View operation to the session its command named. The caller
 * has already checked that the project owns that session; the device never supplies
 * the key itself.
 */
export function deviceMcpAppHostRequest(projectPath: string, sessionId: string, request: McpAppDeviceRequest): McpAppHostRequest {
  // Links open on the device; a request that says otherwise is not one the phone builds.
  if ((request.operation as string) === 'openLink') throw new Error('invalid mcp_app_request operation')
  const environmentId = parseRemoteProjectKey(projectPath)?.connectionId ?? LOCAL_ENVIRONMENT
  return { ...request, sessionKey: sessionKey(sessionRef(environmentId, sessionId)) }
}

export async function executeDeviceMcpAppRequest(_request: McpAppHostRequest, _deviceId: string): Promise<McpAppHostResult> {
  return { ok: false, error: { code: 'not_connected', message: 'MCP App host executor is not available' } }
}
