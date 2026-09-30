import type { McpAppAttachmentUpdate } from '../mcp-apps'

/** Authenticated host state persistence; never exposed to the untrusted View. */
export interface McpAppsStateRpcRequest {
  sessionId: string
  appInstanceId: string
  update: McpAppAttachmentUpdate
}
