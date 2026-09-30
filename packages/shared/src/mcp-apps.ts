/** Harness-neutral MCP Apps contracts. No runtime SDK or Electron dependency. */
import type { McpUiMessageRequest } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { McpAppsRpcResult } from './environment/mcp-apps-rpc'

export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'
export const MCP_APPS_EXTENSION = { 'io.modelcontextprotocol/ui': { mimeTypes: [MCP_APP_MIME_TYPE] } } as const
export const MCP_APP_HTML_MAX_BYTES = 2 * 1024 * 1024
export const MCP_APP_DATA_MAX_BYTES = 1024 * 1024

export interface McpAppsBinding {
  node: string
  session: string
  server: string
  account?: string
  configGeneration: number
  /** Fingerprint of stable server configuration; excludes rotating credentials. */
  configFingerprint: string
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
  description?: string
  /** Some native providers expose metadata only. The server validates arguments. */
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; [key: string]: unknown }
  _meta?: { ui?: { resourceUri?: string; visibility?: Array<'model' | 'app'> }; [key: string]: unknown }
}

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
  tools(): Promise<Map<string, McpToolDescriptor>>
  readResource(req: { uri: string; origin?: McpAppOrigin }, signal: AbortSignal): Promise<McpAppReadResult>
  callTool(req: { tool: string; args: unknown; origin?: McpAppOrigin }, signal: AbortSignal): Promise<McpAppsCallResult>
  /** `redirectUri` is where the host listens when the harness cannot receive the redirect (remote node). */
  authenticate?(req: { redirectUri?: string }, signal: AbortSignal): Promise<McpAppsAuthStart>
  submitAuthCallback?(req: { callbackUrl: string }, signal: AbortSignal): Promise<void>
  dispose(): void
}

export type McpAppsErrorCode = 'auth_required' | 'denied' | 'invalid' | 'not_connected' | 'timeout' | 'cancelled' | 'unknown_outcome'
export interface McpAppsErrorData { code: McpAppsErrorCode; message: string; challenge?: string[] }
export class McpAppsError extends Error implements McpAppsErrorData {
  constructor(readonly code: McpAppsErrorCode, message: string, readonly challenge?: string[]) {
    super(message)
    this.name = 'McpAppsError'
  }
  toJSON(): McpAppsErrorData { return { code: this.code, message: this.message, ...(this.challenge ? { challenge: this.challenge } : {}) } }
}

export interface McpAppModelContext {
  content?: unknown[]
  structuredContent?: Record<string, unknown>
  /** Host-authored source attribution. */
  source: { appInstanceId: string; server: string }
}

/** Host-authored approval details. Render previews as plain text, never as View HTML. */
export type McpAppApprovalPrompt =
  | { kind: 'callTool'; server: string; tool: string; toolTitle?: string; argsPreview: string; rememberable: boolean }
  | { kind: 'sendMessage'; server: string; text: string; nonTextBlocks: number }
  | { kind: 'openLink'; server: string; url: string }

export type McpAppHostOperation =
  | { operation: 'load' }
  | { operation: 'activate' }
  | { operation: 'callTool'; tool: string; args: Record<string, unknown> }
  | { operation: 'readResource'; uri: string }
  | { operation: 'sendMessage'; params: McpUiMessageRequest['params'] }
  | { operation: 'updateModelContext'; context: McpAppModelContext }
  /** Desktop only. The phone confirms and opens links locally. */
  | { operation: 'openLink'; url: string }

/** The host resolves the attachment and binding; callers supply only scoped View identity. */
export type McpAppHostRequest = McpAppHostOperation & {
  /** `sessionKey(sessionRef(environmentId, sessionId))`; never a bare session ID. */
  sessionKey: string
  appInstanceId: string
  /** Lookup hint only; the host verifies the owning message. */
  messageId?: string
  approval?: { challenge: string; remember?: boolean }
}

export type McpAppRequester = { kind: 'desktop' } | { kind: 'mobile'; deviceId: string }

/** Renderer supplies View identity; main derives the session key from its routing inputs. */
export type McpAppViewRequest = McpAppHostOperation & Omit<McpAppHostRequest, 'operation' | 'sessionKey'>

export type McpAppHostResult<T = unknown> = McpAppsRpcResult<T> | {
  ok: false
  error: { code: 'approval_required'; challenge: string; prompt: McpAppApprovalPrompt }
}

/** Session-scoped consent; credentials and configuration generations are never stored here. */
export interface McpAppToolApproval {
  node: string
  session: string
  server: string
  account?: string
  configFingerprint: string
  tool: string
}

/** Only the host can author these persisted attachment fields. */
export interface McpAppAttachmentUpdate {
  resource?: NonNullable<ToolAppAttachment['resource']>
  modelContext?: McpAppModelContext
  approvedTools?: McpAppToolApproval[]
}

export interface ToolAppAttachment {
  appInstanceId: string
  binding: McpAppsBinding
  origin?: McpAppOrigin
  harnessCallId?: string
  gatewayCallId?: string
  resourceUri: string
  resource?: { html: string; meta: McpUiResourceMeta; hash: string }
  toolInput?: Record<string, unknown>
  toolResult?: McpAppToolResult
  modelContext?: McpAppModelContext
  /** Private host consent state; not part of the AppBridge payload. */
  approvedTools?: McpAppToolApproval[]
  status: 'pending' | 'result' | 'cancelled' | 'error'
  error?: McpAppsErrorData
}

export function mcpAppResourceUri(tool: McpToolDescriptor): string | undefined {
  const uri = tool._meta?.ui?.resourceUri ?? tool._meta?.['ui/resourceUri']
  return typeof uri === 'string' && uri.startsWith('ui://') ? uri : undefined
}

export function mcpAppToolVisible(tool: McpToolDescriptor): boolean {
  return tool._meta?.ui?.visibility?.includes('app') ?? true
}

/** Keep an attachment within the data cap: an oversized input/result becomes an error, never a truncation. */
export function boundedToolAppAttachment(app: ToolAppAttachment): ToolAppAttachment {
  try {
    assertMcpAppSize({ toolInput: app.toolInput, toolResult: app.toolResult })
    return app
  } catch (error) {
    return { ...app, toolInput: undefined, toolResult: undefined, status: 'error', error: (error as McpAppsError).toJSON() }
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
