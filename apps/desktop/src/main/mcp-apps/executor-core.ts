import { McpAppResourceCache, mcpAppResourceReadKey, type McpAppResourceSnapshot } from '@superone/shared/mcp-app-resource'
import { mcpAppPresentation, mcpAppResourceMeta } from '@superone/shared/mcp-apps-metadata'
import { mcpAppMessagePreview, mcpAppMessageTarget } from '@superone/shared/mcp-apps-content'
import { mcpAppServerTitle } from '@superone/shared/mcp-apps-metadata'
import { mcpAppContextState, removeMcpAppContextBlock } from '@superone/shared/mcp-app-model-context'
import { validateMcpAppAttachmentUpdate } from '@superone/shared/mcp-apps-state'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { McpUiDownloadFileRequestSchema, McpUiUpdateModelContextRequestSchema } from '@modelcontextprotocol/ext-apps/app-bridge'
import { McpAppMessageRequestSchema } from '@superone/shared/mcp-apps-host/message-schema'
import { parseSessionKey, type SessionRef } from '@superone/shared/environment/refs'
import type { McpAppsProviderRpcRequest, McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'
import { assertMcpAppSize, MCP_APP_HTML_MAX_BYTES, MCP_APP_OUTPUT_MAX_BYTES, MCP_APP_MIME_TYPE, McpAppsError } from '@superone/shared/mcp-apps'
import { isMcpAppHostResource, type McpAppResourceWriteParams, type McpAppResourceWriteResult } from '@superone/shared/mcp-app-files'
import type { McpAppDownloadContents, McpAppApprovalPrompt, McpAppAttachmentUpdate, McpAppHostOperation, McpAppHostRequest, McpAppHostResult, McpAppRequester, McpAppReadResult, McpAppsCallResult, McpAppsCapabilities, McpToolDescriptor, ToolAppAttachment } from '@superone/shared/mcp-apps'

export interface McpAppResolvedTarget {
  ref: SessionRef
  node: string
  projectPath: string
  messageId: string
  app: ToolAppAttachment
}

export interface McpAppExecutorPorts {
  resolve(ref: SessionRef, appInstanceId: string, messageId: string | undefined, signal: AbortSignal): Promise<McpAppResolvedTarget>
  persist(target: McpAppResolvedTarget, update: McpAppAttachmentUpdate, signal: AbortSignal): Promise<void>
  provider(target: McpAppResolvedTarget, operation: Omit<McpAppsProviderRpcRequest, 'binding' | 'origin'>, signal: AbortSignal): Promise<McpAppsRpcResult>
  sendMessage(target: McpAppResolvedTarget, params: Extract<McpAppHostOperation, { operation: 'sendMessage' }>['params'], requester: McpAppRequester, signal: AbortSignal): Promise<void>
  createMessageSession?(target: McpAppResolvedTarget, signal: AbortSignal): Promise<{ ref: SessionRef; projectPath: string }>
  hydrateResource?(target: McpAppResolvedTarget, signal: AbortSignal): Promise<McpAppResourceSnapshot>
  /** The opened file of a file-entrypoint View (`target.app.file`); never another URI. */
  hostResource?(target: McpAppResolvedTarget, request: HostResourceRequest, signal: AbortSignal): Promise<McpAppReadResult | McpAppResourceWriteResult | void>
  /** Request `_meta` added to a file-entrypoint View's tool calls (`openai/resource.path`). */
  fileToolMeta?(target: McpAppResolvedTarget): Record<string, unknown>
  /** `openai/files/open`: the existing file's real path, and whether it lies inside the session's project. */
  openFile?(target: McpAppResolvedTarget, path: string, signal: AbortSignal): Promise<{ path: string; insideProject: boolean }>
  /**
   * `ui/download-file`: ask where to save each item (the save dialog is the confirmation) and
   * write it. `read` fetches a non-http resource link from the View's own server.
   */
  downloadFile?(target: McpAppResolvedTarget, contents: McpAppDownloadContents, read: (uri: string, signal: AbortSignal) => Promise<McpAppReadResult>, signal: AbortSignal): Promise<{ isError?: boolean }>
  now?(): number
}

export type HostResourceRequest =
  | { kind: 'read'; uri: string; representation?: 'text' | 'blob' }
  | { kind: 'subscribe' | 'unsubscribe'; uri: string }
  | { kind: 'write'; params: McpAppResourceWriteParams }

/** Each item opens its own save dialog; a View cannot queue an unbounded series of them. */
const MCP_APP_DOWNLOAD_MAX_ITEMS = 8

function resourceUri(uri: unknown): string {
  if (typeof uri !== 'string' || !uri || uri.length > 2048) throw new McpAppsError('invalid', 'Invalid MCP App resource URI')
  try { new URL(uri) } catch { throw new McpAppsError('invalid', 'Invalid MCP App resource URI') }
  return uri
}

function jsonHash(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function unwrap<T>(result: McpAppsRpcResult): T {
  if (result.ok) return result.value as T
  throw new McpAppsError(result.error.code, result.error.message, result.error.challenge)
}

function operationOf(request: McpAppHostRequest): McpAppHostOperation {
  switch (request.operation) {
    case 'load':
      if (request.referenceOnly !== undefined && typeof request.referenceOnly !== 'boolean') throw new McpAppsError('invalid', 'Invalid MCP App resource load')
      return { operation: 'load', ...(request.referenceOnly ? { referenceOnly: true } : {}) }
    case 'activate': return { operation: 'activate' }
    case 'callTool':
      if (typeof request.tool !== 'string' || !request.tool || !request.args || typeof request.args !== 'object' || Array.isArray(request.args)) throw new McpAppsError('invalid', 'Invalid MCP App tool call')
      return { operation: 'callTool', tool: request.tool, args: request.args }
    case 'readResource': {
      if (request.representation !== undefined && request.representation !== 'text' && request.representation !== 'blob') throw new McpAppsError('invalid', 'Invalid MCP App resource representation')
      return { operation: 'readResource', uri: resourceUri(request.uri), ...(request.representation ? { representation: request.representation } : {}) }
    }
    case 'subscribeResource':
    case 'unsubscribeResource': return { operation: request.operation, uri: resourceUri(request.uri) }
    case 'writeResource': {
      const params = request.params as Partial<McpAppResourceWriteParams> | undefined
      const text = params?.text, blob = params?.blob, ifMatch = params?.ifMatch
      if ((typeof text === 'string') === (typeof blob === 'string') || (ifMatch !== undefined && (typeof ifMatch !== 'string' || !ifMatch))) throw new McpAppsError('invalid', 'Invalid MCP App resource write')
      return { operation: 'writeResource', params: { uri: resourceUri(params?.uri), ...(ifMatch ? { ifMatch } : {}), ...(typeof text === 'string' ? { text } : { blob: blob as string }) } }
    }
    case 'sendMessage': return { operation: 'sendMessage', params: McpAppMessageRequestSchema.parse({ method: 'ui/message', params: request.params }).params }
    case 'openFile':
      if (typeof request.path !== 'string' || !request.path || request.path.length > 4096 || !isAbsolute(request.path)) throw new McpAppsError('invalid', 'MCP App file paths must be absolute')
      return { operation: 'openFile', path: request.path }
    case 'downloadFile': {
      const { contents } = McpUiDownloadFileRequestSchema.parse({ method: 'ui/download-file', params: { contents: request.contents } }).params
      if (!contents.length || contents.length > MCP_APP_DOWNLOAD_MAX_ITEMS) throw new McpAppsError('invalid', 'Invalid MCP App download')
      return { operation: 'downloadFile', contents }
    }
    case 'sendPreparedMessage':
      if (typeof request.pendingSend !== 'string' || request.pendingSend.length > 128) throw new McpAppsError('invalid', 'Invalid MCP App pending message')
      return { operation: 'sendPreparedMessage', pendingSend: request.pendingSend }
    case 'updateModelContext': {
      const params = McpUiUpdateModelContextRequestSchema.parse({ method: 'ui/update-model-context', params: request.context }).params
      return { operation: 'updateModelContext', context: { ...(params.content ? { content: params.content } : {}), ...(params.structuredContent ? { structuredContent: params.structuredContent } : {}), source: { appInstanceId: '', server: '' } } }
    }
    case 'removeModelContext':
      if (typeof request.updateId !== 'string' || !request.updateId || request.updateId.length > 512 || (request.blockIndex !== undefined && (!Number.isInteger(request.blockIndex) || request.blockIndex < 0))) throw new McpAppsError('invalid', 'Invalid MCP App context removal')
      return { operation: 'removeModelContext', updateId: request.updateId, ...(request.blockIndex !== undefined ? { blockIndex: request.blockIndex } : {}) }
    default: throw new McpAppsError('invalid', 'Unknown MCP App host operation')
  }
}

interface Challenge { expires: number; key: string; binding: string; view: string; scope: string }
interface PendingMessage {
  expires: number; key: string; binding: string; bytes: number
  destination: { ref: SessionRef; projectPath: string }
  params: Extract<McpAppHostOperation, { operation: 'sendMessage' }>['params']
}

function requesterKey(requester: McpAppRequester): string {
  return requester.kind === 'desktop' ? 'desktop' : `mobile:${requester.deviceId}`
}

/** Host policy is shared by desktop IPC and paired-device requests. */
export class McpAppExecutor {
  private readonly resourceReads = new McpAppResourceCache()
  private readonly contextWrites = new Map<string, { tail: Promise<unknown>; pending: number }>()
  private pendingContextWrites = 0
  private readonly active = new Map<string, string>()
  private readonly challenges = new Map<string, Challenge>()
  private readonly messageTimes = new Map<string, number[]>()
  private readonly pendingSends = new Map<string, PendingMessage>()
  private readonly requests = new Set<{ ref: SessionRef; requester: string; abort: AbortController }>()
  constructor(private readonly ports: McpAppExecutorPorts) {}
  private now(): number { return this.ports.now?.() ?? Date.now() }
  private targetKey(ref: SessionRef, appInstanceId: string): string { return JSON.stringify([ref.environmentId, ref.sessionId, appInstanceId]) }
  private activeKey(ref: SessionRef, appInstanceId: string, requester: McpAppRequester): string { return JSON.stringify([this.targetKey(ref, appInstanceId), requesterKey(requester)]) }
  private bindingKey(app: ToolAppAttachment): string { return jsonHash({ binding: app.binding, origin: app.origin, resourceUri: app.resourceUri }) }

  private matchesTarget(key: string, ref: SessionRef): boolean {
    const [environmentId, sessionId] = JSON.parse(key) as string[]
    return environmentId === ref.environmentId && sessionId === ref.sessionId
  }

  private matchesScope(key: string, ref?: SessionRef, requester?: string): boolean {
    const [target, owner] = JSON.parse(key) as string[]
    return (!ref || this.matchesTarget(target, ref)) && (!requester || owner === requester)
  }

  /** A closed/deleted session cannot retain activation or pending approvals. */
  releaseSession(ref: SessionRef): void { this.releaseScope(ref) }

  /** Called only when this requester disconnects, not when one of its transports drops. */
  releaseRequester(requester: McpAppRequester): void { this.releaseScope(undefined, requesterKey(requester)) }

  private releaseScope(ref?: SessionRef, requester?: string): void {
    for (const key of this.active.keys()) if (this.matchesScope(key, ref, requester)) this.active.delete(key)
    for (const [id, value] of this.challenges) if (this.matchesScope(value.scope, ref, requester)) this.challenges.delete(id)
    for (const [id, value] of this.pendingSends) {
      if (this.matchesScope(value.key, ref, requester) || (ref && value.destination.ref.environmentId === ref.environmentId && value.destination.ref.sessionId === ref.sessionId)) this.pendingSends.delete(id)
    }
    if (ref) for (const key of this.messageTimes.keys()) if (this.matchesTarget(key, ref)) this.messageTimes.delete(key)
    for (const request of this.requests) {
      if ((!ref || (request.ref.environmentId === ref.environmentId && request.ref.sessionId === ref.sessionId)) && (!requester || request.requester === requester)) request.abort.abort()
    }
  }

  /** Expire idle rate/approval state; live activations have no age-based eviction. */
  sweepExpired(): void {
    const now = this.now()
    for (const [key, times] of this.messageTimes) {
      const recent = times.filter(time => time > now - 60_000)
      if (recent.length) this.messageTimes.set(key, recent)
      else this.messageTimes.delete(key)
    }
    for (const [id, value] of this.challenges) if (value.expires <= now) this.challenges.delete(id)
    for (const [id, value] of this.pendingSends) if (value.expires <= now) this.pendingSends.delete(id)
  }

  /** Only a new live provider event can auto-activate a View; replay/hydrate never calls this. */
  observeLive(ref: SessionRef, app: ToolAppAttachment, requester: McpAppRequester = { kind: 'desktop' }): void {
    this.active.set(this.activeKey(ref, app.appInstanceId, requester), this.bindingKey(app))
  }

  isActive(target: McpAppResolvedTarget, requester: McpAppRequester = { kind: 'desktop' }): boolean {
    return this.active.get(this.activeKey(target.ref, target.app.appInstanceId, requester)) === this.bindingKey(target.app)
  }

  async resolve(request: Pick<McpAppHostRequest, 'sessionKey' | 'appInstanceId' | 'messageId'>, signal: AbortSignal): Promise<McpAppResolvedTarget> {
    if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
    const ref = typeof request?.sessionKey === 'string' ? parseSessionKey(request.sessionKey) : null
    if (!ref || typeof request.appInstanceId !== 'string' || !request.appInstanceId) throw new McpAppsError('invalid', 'Scoped MCP App identity required')
    const target = await this.ports.resolve(ref, request.appInstanceId, request.messageId, signal)
    if (target.app.binding.node !== target.node || target.app.binding.session !== ref.sessionId) throw new McpAppsError('denied', 'MCP App node or session binding mismatch')
    return target
  }

  private async writeContext(request: McpAppHostRequest, operation: Extract<McpAppHostOperation, { operation: 'updateModelContext' | 'removeModelContext' }>, signal: AbortSignal, validateTarget?: (target: McpAppResolvedTarget) => void) {
    const key = JSON.stringify([request.sessionKey, request.appInstanceId])
    const queue = this.contextWrites.get(key) ?? { tail: Promise.resolve(), pending: 0 }
    if (queue.pending >= 32 || this.pendingContextWrites >= 1024) throw new McpAppsError('denied', 'Too many pending MCP App context updates')
    queue.pending++; this.pendingContextWrites++
    const write = queue.tail.catch(() => {}).then(async () => {
      const target = await this.resolve(request, signal)
      validateTarget?.(target)
      const source = { appInstanceId: target.app.appInstanceId, server: target.app.binding.server }
      let modelContext = operation.operation === 'removeModelContext'
        ? removeMcpAppContextBlock(target.app, operation.updateId, operation.blockIndex)
        : operation.context.content?.length || operation.context.structuredContent ? { ...operation.context, source } : null
      if (modelContext) {
        const previous = target.app.modelContext
        const unchanged = jsonHash({ content: previous?.content, structuredContent: previous?.structuredContent }) === jsonHash({ content: modelContext.content, structuredContent: modelContext.structuredContent })
        modelContext = { ...modelContext, source, updateId: unchanged && previous?.updateId ? previous.updateId : randomUUID() }
      }
      validateMcpAppAttachmentUpdate({ modelContext })
      await this.ports.persist(target, { modelContext }, signal)
      return { ok: true as const, value: mcpAppContextState({ ...target.app, modelContext }) }
    })
    queue.tail = write
    this.contextWrites.set(key, queue)
    try { return await write } finally {
      queue.pending--; this.pendingContextWrites--
      if (!queue.pending) this.contextWrites.delete(key)
    }
  }

  private async hydrateResource(target: McpAppResolvedTarget, signal: AbortSignal): Promise<McpAppResourceSnapshot> {
    if (target.app.resource?.html !== undefined) return target.app.resource as McpAppResourceSnapshot
    if (this.ports.hydrateResource) return this.ports.hydrateResource(target, signal)
    throw new McpAppsError('invalid', 'Saved MCP App HTML is unavailable')
  }

  private async readSnapshot(target: McpAppResolvedTarget, signal: AbortSignal): Promise<McpAppResourceSnapshot> {
    const result = unwrap<McpAppReadResult>(await this.ports.provider(target, { operation: 'readResource', uri: target.app.resourceUri }, signal))
    const resource = result.contents.find(value => value.uri === target.app.resourceUri && value.mimeType === MCP_APP_MIME_TYPE && typeof value.text === 'string')
    if (!resource?.text || new TextEncoder().encode(resource.text).byteLength > MCP_APP_HTML_MAX_BYTES) throw new McpAppsError('invalid', 'MCP App HTML is missing or exceeds the size limit')
    const current = await this.ports.resolve(target.ref, target.app.appInstanceId, target.messageId, signal)
    if (mcpAppResourceReadKey(current.app) !== mcpAppResourceReadKey(target.app)) throw new McpAppsError('inactive', 'MCP App resource binding changed')
    return { html: resource.text, meta: mcpAppResourceMeta(resource._meta), hash: createHash('sha256').update(resource.text).digest('hex') }
  }

  private async updatePresentation(target: McpAppResolvedTarget, signal: AbortSignal): Promise<void> {
    const tools = unwrap<McpToolDescriptor[]>(await this.ports.provider(target, { operation: 'tools' }, signal))
    const tool = tools.find(tool => tool.name === target.app.toolName)
    if (!tool || signal.aborted) return
    const current = await this.ports.resolve(target.ref, target.app.appInstanceId, target.messageId, signal)
    if (signal.aborted || this.bindingKey(current.app) !== this.bindingKey(target.app)) return
    await this.ports.persist(current, { presentation: mcpAppPresentation(tool) }, signal)
  }

  /**
   * Single-use approval bound to requester, View, binding and the exact operation. Returns the
   * `approval_required` answer to send, or nothing once `request.approval` matched.
   */
  private challenge(request: McpAppHostRequest, requester: McpAppRequester, target: McpAppResolvedTarget, operation: McpAppHostOperation, prompt: McpAppApprovalPrompt | undefined): McpAppHostResult | undefined {
    const view = this.targetKey(target.ref, target.app.appInstanceId)
    const binding = this.bindingKey(target.app)
    const key = jsonHash({ ref: target.ref, appInstanceId: target.app.appInstanceId, requester: requesterKey(requester), operation })
    if (request.approval) {
      const challenge = this.challenges.get(request.approval.challenge)
      this.challenges.delete(request.approval.challenge) // single use, even for an invalid confirmation
      if (!prompt || !challenge || challenge.key !== key || challenge.binding !== binding) throw new McpAppsError('denied', 'MCP App approval expired or does not match this request')
      return undefined
    }
    if (!prompt) return undefined
    const pendingForView = [...this.challenges.values()].filter(challenge => challenge.view === view).length
    if (pendingForView >= 8 || this.challenges.size >= 1024) throw new McpAppsError('denied', 'Too many pending MCP App approvals')
    const challenge = randomUUID()
    this.challenges.set(challenge, { expires: this.now() + 300_000, key, binding, view, scope: this.activeKey(target.ref, target.app.appInstanceId, requester) })
    return { ok: false, error: { code: 'approval_required', challenge, prompt } }
  }

  /** Opening a file needs no provider; only the host shows it, and paths outside the project are confirmed. */
  private async openFile(request: McpAppHostRequest, requester: McpAppRequester, target: McpAppResolvedTarget, path: string, signal: AbortSignal): Promise<McpAppHostResult> {
    if (requester.kind !== 'desktop' || target.node !== 'local' || !this.ports.openFile) throw new McpAppsError('denied', 'Opening local files is available only for local sessions on the desktop')
    const file = await this.ports.openFile(target, path, signal)
    if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
    const prompt: McpAppApprovalPrompt | undefined = file.insideProject ? undefined : { kind: 'openFile', server: mcpAppServerTitle(target.app), path: file.path }
    // Keyed by the resolved path, so a link swapped after the prompt cannot redirect the approval.
    const pending = this.challenge(request, requester, target, { operation: 'openFile', path: file.path }, prompt)
    return pending ?? { ok: true, value: { path: file.path } }
  }

  /** Saved on the desktop's own disk, so any desktop session may download; the phone does not offer it. */
  private async downloadFile(requester: McpAppRequester, target: McpAppResolvedTarget, contents: McpAppDownloadContents, signal: AbortSignal): Promise<McpAppHostResult> {
    if (requester.kind !== 'desktop' || !this.ports.downloadFile) throw new McpAppsError('denied', 'Downloads are available only on the desktop')
    const read = async (uri: string, signal: AbortSignal): Promise<McpAppReadResult> => {
      const value = unwrap<McpAppReadResult>(await this.ports.provider(target, { operation: 'readResource', uri: resourceUri(uri), transient: true }, signal))
      assertMcpAppSize(value, MCP_APP_OUTPUT_MAX_BYTES)
      return value
    }
    return { ok: true, value: await this.ports.downloadFile(target, contents, read, signal) }
  }

  async execute(request: McpAppHostRequest, requester: McpAppRequester, signal: AbortSignal, validateTarget?: (target: McpAppResolvedTarget) => void): Promise<McpAppHostResult> {
    const ref = typeof request?.sessionKey === 'string' ? parseSessionKey(request.sessionKey) : null
    const lifetime = ref ? { ref, requester: requesterKey(requester), abort: new AbortController() } : undefined
    if (lifetime) { this.requests.add(lifetime); signal = AbortSignal.any([signal, lifetime.abort.signal]) }
    try {
      this.sweepExpired()
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      if (requester.kind === 'mobile' && !requester.deviceId) throw new McpAppsError('denied', 'MCP App device identity required')
      const operation = operationOf(request)
      // A file save or download (base64 or escaped text) uses the transient View cap, like a read.
      assertMcpAppSize(operation, operation.operation === 'writeResource' || operation.operation === 'downloadFile' ? MCP_APP_OUTPUT_MAX_BYTES : undefined)
      const target = await this.resolve(request, signal)
      validateTarget?.(target)
      const ref = target.ref
      const key = this.targetKey(ref, target.app.appInstanceId)
      const activeKey = this.activeKey(ref, target.app.appInstanceId, requester)
      const binding = this.bindingKey(target.app)
      const file = target.app.file
      // A file-entrypoint View is not in the transcript: it cannot message the session or attach context.
      if (file && ['sendMessage', 'sendPreparedMessage', 'updateModelContext', 'removeModelContext'].includes(operation.operation)) throw new McpAppsError('denied', 'Apps opened on a file cannot message the conversation')
      if (!file && ['subscribeResource', 'unsubscribeResource', 'writeResource'].includes(operation.operation)) throw new McpAppsError('denied', 'Only an App opened on a file can subscribe to or write it')
      // Composer state can be removed from restored/offline history without waking the provider.
      if (operation.operation === 'removeModelContext') return await this.writeContext(request, operation, signal, validateTarget)
      if (operation.operation === 'sendPreparedMessage') {
        const pending = this.pendingSends.get(operation.pendingSend)
        this.pendingSends.delete(operation.pendingSend)
        if (requester.kind !== 'desktop' || !pending || pending.key !== activeKey || pending.binding !== binding) throw new McpAppsError('denied', 'MCP App pending message expired or does not match this View')
        await this.ports.sendMessage({ ...target, ...pending.destination }, pending.params, requester, signal)
        return { ok: true, value: {} }
      }
      let missingResource = false
      if (operation.operation === 'load' && target.app.resource) {
        if (operation.referenceOnly) return { ok: true, value: { hash: target.app.resource.hash, meta: target.app.resource.meta } }
        try { return { ok: true, value: await this.hydrateResource(target, signal) } }
        catch (error) { if (!(error instanceof McpAppsError) || error.code !== 'invalid') throw error; missingResource = true }
      }
      if (!target.app.origin?.providerSessionId) throw new McpAppsError('not_connected', 'MCP App provider origin unavailable')
      if (operation.operation !== 'activate' && this.active.get(activeKey) !== binding) throw new McpAppsError('inactive', 'Activate this restored MCP App to reconnect')
      if (operation.operation === 'openFile') return await this.openFile(request, requester, target, operation.path, signal)
      if (operation.operation === 'downloadFile') return await this.downloadFile(requester, target, operation.contents, signal)
      const capabilities = unwrap<McpAppsCapabilities>(await this.ports.provider(target, { operation: 'ready' }, signal))
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      if (capabilities.mode === 'unsupported') throw new McpAppsError('not_connected', 'This harness does not support MCP Apps')
      if (operation.operation === 'activate') {
        this.active.set(activeKey, binding)
        return { ok: true, value: capabilities }
      }

      let prompt: McpAppApprovalPrompt | undefined
      if (operation.operation === 'callTool') {
        if (!capabilities.toolCall) throw new McpAppsError('denied', 'MCP App tool calls are unavailable')
        // The shared provider dispatch gate checks app visibility immediately
        // before dispatch, for local and remote sessions alike.
      } else if (operation.operation === 'sendMessage') {
        const server = mcpAppServerTitle(target.app)
        const details = mcpAppMessagePreview(operation.params, server)
        if (details.target === 'new' && requester.kind === 'mobile') throw new McpAppsError('denied', 'Creating a new conversation from an MCP App is supported on desktop only; use target: active on phone')
        if (details.target === 'new' && !this.ports.createMessageSession) throw new McpAppsError('not_connected', 'MCP App new conversation routing is unavailable')
        prompt = { kind: 'sendMessage', server, ...details }
        assertMcpAppSize(prompt)
      }
      const pending = this.challenge(request, requester, target, operation, prompt)
      if (pending) return pending
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')

      switch (operation.operation) {
        case 'load': {
          if (!capabilities.resourceRead) throw new McpAppsError('denied', 'MCP App resources are unavailable')
          if (missingResource && target.app.resource) {
            const fetched = await this.readSnapshot(target, signal)
            if (fetched.hash !== target.app.resource.hash) throw new McpAppsError('invalid', 'Saved MCP App version is no longer available')
            const snapshot = { ...target.app.resource, html: fetched.html }
            await this.ports.persist(target, { resource: snapshot }, signal)
            return { ok: true, value: snapshot }
          }
          const readKey = mcpAppResourceReadKey(target.app)
          const cached = this.resourceReads.get(readKey)
          const snapshot = cached ?? await this.resourceReads.load(readKey, () => this.readSnapshot(target, signal))
          // Revalidation updates only the cache for later calls. This View keeps its fixed snapshot.
          if (cached) void this.resourceReads.refresh(readKey, () => this.readSnapshot(target, AbortSignal.timeout(15_000))).catch(() => {})
          const current = await this.ports.resolve(target.ref, target.app.appInstanceId, target.messageId, signal)
          validateTarget?.(current)
          if (mcpAppResourceReadKey(current.app) !== readKey) throw new McpAppsError('inactive', 'MCP App resource binding changed')
          if (current.app.resource) return { ok: true, value: operation.referenceOnly ? { hash: current.app.resource.hash, meta: current.app.resource.meta } : await this.hydrateResource(current, signal) }
          await this.ports.persist(current, { resource: snapshot }, signal)
          // Titles/icons are optional presentation, not document security. Cold
          // tool discovery must not delay first paint; its failure keeps the
          // fallback header. Resource metadata (including CSP) is already read.
          void this.updatePresentation(target, signal).catch(() => {})
          return { ok: true, value: operation.referenceOnly ? { hash: snapshot.hash, meta: snapshot.meta } : snapshot }
        }
        case 'readResource': {
          if (isMcpAppHostResource(operation.uri)) {
            if (!file || !this.ports.hostResource) throw new McpAppsError('denied', 'Host resources are unavailable to this App')
            const value = await this.ports.hostResource(target, { kind: 'read', uri: operation.uri, representation: operation.representation }, signal) as McpAppReadResult
            assertMcpAppSize(value, MCP_APP_OUTPUT_MAX_BYTES)
            return { ok: true, value }
          }
          if (!capabilities.resourceRead) throw new McpAppsError('denied', 'MCP App resources are unavailable')
          const value = unwrap<McpAppReadResult>(await this.ports.provider(target, { operation: 'readResource', uri: operation.uri, transient: true }, signal))
          assertMcpAppSize(value, MCP_APP_OUTPUT_MAX_BYTES)
          return { ok: true, value }
        }
        case 'callTool': {
          if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled before dispatch')
          let response: McpAppsRpcResult
          const meta = file ? this.ports.fileToolMeta?.(target) : undefined
          try { response = await this.ports.provider(target, { ...operation, ...(meta ? { meta } : {}) }, signal) }
          catch {
            // Only a missing transport reply is ambiguous. A structured provider
            // rejection can prove it failed before execution and must pass through.
            return { ok: true, value: { outcome: 'unknown_outcome', result: {
              content: [{ type: 'text', text: 'The result of this call is unknown. It was not retried.' }], isError: true,
            } } satisfies McpAppsCallResult }
          }
          if (!response.ok) return response
          const value = response.value as McpAppsCallResult
          assertMcpAppSize(value.result, MCP_APP_OUTPUT_MAX_BYTES)
          return { ok: true, value }
        }
        case 'updateModelContext': {
          return await this.writeContext(request, operation, signal, fresh => {
            validateTarget?.(fresh)
            if (this.bindingKey(fresh.app) !== binding) throw new McpAppsError('inactive', 'MCP App binding changed')
          })
        }
        case 'subscribeResource':
        case 'unsubscribeResource':
        case 'writeResource': {
          if (!this.ports.hostResource) throw new McpAppsError('denied', 'Host resources are unavailable to this App')
          const request: HostResourceRequest = operation.operation === 'writeResource' ? { kind: 'write', params: operation.params }
            : { kind: operation.operation === 'subscribeResource' ? 'subscribe' : 'unsubscribe', uri: operation.uri }
          return { ok: true, value: (await this.ports.hostResource(target, request, signal)) ?? {} }
        }
        case 'sendMessage': {
          const times = (this.messageTimes.get(key) ?? []).filter(time => time > this.now() - 60_000)
          if (times.length >= 3) throw new McpAppsError('denied', 'MCP App message rate limit reached')
          times.push(this.now())
          this.messageTimes.set(key, times)
          if (mcpAppMessageTarget(operation.params) === 'new') {
            const bytes = new TextEncoder().encode(JSON.stringify(operation.params)).byteLength
            if (this.pendingSends.size >= 64 || [...this.pendingSends.values()].reduce((total, pending) => total + pending.bytes, bytes) > 16 * 1024 * 1024) throw new McpAppsError('denied', 'Too many pending MCP App messages')
            const destination = await this.ports.createMessageSession!(target, signal)
            if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App message cancelled')
            const pendingSend = randomUUID()
            this.pendingSends.set(pendingSend, { expires: this.now() + 300_000, key: activeKey, binding, bytes, destination, params: operation.params })
            return { ok: true, value: { pendingSend, route: { projectPath: destination.projectPath, sessionId: destination.ref.sessionId } } }
          }
          await this.ports.sendMessage(target, operation.params, requester, signal)
          return { ok: true, value: {} }
        }

      }
      throw new McpAppsError('invalid', 'Unhandled MCP App host operation')
    } catch (error) {
      const data = error instanceof McpAppsError ? error.toJSON() : { code: 'invalid' as const, message: error instanceof Error ? error.message : String(error) }
      return { ok: false, error: data }
    } finally { if (lifetime) this.requests.delete(lifetime) }
  }
}
