import type { McpAppResource } from './mcp-app-resource'
/** Harness-neutral MCP Apps contracts. No runtime SDK or Electron dependency. */
import { compactMcpAppPresentation, MCP_APP_PRESENTATION_MAX_BYTES } from './mcp-apps-metadata'
import type { McpUiMessageRequest } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { McpAppsRpcResult } from './environment/mcp-apps-rpc'
import type { ContextAttachment } from './context-attachments'
import type { McpAppResourceWriteParams } from './mcp-app-files'
import { MAX_REMOTE_PAYLOAD_BYTES } from './remote-payload'
import { formatBytes } from './format-bytes'

export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'
export const MCP_APPS_EXTENSION = { 'io.modelcontextprotocol/ui': { mimeTypes: [MCP_APP_MIME_TYPE] } } as const
export const MCP_APP_HTML_MAX_BYTES = 2 * 1024 * 1024
export const MCP_APP_DATA_MAX_BYTES = 1024 * 1024
/**
 * Initial tool input and result, the same for the live View, the transcript and other devices.
 * Not raised to fit oversized results: see docs/features/mcp-apps.md.
 */
export const MCP_APP_RESULT_MAX_BYTES = 2 * 1024 * 1024
/**
 * View-only tool/resource output, never persisted in the transcript. Large enough for
 * App assets (a CAD importer's wasm); it leaves room for the RPC envelope inside one
 * remote payload so phone and node paths fail here, with a clear error, not in framing.
 */
export const MCP_APP_OUTPUT_MAX_BYTES = MAX_REMOTE_PAYLOAD_BYTES - 64 * 1024

export interface McpAppsBinding {
  node: string
  session: string
  server: string
  account?: string
  configGeneration: number
  /** Fingerprint of stable server configuration; excludes rotating credentials. */
  configFingerprint: string
  /**
   * Served by SuperOne's own connection to the server rather than the harness's:
   * host-originated Apps on harnesses whose connection hides what they need.
   */
  hostClient?: true
}

export interface McpAppOrigin {
  /** Provider's session/thread identity, never inferred from the active UI. */
  providerSessionId: string
  /** Only providers that need call-scoped resource routing use this. */
  originCallId?: string
}

export interface McpUiResourceMeta {
  csp?: { connectDomains?: string[]; resourceDomains?: string[]; frameDomains?: string[]; baseUriDomains?: string[] }
  permissions?: { camera?: Record<string, never>; microphone?: Record<string, never>; geolocation?: Record<string, never>; clipboardWrite?: Record<string, never> }
  prefersBorder?: boolean
  [key: string]: unknown
}

export interface McpToolDescriptor {
  name: string
  title?: string
  icons?: McpAppIcon[]
  /** Provider-authored initialize/server-status metadata, not tool-supplied metadata. */
  serverInfo?: { name?: string; version?: string; title?: string; icons?: McpAppIcon[] }
  description?: string
  /** Some native providers expose metadata only. The server validates arguments. */
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; [key: string]: unknown }
  _meta?: { ui?: { resourceUri?: string; visibility?: Array<'model' | 'app'> }; [key: string]: unknown }
}

export interface McpAppIcon { src: string; mimeType?: string; sizes?: string[]; theme?: 'light' | 'dark' }
export interface McpAppPresentation { toolTitle: string; icons?: McpAppIcon[]; toolIcons?: McpAppIcon[]; serverTitle?: string; serverIcons?: McpAppIcon[] }

export interface McpAppToolResult {
  content: unknown[]
  structuredContent?: unknown
  /** Private to the host/View; must never be injected into a model turn. */
  _meta?: Record<string, unknown>
  isError?: boolean
}

/** Host-only outcome; send only `result` to the View. No automatic retry. */
export interface McpAppsCallResult {
  result: McpAppToolResult
  outcome: 'completed' | 'unknown_outcome'
}

export interface McpAppReadResult {
  contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string; _meta?: Record<string, unknown> }>
  _meta?: Record<string, unknown>
}

export interface McpAppsCapabilities {
  mode: 'native' | 'gateway' | 'unsupported'
  resourceRead: boolean
  toolCall: boolean
  /** The provider can start the server's OAuth sign-in. */
  authenticate: boolean
}

/**
 * A started sign-in. The host opens `authUrl` in the user's browser. With
 * `harness`, the harness receives the redirect itself; with `host-callback`,
 * the redirect goes to the `redirectUri` the host passed and the host hands the
 * callback URL back through `submitAuthCallback`; `done` needs no user action.
 */
export interface McpAppsAuthStart {
  authUrl?: string
  completion: 'harness' | 'host-callback' | 'done'
}

export interface McpAppsProvider {
  readonly binding: McpAppsBinding
  ready(signal: AbortSignal): Promise<McpAppsCapabilities>
  tools(options?: { refresh?: boolean }): Promise<Map<string, McpToolDescriptor>>
  readResource(req: { uri: string; origin?: McpAppOrigin; transient?: boolean }, signal: AbortSignal): Promise<McpAppReadResult>
  /** `meta` is host-authored request `_meta`; providers that cannot forward it refuse a call that carries it. */
  callTool(req: { tool: string; args: unknown; origin?: McpAppOrigin; meta?: Record<string, unknown> }, signal: AbortSignal): Promise<McpAppsCallResult>
  /** `redirectUri` is where the host listens when the harness cannot receive the redirect (remote node). */
  authenticate?(req: { redirectUri?: string }, signal: AbortSignal): Promise<McpAppsAuthStart>
  submitAuthCallback?(req: { callbackUrl: string }, signal: AbortSignal): Promise<void>
  dispose(): void
}

export type McpAppsErrorCode = 'auth_required' | 'inactive' | 'denied' | 'invalid' | 'not_connected' | 'timeout' | 'cancelled' | 'unknown_outcome'
export interface McpAppsErrorData { code: McpAppsErrorCode; message: string; challenge?: string[] }
export class McpAppsError extends Error implements McpAppsErrorData {
  constructor(readonly code: McpAppsErrorCode, message: string, readonly challenge?: string[]) {
    super(message)
    this.name = 'McpAppsError'
  }
  toJSON(): McpAppsErrorData { return { code: this.code, message: this.message, ...(this.challenge ? { challenge: this.challenge } : {}) } }
}

export interface McpAppModelContext {
  /** Host-authored revision; optional only for snapshots written by older hosts. */
  updateId?: string
  content?: unknown[]
  structuredContent?: Record<string, unknown>
  /** Host-authored source attribution. */
  source: { appInstanceId: string; server: string }
}

export type McpAppMessageParams = McpUiMessageRequest['params'] & { _meta?: Record<string, unknown> }

/** Host-authored approval details. Render previews as plain text, never as View HTML. */
export type McpAppMessagePrompt = { kind: 'sendMessage'; server: string; text: string; nonTextBlocks: number; items?: ContextAttachment[]; target?: 'active' | 'new' }
/** `openai/files/open` for a file outside the session's project; `path` is the host-resolved real path. */
export type McpAppOpenFilePrompt = { kind: 'openFile'; server: string; path: string }
export type McpAppApprovalPrompt = McpAppMessagePrompt | McpAppOpenFilePrompt

export type McpAppHostOperation =
  | { operation: 'load'; referenceOnly?: boolean }
  | { operation: 'activate' }
  | { operation: 'callTool'; tool: string; args: Record<string, unknown> }
  | { operation: 'readResource'; uri: string; representation?: 'text' | 'blob' }
  /** File-entrypoint Views only, on their own host resource. */
  | { operation: 'subscribeResource'; uri: string }
  | { operation: 'unsubscribeResource'; uri: string }
  | { operation: 'writeResource'; params: McpAppResourceWriteParams }
  | { operation: 'sendMessage'; params: McpAppMessageParams }
  /** `openai/files/open`: an absolute path on the session's host, desktop local sessions only. */
  | { operation: 'openFile'; path: string }
  /** Trusted host continuation after navigating to a confirmed new conversation. */
  | { operation: 'sendPreparedMessage'; pendingSend: string }
  | { operation: 'updateModelContext'; context: McpAppModelContext }
  /** Trusted composer removal; not exposed to the View's AppBridge. */
  | { operation: 'removeModelContext'; updateId: string; blockIndex?: number }

export interface McpAppPreparedMessage { pendingSend: string; route: { projectPath: string; sessionId: string } }

/** The host resolves the attachment and binding; callers supply only scoped View identity. */
export type McpAppHostRequest = McpAppHostOperation & {
  /** `sessionKey(sessionRef(environmentId, sessionId))`; never a bare session ID. */
  sessionKey: string
  appInstanceId: string
  /** Lookup hint only; the host verifies the owning message. */
  messageId?: string
  approval?: { challenge: string }
}

export type McpAppRequester = { kind: 'desktop' } | { kind: 'mobile'; deviceId: string; transport?: 'lan' | 'relay' }

/** Renderer supplies View identity; main derives the session key from its routing inputs. */
export type McpAppViewRequest = McpAppHostOperation & Omit<McpAppHostRequest, 'operation' | 'sessionKey'>

export type McpAppHostResult<T = unknown> = McpAppsRpcResult<T> | {
  ok: false
  error: { code: 'approval_required'; challenge: string; prompt: McpAppApprovalPrompt }
}

/** Only the host can author these persisted attachment fields. */
export interface McpAppAttachmentUpdate {
  resource?: NonNullable<ToolAppAttachment['resource']>
  modelContext?: McpAppModelContext | null
  presentation?: McpAppPresentation
}

export interface ToolAppAttachment {
  appInstanceId: string
  binding: McpAppsBinding
  origin?: McpAppOrigin
  harnessCallId?: string
  gatewayCallId?: string
  resourceUri: string
  toolName?: string
  /** Set only on a View the host opened through a file entrypoint; such Views live in memory, outside the transcript. */
  file?: { name: string; resourceUri: string }
  presentation?: McpAppPresentation
  resource?: McpAppResource
  toolInput?: Record<string, unknown>
  toolResult?: McpAppToolResult
  /** Initial result exceeded the cap where it was bounded; live App calls still work. */
  toolResultOmitted?: { bytes: number; reason: 'size_limit' }
  modelContext?: McpAppModelContext | null
  status: 'pending' | 'result' | 'cancelled' | 'error'
  error?: McpAppsErrorData
}

/** A failed call shows as its harness's own tool row, never as a View. */
export function mcpAppToolFailed(app: ToolAppAttachment): boolean {
  return app.status === 'error' || (app.status === 'result' && app.toolResult?.isError === true)
}

/** Why a finished call's View is not opened: its initial result was over the cap. */
export function mcpAppOmittedMessage(app: ToolAppAttachment, t: (key: string, values?: Record<string, unknown>) => string): string | undefined {
  return app.status === 'result' && app.toolResultOmitted ? t('mcpApp.resultOverLimit', { size: formatBytes(app.toolResultOmitted.bytes) }) : undefined
}

export function mcpAppResourceUri(tool: McpToolDescriptor): string | undefined {
  const uri = tool._meta?.ui?.resourceUri ?? tool._meta?.['ui/resourceUri']
  return typeof uri === 'string' && uri.startsWith('ui://') ? uri : undefined
}

export function mcpAppToolVisible(tool: McpToolDescriptor): boolean {
  return tool._meta?.ui?.visibility?.includes('app') ?? true
}

/** Keep data bounded without turning a working View into an error for an oversized result. */
export function boundedToolAppAttachment(app: ToolAppAttachment, logOmission = false): ToolAppAttachment {
  // An explicit omission always wins over raw harness data or restored fallbacks.
  if (app.toolResultOmitted && app.toolResult) app = { ...app, toolResult: undefined }
  if (app.presentation) {
    const presentation = compactMcpAppPresentation(app.presentation)
    try { assertMcpAppSize(presentation, MCP_APP_PRESENTATION_MAX_BYTES); app = { ...app, presentation } }
    catch { app = { ...app, presentation: undefined } }
  }
  try {
    assertMcpAppSize({ toolInput: app.toolInput })
    const result = JSON.stringify(app.toolResult)
    const bytes = result === undefined ? 0 : new TextEncoder().encode(result).byteLength
    const total = new TextEncoder().encode(JSON.stringify({ toolInput: app.toolInput, toolResult: app.toolResult })).byteLength
    if (app.toolResult && total > MCP_APP_RESULT_MAX_BYTES) {
      if (logOmission) console.warn('[MCP App] Initial result omitted at View boundary', { appInstanceId: app.appInstanceId, bytes })
      return { ...app, toolResult: undefined, toolResultOmitted: { bytes, reason: 'size_limit' } }
    }
    return app
  } catch (error) {
    return { ...app, toolInput: undefined, toolResult: undefined, status: 'error', error: (error instanceof McpAppsError ? error : new McpAppsError('invalid', 'MCP App data must be JSON serializable')).toJSON() }
  }
}

/** Apply before transport/persistence; reject rather than truncate protocol data. */
export function assertMcpAppSize(value: unknown, maxBytes = MCP_APP_DATA_MAX_BYTES): void {
  let json: string
  try { json = JSON.stringify(value) } catch { throw new McpAppsError('invalid', 'MCP App data must be JSON serializable') }
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > maxBytes) {
    throw new McpAppsError('invalid', 'MCP App data exceeds the size limit')
  }
}
