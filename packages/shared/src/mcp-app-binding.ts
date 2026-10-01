import { McpAppsError, type McpAppOrigin, type McpAppsBinding } from './mcp-apps'

/** Read from the current runtime after revive/refresh, never from the saved View. */
export interface McpAppsBindingIdentity {
  session: string | null | undefined
  providerSessionId: string | null | undefined
  account: string | null | undefined
  configFingerprint: string
}

/** Every native provider uses the same identity boundary before dispatch. */
export function assertMcpAppsBindingIdentity(binding: McpAppsBinding, origin: McpAppOrigin, current: McpAppsBindingIdentity): void {
  if (binding.session !== current.session || origin.providerSessionId !== current.providerSessionId) {
    throw new McpAppsError('inactive', 'MCP App session binding changed')
  }
  if (binding.account !== (current.account ?? undefined)) throw new McpAppsError('not_connected', 'MCP App account changed')
  if (binding.configFingerprint !== current.configFingerprint) throw new McpAppsError('not_connected', 'MCP App server configuration changed')
}
