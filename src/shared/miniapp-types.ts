export interface MiniAppWorkingDir {
  scope: 'project' | 'user'
  path: string
}

export interface MiniAppManifest {
  name: string
  icon?: string
  workingDir?: MiniAppWorkingDir
  permissions?: MiniAppPermissions
  tools?: MiniAppToolDefinition[]
}

export interface MiniAppPermissions {
  network?: string[]
  fs?: 'app' | 'project'
}

export interface MiniAppToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface MiniAppEntry {
  id: string
  manifest: MiniAppManifest
  basePath: string
}

export interface MiniAppToolCallRequest {
  callId: string
  appId: string
  toolName: string
  arguments: Record<string, unknown>
}

export interface MiniAppToolCallResponse {
  callId: string
  result?: unknown
  error?: string
}

export type MiniAppFsOp = 'readFile' | 'readDir' | 'writeFile' | 'exists' | 'glob'

export interface MiniAppFsRequest {
  appId: string
  op: MiniAppFsOp
  args: Record<string, unknown>
}

export type MiniAppBridgeMessageType =
  | 'miniapp-tool-call'
  | 'miniapp-tool-result'
  | 'miniapp-fs-request'
  | 'miniapp-fs-response'
  | 'miniapp-sendPrompt'
  | 'miniapp-ready'
