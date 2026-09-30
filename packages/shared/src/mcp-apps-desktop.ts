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
