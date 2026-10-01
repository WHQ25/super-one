import type { McpUiResourceMeta } from './mcp-apps'

/** Trusted renderer/native document handles; never exposed to the App iframe. */
export interface McpAppDocumentRegistration {
  id: string
  url: string
  origin: string
  appInstanceId: string
}

export interface McpAppDesktopRequestContext {
  documentId: string
  requestId: string
}

/** Native preparation never reconnects historical Views just to paint their snapshot. */
export type McpAppPreparedDocument =
  | { state: 'inactive' }
  | { state: 'ready'; document: McpAppDocumentRegistration; active: boolean; meta: McpUiResourceMeta }
