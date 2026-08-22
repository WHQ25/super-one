export interface MiniAppNetworkEntry {
  domain: string
  reason: string
}

export type MiniAppMediaKind = 'microphone' | 'camera'

export interface MiniAppMediaEntry {
  kind: MiniAppMediaKind
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
  /** Node.js entrypoint loaded inside the app's dedicated MiniApp Host process. */
  main: string
  version?: string
  author?: MiniAppAuthor
  description?: string
  logo?: string
  isDev?: boolean
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
  media?: MiniAppMediaEntry[]
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
  standalone?: boolean
  timeoutMs?: number
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

export interface MiniAppHostInfo {
  appId: string
  projectDir: string
  name: string
  since: number
  ready: boolean
  statusText?: string
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
  | 'miniapp-node-post-message'
  | 'miniapp-node-message'
  | 'miniapp-theme'
  | 'miniapp-locale'
  | 'miniapp-ready'
  | 'miniapp-resize'
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
  | 'miniapp-media-started'
  | 'miniapp-media-track-ended'
  | 'miniapp-standalone-data'

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

export function buildStandaloneToolUrl(
  host: string,
  callId: string,
  toolName: string,
  templatePath: string,
): string {
  const params = new URLSearchParams()
  params.set('_standalone', '1')
  params.set('_toolCallId', callId)
  params.set('_toolName', toolName)
  return `superone-app://${host}/${templatePath}?${params.toString()}`
}
