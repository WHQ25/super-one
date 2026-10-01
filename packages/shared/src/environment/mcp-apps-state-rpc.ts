import type { McpAppAttachmentUpdate, ToolAppAttachment } from '../mcp-apps'

/** Attachment lookup stays on the owning node, including in-flight native items. */
export interface McpAppsResolveAttachmentRequest {
  sessionId: string
  appInstanceId: string
  messageId?: string
}

export interface McpAppsResolvedAttachment {
  projectId: string
  messageId: string
  app: ToolAppAttachment
}

/** Authenticated host state persistence; never exposed to the untrusted View. */
export interface McpAppsStateRpcRequest {
  sessionId: string
  appInstanceId: string
  update: McpAppAttachmentUpdate
}
