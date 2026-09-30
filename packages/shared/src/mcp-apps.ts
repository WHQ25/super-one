/** Harness-neutral MCP Apps contracts. No runtime SDK or Electron dependency. */
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
  inputSchema: Record<string, unknown>
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
}

export interface McpAppsProvider {
  readonly binding: McpAppsBinding
  ready(signal: AbortSignal): Promise<McpAppsCapabilities>
  tools(): Promise<Map<string, McpToolDescriptor>>
  readResource(req: { uri: string; origin?: McpAppOrigin }, signal: AbortSignal): Promise<McpAppReadResult>
  callTool(req: { tool: string; args: unknown; origin?: McpAppOrigin }, signal: AbortSignal): Promise<McpAppsCallResult>
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

/** Apply before transport/persistence; reject rather than truncate protocol data. */
export function assertMcpAppSize(value: unknown, maxBytes = MCP_APP_DATA_MAX_BYTES): void {
  let json: string
  try { json = JSON.stringify(value) } catch { throw new McpAppsError('invalid', 'MCP App data must be JSON serializable') }
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > maxBytes) {
    throw new McpAppsError('invalid', 'MCP App data exceeds the size limit')
  }
}
