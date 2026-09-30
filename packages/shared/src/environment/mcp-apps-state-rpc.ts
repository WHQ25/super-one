import type { McpAppAttachmentUpdate, McpAppToolApproval, ToolAppAttachment } from '../mcp-apps'

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
  sessionApprovals: McpAppToolApproval[]
}

/** Authenticated host state persistence; never exposed to the untrusted View. */
export interface McpAppsStateRpcRequest {
  sessionId: string
  appInstanceId: string
  update: McpAppAttachmentUpdate
}
