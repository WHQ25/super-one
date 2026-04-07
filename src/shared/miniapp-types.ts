export type MiniAppFsAccess = 'read' | 'readwrite'

export interface MiniAppFsEntry {
  scope: 'project' | 'user' | 'app'
  path?: string
  access?: MiniAppFsAccess
  reason: string
}

export interface MiniAppNetworkEntry {
  domain: string
  reason: string
}

export type MiniAppType = 'sidebar' | 'panel' | 'in-chat' | 'fullscreen'

export interface MiniAppAuthor {
  name: string
  email?: string
  url?: string
}

export interface MiniAppManifest {
  appId: string
  name: string
  version?: string
  author?: MiniAppAuthor
  description?: string
  logo?: string
  isDev?: boolean
  type?: MiniAppType
  permissions?: MiniAppPermissions
  tools?: MiniAppToolDefinition[]
}

export interface MiniAppInstallMeta {
  appId: string
  version: string
  installedAt: string
  source: 'local' | 'url' | 'github'
  integrityVerified: boolean
  sourceUri?: string
}

export interface MiniAppIntegrity {
  files: Record<string, string>
}

export interface MiniAppPermissions {
  network?: MiniAppNetworkEntry[]
  fs?: MiniAppFsEntry[]
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

export type MiniAppGitOp = 'info' | 'branches' | 'log' | 'status' | 'diff' | 'show'

export interface MiniAppFsRequest {
  appId: string
  op: MiniAppFsOp
  args: Record<string, unknown>
}

export interface MiniAppPackResult {
  outputPath: string
  manifest: MiniAppManifest
  fileCount: number
}

export interface MiniAppPreviewResult {
  manifest: MiniAppManifest
  tempDir: string
  existingVersion?: string
}

export interface MiniAppInstallResult {
  entry: MiniAppEntry
  meta: MiniAppInstallMeta
  upgraded: boolean
}

export interface MiniAppFsWatchEvent {
  watchId: number
  appId: string
  type: 'change' | 'rename'
  path: string
}

export type MiniAppBridgeMessageType =
  | 'miniapp-tool-call'
  | 'miniapp-tool-result'
  | 'miniapp-fs-request'
  | 'miniapp-fs-response'
  | 'miniapp-fs-watch'
  | 'miniapp-fs-unwatch'
  | 'miniapp-fs-watch-ack'
  | 'miniapp-fs-watch-event'
  | 'miniapp-theme'
  | 'miniapp-git-request'
  | 'miniapp-git-response'
  | 'miniapp-git-head-change'
  | 'miniapp-sendPrompt'
  | 'miniapp-ready'
