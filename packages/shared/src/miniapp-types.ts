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

export type MiniAppMediaKind = 'microphone' | 'camera'

export interface MiniAppMediaEntry {
  kind: MiniAppMediaKind
  reason: string
}

export interface MiniAppStorageEntry {
  reason: string
}

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
  fullscreen?: boolean
  preferWidth?: number
  permissions?: MiniAppPermissions
  toolSlug?: string
  tools?: MiniAppToolDefinition[]
  runningText?: string
  templates?: Record<string, string>
}

export interface MiniAppToolInterceptRenderer {
  template: string
  inputMerge?: 'shallow-merge' | 'replace'
  onCancel?: 'reject' | 'resolve-empty'
  timeoutMs?: number
}

export interface MiniAppToolResultRenderer {
  template: string
  autoExpand?: boolean
}

export interface MiniAppToolRenderer {
  intercept?: MiniAppToolInterceptRenderer
  result?: MiniAppToolResultRenderer
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
  media?: MiniAppMediaEntry[]
  storage?: MiniAppStorageEntry
}

export interface MiniAppToolDefinition {
  name: string
  description: string
  displayName?: string
  runningText?: string
  inputSummaryField?: string
  resultSummaryField?: string
  showResult?: boolean
  groupable?: boolean
  inputSchema: Record<string, unknown>
  renderer?: MiniAppToolRenderer
}

export interface MiniAppEntry {
  id: string
  manifest: MiniAppManifest
  installDir: string
  distDir?: string
  /**
   * Set for dev pointer entries whose appId is not present in the dev-registry
   * (e.g. registry was reset, source folder unlinked). Renderer should surface
   * an "orphan" badge instead of trying to load the app.
   */
  orphan?: boolean
}

export interface DevRegistryEntry {
  appId: string
  sourceDir: string
  distDir: string
  name: string
  registeredAt: number
  lastSeenAt: number
}

export interface DevAppInstallation {
  scope: 'user' | 'project'
  projectDir?: string
  installDir: string
  enabled: boolean
}

export interface DevRegistryView extends DevRegistryEntry {
  /** 'ok' = sourceDir exists; 'missing' = sourceDir not found on disk. */
  status: 'ok' | 'missing'
  installations: DevAppInstallation[]
}

export interface MiniAppToolCallRequest {
  callId: string
  appId: string
  projectDir: string
  toolName: string
  arguments: Record<string, unknown>
}

export interface MiniAppToolInterceptOpenRequest {
  callId: string
  appId: string
  projectDir: string
  toolSlug: string
  toolName: string
  agentInput: Record<string, unknown>
  template: string
  templatePath: string
}

export interface MiniAppToolInterceptSubmitPayload {
  callId: string
  userInput: Record<string, unknown>
}

export interface MiniAppToolInterceptCancelPayload {
  callId: string
  reason?: string
}

export interface MiniAppToolCallResponse {
  callId: string
  result?: unknown
  error?: string
}

export type MiniAppFsOp = 'readFile' | 'readFileBinary' | 'readDir' | 'writeFile' | 'exists' | 'glob' | 'deleteFile' | 'rename' | 'stat' | 'mkdir' | 'showInFolder'

export type MiniAppGitOp = 'info' | 'branches' | 'log' | 'status' | 'diff' | 'show' | 'blame' | 'diffSummary' | 'getCommit' | 'tags' | 'remotes' | 'branchDetail' | 'stashList' | 'logFile'

export type MiniAppDbOp = 'query' | 'exec' | 'batch' | 'pragma'

export interface MiniAppDbStatement {
  sql: string
  params?: unknown[] | Record<string, unknown>
}

export interface MiniAppDbRunResult {
  changes: number
  lastInsertRowid: number
}

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

export interface MiniAppPopoverShowRequest {
  template: string
  data?: unknown
  anchorRect: { x: number; y: number; width: number; height: number }
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  width?: number
  maxHeight?: number
}

export interface MiniAppContextData {
  summary: string
  content: string
  mode: 'inject' | 'suggest'
  color?: string
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
  | 'miniapp-locale'
  | 'miniapp-git-request'
  | 'miniapp-git-response'
  | 'miniapp-git-head-change'
  | 'miniapp-db-request'
  | 'miniapp-db-response'
  | 'miniapp-sendPrompt'
  | 'miniapp-ready'
  | 'miniapp-resize'
  | 'miniapp-ui-toast'
  | 'miniapp-ui-tooltip-show'
  | 'miniapp-ui-tooltip-hide'
  | 'miniapp-ui-contextmenu'
  | 'miniapp-ui-contextmenu-result'
  | 'miniapp-popover-show'
  | 'miniapp-popover-opened'
  | 'miniapp-popover-msg'
  | 'miniapp-popover-close'
  | 'miniapp-popover-closed'
  | 'miniapp-tool-init'
  | 'miniapp-tool-submit'
  | 'miniapp-tool-cancel'
  | 'miniapp-tool-result-close'
  | 'miniapp-context-set'
  | 'miniapp-context-clear'
  | 'miniapp-context-consumed'
  | 'miniapp-media-started'
  | 'miniapp-media-track-ended'

export const MiniAppToolBridgeMsg = {
  SUBMIT: 'miniapp-tool-submit',
  CANCEL: 'miniapp-tool-cancel',
  RESULT_CLOSE: 'miniapp-tool-result-close',
} as const

export function buildToolRendererUrl(
  phase: 'intercept' | 'result',
  host: string,
  templatePath: string,
  callId: string,
  toolName: string,
  data: unknown,
): string {
  const flag = phase === 'intercept' ? '_toolIntercept' : '_toolResult'
  const encodedData = encodeURIComponent(JSON.stringify(data ?? null))
  return `superone-app://${host}/${templatePath}?${flag}=1&_toolCallId=${encodeURIComponent(callId)}&_toolName=${encodeURIComponent(toolName)}&_toolData=${encodedData}`
}
