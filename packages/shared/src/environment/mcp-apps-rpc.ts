import type { McpAppsBinding, McpAppOrigin, McpAppsErrorData } from '../mcp-apps'

/** Host-authored binding. The untrusted View never receives this API. */
export interface McpAppsProviderRpcRequest {
  binding: McpAppsBinding
  origin: McpAppOrigin
  operation: 'ready' | 'tools' | 'readResource' | 'callTool' | 'authenticate' | 'submitAuthCallback'
  /** Host-only: a View read result, rather than the initial persisted HTML snapshot. */
  transient?: boolean
  uri?: string
  tool?: string
  args?: unknown
  redirectUri?: string
  callbackUrl?: string
}
export type McpAppsRpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: McpAppsErrorData }
