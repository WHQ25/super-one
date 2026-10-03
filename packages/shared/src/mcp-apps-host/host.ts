import { mcpAppResourceModes } from '../mcp-apps-metadata'
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { McpUiAppCapabilities, McpUiHostCapabilities, McpUiHostContext, McpUiRequestDisplayModeRequest } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolResultSchema, ErrorCode, McpError, ReadResourceResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { boundedToolAppAttachment, assertMcpAppSize, MCP_APP_OUTPUT_MAX_BYTES, McpAppsError } from '../mcp-apps'
import type { McpAppDownloadContents, McpAppMessageParams, McpAppModelContext, McpAppReadResult, McpAppsCallResult, ToolAppAttachment, McpUiResourceMeta } from '../mcp-apps'
import { McpAppMessageRequestSchema } from './message-schema'
import { mcpAppContextState, type McpAppModelContextState } from '../mcp-app-model-context'
import { createMcpAppDocument } from './document'
import { MCP_APP_RESOURCE_WRITE_MAX_BYTES, type McpAppResourceWriteParams, type McpAppResourceWriteResult } from '../mcp-app-files'
import type { McpAppDocument } from './document'

/** Implement approvals, leases, original-session routing and persistence behind this interface. */
export interface McpAppHostExecutor {
  callTool(request: { tool: string; args: Record<string, unknown> }, signal: AbortSignal): Promise<McpAppsCallResult>
  readResource(request: { uri: string; representation?: 'text' | 'blob' }, signal: AbortSignal): Promise<McpAppReadResult>
  /** File-entrypoint Views only (`openai/resource`). */
  subscribeResource?(request: { uri: string }, signal: AbortSignal): Promise<void>
  unsubscribeResource?(request: { uri: string }, signal: AbortSignal): Promise<void>
  writeResource?(request: McpAppResourceWriteParams, signal: AbortSignal): Promise<McpAppResourceWriteResult>
  /** `openai/files/open`; advertised only with `experimental["openai/files"]`. */
  openFile?(request: { path: string }, signal: AbortSignal): Promise<void>
  /** `ui/download-file`; advertised only with `downloadFile`. `isError` when the user cancels. */
  downloadFile?(contents: McpAppDownloadContents, signal: AbortSignal): Promise<{ isError?: boolean }>
  sendMessage(request: McpAppMessageParams, signal: AbortSignal): Promise<{ isError?: boolean }>
  updateModelContext(context: McpAppModelContext, signal: AbortSignal): Promise<McpAppModelContextState>
  openLink(request: { url: string }, signal: AbortSignal): Promise<{ isError?: boolean }>
  requestDisplayMode(mode: McpUiRequestDisplayModeRequest['params']['mode'], signal: AbortSignal): Promise<McpUiRequestDisplayModeRequest['params']['mode']>
}

export interface McpAppHostOptions {
  app: ToolAppAttachment
  resourceMeta?: McpUiResourceMeta
  transport: Transport
  executor: McpAppHostExecutor
  context: McpUiHostContext
  /** Advertise only implemented capabilities and actually granted permissions. */
  capabilities: McpUiHostCapabilities
  /** Share with the transport and iframe load/native navigation hooks. */
  document?: McpAppDocument
  restored?: boolean
  onInitialized?: () => void
  onError?: (error: unknown) => void
  onUnknownOutcome?: (response: McpAppsCallResult) => void
  onSizeChanged?: (size: { width?: number; height?: number }) => void
}

export interface McpAppHost {
  readonly document: McpAppDocument
  appCapabilities(): McpUiAppCapabilities | undefined
  connect(): Promise<void>
  /** Caller validates provider/account identity before opening this gate. */
  activate(): void
  update(app: ToolAppAttachment): Promise<void>
  updateContext(context: McpUiHostContext): void
  /** Forward a host file change to a View that subscribed to `uri`. */
  resourceUpdated(uri: string): void
  /** Synchronous gate close for navigation/unmount; outstanding executions are aborted. */
  revoke(): void
  dispose(): Promise<void>
}

/** Load this leaf lazily. Neither the shared contracts nor CSP import the SDK at runtime. */
export function createMcpAppHost(options: McpAppHostOptions): McpAppHost {
  const document = options.document ?? createMcpAppDocument()
  const initialContext = { ...options.context, 'openai/modelContext': mcpAppContextState(options.app) }
  const bridge = new AppBridge(null, { name: 'SuperOne', version: '1' }, options.capabilities, { hostContext: initialContext })
  const lifetime = new AbortController()
  let active = !options.restored
  let initialized = false
  let revoked = false
  let disposed: Promise<void> | undefined
  let app = boundedToolAppAttachment(options.app, true)
  let context = initialContext
  const contextChanged = (next: McpUiHostContext): void => {
    if (revoked) return
    // AppBridge retains this object for initialize; no notification may precede connect.
    if (!initialized) { Object.assign(initialContext, next); context = initialContext; return }
    context = next as typeof context
    bridge.setHostContext(next)
  }
  let sentInput = false
  let lastPartial = ''
  let lastResult = ''
  let sentCancelled = false
  let flush = Promise.resolve()
  const messageTimes: number[] = []
  const check = (): void => {
    if (revoked || !document.active) throw new McpAppsError('cancelled', 'MCP App view is closed')
    if (!initialized) throw new McpAppsError('denied', 'MCP App has not initialized')
    if (!active) throw new McpAppsError('inactive', 'Activate this restored MCP App to reconnect')
  }
  const execute = async <T>(signal: AbortSignal, fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const combined = AbortSignal.any([signal, lifetime.signal])
    try {
      check()
      if (combined.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      const value = await fn(combined)
      if (combined.aborted || revoked) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      return value
    } catch (error) {
      if (error instanceof McpAppsError && error.code === 'inactive') active = false
      // A policy refusal belongs to this request. Keep the View usable for
      // subsequent allowed calls; lifecycle/auth failures still reach the host.
      if (!revoked && !combined.aborted && !(error instanceof McpAppsError && error.code === 'denied')) options.onError?.(error)
      throw error
    }
  }
  bridge.oncalltool = (params, extra) => execute(extra.signal, async signal => {
    const request = { tool: params.name, args: params.arguments ?? {} }
    assertMcpAppSize(request)
    const response = await options.executor.callTool(request, signal)
    // Ambiguous outcomes stay host-only and are never automatically retried.
    if (response.outcome === 'unknown_outcome') options.onUnknownOutcome?.(response)
    assertMcpAppSize(response.result, MCP_APP_OUTPUT_MAX_BYTES)
    return CallToolResultSchema.parse(response.result)
  })
  bridge.onreadresource = (params, extra) => execute(extra.signal, async signal => {
    const representation = (params._meta?.['openai/resource'] as { representation?: unknown } | undefined)?.representation
    const result = await options.executor.readResource({ uri: params.uri, ...(representation === 'text' || representation === 'blob' ? { representation } : {}) }, signal)
    assertMcpAppSize(result, MCP_APP_OUTPUT_MAX_BYTES)
    return ReadResourceResultSchema.parse(result)
  })
  bridge.setRequestHandler(McpAppMessageRequestSchema, (request, extra) => execute(extra.signal, signal => {
    const params = request.params
    assertMcpAppSize(params)
    const now = Date.now()
    while (messageTimes.length && messageTimes[0] <= now - 60_000) messageTimes.shift()
    if (messageTimes.length >= 3) throw new McpAppsError('denied', 'MCP App message rate limit reached')
    messageTimes.push(now)
    // Executor confirms every request and uses the original session's normal send queue.
    return options.executor.sendMessage(params, signal)
  }))
  bridge.onupdatemodelcontext = (params, extra) => execute(extra.signal, async signal => {
    // Whitelist the two model-facing fields; never inject tool result _meta.
    const modelContext: McpAppModelContext = {
      ...(params.content ? { content: params.content } : {}),
      ...(params.structuredContent ? { structuredContent: params.structuredContent } : {}),
      source: { appInstanceId: app.appInstanceId, server: app.binding.server },
    }
    assertMcpAppSize(modelContext)
    const state = await options.executor.updateModelContext(modelContext, signal)
    app = { ...app, modelContext: state ? { ...state, source: modelContext.source } : null }
    contextChanged({ ...context, 'openai/modelContext': state })
    return { _meta: { 'openai/modelContext': { updateId: state?.updateId ?? crypto.randomUUID() } } }
  })
  bridge.onopenlink = (params, extra) => execute(extra.signal, signal => {
    let url: URL
    try { url = new URL(params.url) } catch { throw new McpAppsError('invalid', 'Invalid MCP App link') }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new McpAppsError('denied', 'Unsupported MCP App link')
    return options.executor.openLink({ url: url.href }, signal)
  })
  const { downloadFile } = options.executor
  if (options.capabilities.downloadFile && downloadFile) bridge.ondownloadfile = (params, extra) => execute(extra.signal, signal => {
    // Same bound as a file save: the View sends the bytes it wants saved.
    assertMcpAppSize(params, MCP_APP_OUTPUT_MAX_BYTES)
    return downloadFile(params.contents, signal)
  })
  bridge.onrequestdisplaymode = (params, extra) => execute(extra.signal, async signal => {
    const resourceModes = mcpAppResourceModes(options.resourceMeta ?? app.resource?.meta)
    const declared = bridge.getAppCapabilities()?.availableDisplayModes
    // A refused request reports the mode actually in effect.
    if ((resourceModes && !resourceModes.includes(params.mode)) || !context.availableDisplayModes?.includes(params.mode) || (declared && !declared.includes(params.mode))) return { mode: context.displayMode ?? 'inline' }
    return { mode: await options.executor.requestDisplayMode(params.mode, signal) }
  })
  // Resource subscriptions and writes exist only for the file a file-entrypoint View opened.
  const subscriptions = new Set<string>()
  const hostResources = !!options.capabilities.experimental?.['openai/resource']
  const openFiles = !!options.capabilities.experimental?.['openai/files']
  const { subscribeResource, unsubscribeResource, writeResource, openFile } = options.executor
  const uriOf = (params: unknown): string => {
    const uri = (params as { uri?: unknown } | undefined)?.uri
    if (typeof uri !== 'string' || !uri.trim() || uri.length > 2048) throw new McpError(ErrorCode.InvalidParams, 'Invalid resource URI')
    return uri
  }
  if (hostResources || openFiles) bridge.fallbackRequestHandler = async (request, extra) => {
    if (hostResources) switch (request.method) {
      case 'resources/subscribe': return execute(extra.signal, async signal => {
        const uri = uriOf(request.params)
        if (!subscribeResource) throw new McpAppsError('denied', 'Resource subscriptions are unavailable')
        await subscribeResource({ uri }, signal)
        subscriptions.add(uri)
        return {}
      })
      case 'resources/unsubscribe': return execute(extra.signal, async signal => {
        const uri = uriOf(request.params)
        subscriptions.delete(uri)
        await unsubscribeResource?.({ uri }, signal)
        return {}
      })
      case 'openai/resources/write': return execute(extra.signal, async signal => {
        const params = request.params as Record<string, unknown> | undefined
        const uri = uriOf(params)
        const ifMatch = params?.ifMatch
        const text = params?.text, blob = params?.blob
        if ((typeof text === 'string') === (typeof blob === 'string') || (ifMatch !== undefined && (typeof ifMatch !== 'string' || !ifMatch))) throw new McpError(ErrorCode.InvalidParams, 'Invalid resource write')
        const bytes = typeof text === 'string' ? new TextEncoder().encode(text).byteLength : Math.floor((blob as string).replace(/=+$/, '').length * 3 / 4)
        if (bytes > MCP_APP_RESOURCE_WRITE_MAX_BYTES) return { outcome: 'too-large', maxBytes: MCP_APP_RESOURCE_WRITE_MAX_BYTES }
        if (!writeResource) throw new McpAppsError('denied', 'Resource writes are unavailable')
        const write = { uri, ...(typeof ifMatch === 'string' ? { ifMatch } : {}), ...(typeof text === 'string' ? { text } : { blob: blob as string }) } as McpAppResourceWriteParams
        return await writeResource(write, signal)
      })
    }
    if (openFiles && request.method === 'openai/files/open') return execute(extra.signal, async signal => {
      const path = (request.params as { path?: unknown } | undefined)?.path
      if (typeof path !== 'string' || !path || path.length > 4096) throw new McpError(ErrorCode.InvalidParams, 'Invalid file path')
      if (!openFile) throw new McpAppsError('denied', 'Opening local files is unavailable')
      await openFile({ path }, signal)
      return {}
    })
    throw new McpError(ErrorCode.MethodNotFound, `Method not found: ${request.method}`)
  }
  bridge.onsizechange = size => {
    if (revoked || !initialized) return
    const width = Number.isFinite(size.width) && size.width! > 0 ? Math.min(size.width!, 4096) : undefined
    const height = Number.isFinite(size.height) && size.height! > 0 ? Math.min(size.height!, 4096) : undefined
    options.onSizeChanged?.({ width, height })
  }
  const send = async (): Promise<void> => {
    if (!initialized || revoked) return
    const current = app
    if (current.status === 'pending') {
      const partial = JSON.stringify(current.toolInput ?? {})
      if (!sentInput && partial !== lastPartial) {
        lastPartial = partial
        await bridge.sendToolInputPartial({ arguments: current.toolInput ?? {} })
      }
      return
    }
    if (!sentInput) {
      sentInput = true
      await bridge.sendToolInput({ arguments: current.toolInput ?? {} })
    }
    if (revoked) return
    if (current.status === 'cancelled' && !sentCancelled) {
      sentCancelled = true
      await bridge.sendToolCancelled({ reason: current.error?.message ?? 'Tool call cancelled' })
    } else if (current.toolResult || current.status === 'error') {
      // A provider/size/auth failure is terminal tool output, not a cancellation.
      const toolResult = current.toolResult ?? { content: [{ type: 'text', text: current.error?.message ?? 'Tool call failed' }], isError: true }
      const result = JSON.stringify(toolResult)
      if (result !== lastResult) {
        lastResult = result
        await bridge.sendToolResult(CallToolResultSchema.parse(toolResult))
      }
    }
  }
  const queue = (): Promise<void> => {
    flush = flush.then(send).catch(error => { if (!revoked) options.onError?.(error) })
    return flush
  }
  bridge.oninitialized = () => {
    if (revoked || initialized) return
    initialized = true
    options.onInitialized?.()
    void queue()
  }
  bridge.onerror = error => { if (!revoked) options.onError?.(error) }
  const revoke = (): void => {
    if (revoked) return
    revoked = true
    active = false
    lifetime.abort()
    document.revoke()
    // close() removes postMessage listeners synchronously, including during StrictMode remount.
    void bridge.close().catch(() => {})
  }
  document.onRevoke(revoke)
  return {
    document,
    appCapabilities: () => bridge.getAppCapabilities(),
    connect: () => bridge.connect(options.transport),
    activate() { if (!revoked) active = true },
    async update(next) {
      if (next.appInstanceId !== app.appInstanceId || JSON.stringify(next.binding) !== JSON.stringify(app.binding)) throw new McpAppsError('invalid', 'MCP App binding changed')
      app = boundedToolAppAttachment(next, true)
      contextChanged({ ...context, 'openai/modelContext': mcpAppContextState(app) })
      return queue()
    },
    updateContext(next) {
      contextChanged({ ...next, 'openai/modelContext': context['openai/modelContext'] })
    },
    resourceUpdated(uri) {
      if (revoked || !initialized || !subscriptions.has(uri)) return
      void bridge.notification({ method: 'notifications/resources/updated', params: { uri } } as never).catch(() => {})
    },
    revoke,
    dispose() {
      if (disposed) return disposed
      active = false
      lifetime.abort()
      disposed = (async () => {
        try { if (initialized && !revoked) await bridge.teardownResource({}, { timeout: 500 }) } catch { /* Best effort before removing the document. */ }
        finally { revoke() }
      })()
      return disposed
    },
  }
}

/** Retain this slot across component effects. Replace revokes the old document before connecting the next. */
export function createMcpAppHostSlot(): { replace(host: McpAppHost): void; release(host: McpAppHost): Promise<void> } {
  let current: McpAppHost | undefined
  return {
    replace(host) {
      if (current !== host) current?.revoke()
      current = host
    },
    async release(host) {
      // Keep the reference until dispose finishes so an immediate remount can close its transport.
      await host.dispose()
      if (current === host) current = undefined
    },
  }
}
