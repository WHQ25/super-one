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
  toolSlug?: string
  tools?: MiniAppToolDefinition[]
  inChatToolName?: string
  inChatToolDescription?: string
  runningText?: string
  inputSchema?: Record<string, unknown>
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
  runningText?: string
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

export type MiniAppFsOp = 'readFile' | 'readFileBinary' | 'readDir' | 'writeFile' | 'exists' | 'glob' | 'deleteFile' | 'rename' | 'stat' | 'mkdir' | 'showInFolder'

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

export interface InChatMiniAppResult {
  __inchat: true
  appId: string
  data: Record<string, unknown>
}

export function parseInChatResult(resultText: string): InChatMiniAppResult | null {
  try {
    const parsed = JSON.parse(resultText)
    if (parsed && parsed.__inchat === true && parsed.appId && parsed.data) {
      return parsed as InChatMiniAppResult
    }
  } catch {}
  return null
}

export type MiniAppToastType = 'success' | 'error' | 'info' | 'warning'

export interface MiniAppTooltipRequest {
  anchorRect: { x: number; y: number; width: number; height: number }
  text: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export interface MiniAppContextMenuItem {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  variant?: 'default' | 'destructive'
  separator?: boolean
  group?: string
}

export interface MiniAppContextMenuRequest {
  position: { x: number; y: number }
  items: MiniAppContextMenuItem[]
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
  | 'miniapp-inchat-init'
  | 'miniapp-resize'
  | 'miniapp-ui-toast'
  | 'miniapp-ui-tooltip-show'
  | 'miniapp-ui-tooltip-hide'
  | 'miniapp-ui-contextmenu'
  | 'miniapp-ui-contextmenu-result'
