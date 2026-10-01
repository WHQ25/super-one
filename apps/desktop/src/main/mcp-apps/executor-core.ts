import { createHash, randomUUID } from 'node:crypto'
import { McpUiMessageRequestSchema, McpUiUpdateModelContextRequestSchema } from '@modelcontextprotocol/ext-apps/app-bridge'
import { parseSessionKey, type SessionRef } from '@superone/shared/environment/refs'
import type { McpAppsProviderRpcRequest, McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'
import { assertMcpAppSize, MCP_APP_HTML_MAX_BYTES, MCP_APP_MIME_TYPE, McpAppsError, mcpAppToolVisible } from '@superone/shared/mcp-apps'
import type { McpAppApprovalPrompt, McpAppAttachmentUpdate, McpAppHostOperation, McpAppHostRequest, McpAppHostResult, McpAppRequester, McpAppReadResult, McpAppsCallResult, McpAppsCapabilities, McpToolDescriptor, ToolAppAttachment } from '@superone/shared/mcp-apps'

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
  now?(): number
}

function jsonHash(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

/** UTF-8 byte cap for plain-text approval previews, without splitting a character. */
function preview(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength <= maxBytes) return text
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, maxBytes - 3)).replace(/\uFFFD$/, '') + '…'
}

function unwrap<T>(result: McpAppsRpcResult): T {
  if (result.ok) return result.value as T
  throw new McpAppsError(result.error.code, result.error.message, result.error.challenge)
}

function operationOf(request: McpAppHostRequest): McpAppHostOperation {
  switch (request.operation) {
    case 'load': case 'activate': return { operation: request.operation }
    case 'callTool':
      if (typeof request.tool !== 'string' || !request.tool || !request.args || typeof request.args !== 'object' || Array.isArray(request.args)) throw new McpAppsError('invalid', 'Invalid MCP App tool call')
      return { operation: 'callTool', tool: request.tool, args: request.args }
    case 'readResource':
      if (typeof request.uri !== 'string' || !request.uri) throw new McpAppsError('invalid', 'Invalid MCP App resource URI')
      try { new URL(request.uri) } catch { throw new McpAppsError('invalid', 'Invalid MCP App resource URI') }
      return { operation: 'readResource', uri: request.uri }
    case 'sendMessage': return { operation: 'sendMessage', params: McpUiMessageRequestSchema.parse({ method: 'ui/message', params: request.params }).params }
    case 'updateModelContext': {
      const params = McpUiUpdateModelContextRequestSchema.parse({ method: 'ui/update-model-context', params: request.context }).params
      return { operation: 'updateModelContext', context: { ...(params.content ? { content: params.content } : {}), ...(params.structuredContent ? { structuredContent: params.structuredContent } : {}), source: { appInstanceId: '', server: '' } } }
    }
    default: throw new McpAppsError('invalid', 'Unknown MCP App host operation')
  }
}

interface Challenge { expires: number; key: string; binding: string; view: string }

function requesterKey(requester: McpAppRequester): string {
  return requester.kind === 'desktop' ? 'desktop' : `mobile:${requester.deviceId}`
}

/** Host policy is shared by desktop IPC and paired-device requests. */
export class McpAppExecutor {
  private readonly active = new Map<string, string>()
  private readonly challenges = new Map<string, Challenge>()
  private readonly messageTimes = new Map<string, number[]>()
  constructor(private readonly ports: McpAppExecutorPorts) {}
  private now(): number { return this.ports.now?.() ?? Date.now() }
  private targetKey(ref: SessionRef, appInstanceId: string): string { return JSON.stringify([ref.environmentId, ref.sessionId, appInstanceId]) }
  private activeKey(ref: SessionRef, appInstanceId: string, requester: McpAppRequester): string { return JSON.stringify([this.targetKey(ref, appInstanceId), requesterKey(requester)]) }
  private bindingKey(app: ToolAppAttachment): string { return jsonHash({ binding: app.binding, origin: app.origin, resourceUri: app.resourceUri }) }

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

  async execute(request: McpAppHostRequest, requester: McpAppRequester, signal: AbortSignal, validateTarget?: (target: McpAppResolvedTarget) => void): Promise<McpAppHostResult> {
    try {
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      if (requester.kind === 'mobile' && !requester.deviceId) throw new McpAppsError('denied', 'MCP App device identity required')
      const operation = operationOf(request)
      assertMcpAppSize(operation)
      const target = await this.resolve(request, signal)
      validateTarget?.(target)
      const ref = target.ref
      const key = this.targetKey(ref, target.app.appInstanceId)
      const activeKey = this.activeKey(ref, target.app.appInstanceId, requester)
      const binding = this.bindingKey(target.app)
      if (operation.operation === 'load' && target.app.resource) return { ok: true, value: target.app.resource }
      if (!target.app.origin?.providerSessionId) throw new McpAppsError('not_connected', 'MCP App provider origin unavailable')
      if (operation.operation !== 'activate' && this.active.get(activeKey) !== binding) throw new McpAppsError('inactive', 'Activate this restored MCP App to reconnect')
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
        const tools = unwrap<McpToolDescriptor[]>(await this.ports.provider(target, { operation: 'tools' }, signal))
        const tool = tools.find(value => value.name === operation.tool)
        if (!tool || !mcpAppToolVisible(tool)) throw new McpAppsError('denied', 'This tool is not available to the App')
      } else if (operation.operation === 'sendMessage') {
        prompt = { kind: 'sendMessage', server: target.app.binding.server,
          text: preview(operation.params.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'), 4096),
          nonTextBlocks: operation.params.content.filter(block => block.type !== 'text').length }
      }
      const challengeKey = jsonHash({ ref, appInstanceId: target.app.appInstanceId, requester: requesterKey(requester), operation })
      for (const [id, challenge] of this.challenges) if (challenge.expires <= this.now()) this.challenges.delete(id)
      if (request.approval) {
        const challenge = this.challenges.get(request.approval.challenge)
        this.challenges.delete(request.approval.challenge) // single use, even for an invalid confirmation
        if (!prompt || !challenge || challenge.key !== challengeKey || challenge.binding !== binding) throw new McpAppsError('denied', 'MCP App approval expired or does not match this request')
      } else if (prompt) {
        const pendingForView = [...this.challenges.values()].filter(challenge => challenge.view === key).length
        if (pendingForView >= 8 || this.challenges.size >= 1024) throw new McpAppsError('denied', 'Too many pending MCP App approvals')
        const challenge = randomUUID()
        this.challenges.set(challenge, { expires: this.now() + 300_000, key: challengeKey, binding, view: key })
        return { ok: false, error: { code: 'approval_required', challenge, prompt } }
      }
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')

      switch (operation.operation) {
        case 'load': {
          if (!capabilities.resourceRead) throw new McpAppsError('denied', 'MCP App resources are unavailable')
          const result = unwrap<McpAppReadResult>(await this.ports.provider(target, { operation: 'readResource', uri: target.app.resourceUri }, signal))
          const resource = result.contents.find(value => value.uri === target.app.resourceUri && value.mimeType === MCP_APP_MIME_TYPE && typeof value.text === 'string')
          if (!resource?.text || new TextEncoder().encode(resource.text).byteLength > MCP_APP_HTML_MAX_BYTES) throw new McpAppsError('invalid', 'MCP App HTML is missing or exceeds the size limit')
          const snapshot = { html: resource.text, meta: (resource._meta?.ui ?? resource._meta ?? {}) as NonNullable<ToolAppAttachment['resource']>['meta'], hash: createHash('sha256').update(resource.text).digest('hex') }
          await this.ports.persist(target, { resource: snapshot }, signal)
          return { ok: true, value: snapshot }
        }
        case 'readResource': {
          if (!capabilities.resourceRead) throw new McpAppsError('denied', 'MCP App resources are unavailable')
          const value = unwrap<McpAppReadResult>(await this.ports.provider(target, operation, signal))
          assertMcpAppSize(value)
          return { ok: true, value }
        }
        case 'callTool': {
          if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled before dispatch')
          let response: McpAppsRpcResult
          try { response = await this.ports.provider(target, operation, signal) }
          catch {
            // Only a missing transport reply is ambiguous. A structured provider
            // rejection can prove it failed before execution and must pass through.
            return { ok: true, value: { outcome: 'unknown_outcome', result: {
              content: [{ type: 'text', text: 'The result of this call is unknown. It was not retried.' }], isError: true,
            } } satisfies McpAppsCallResult }
          }
          if (!response.ok) return response
          const value = response.value as McpAppsCallResult
          assertMcpAppSize(value)
          return { ok: true, value }
        }
        case 'updateModelContext': {
          const modelContext = { ...operation.context, source: { appInstanceId: target.app.appInstanceId, server: target.app.binding.server } }
          await this.ports.persist(target, { modelContext }, signal)
          return { ok: true, value: null }
        }
        case 'sendMessage': {
          const times = (this.messageTimes.get(key) ?? []).filter(time => time > this.now() - 60_000)
          if (times.length >= 3) throw new McpAppsError('denied', 'MCP App message rate limit reached')
          times.push(this.now())
          this.messageTimes.set(key, times)
          await this.ports.sendMessage(target, operation.params, requester, signal)
          return { ok: true, value: {} }
        }

      }
    } catch (error) {
      const data = error instanceof McpAppsError ? error.toJSON() : { code: 'invalid' as const, message: error instanceof Error ? error.message : String(error) }
      return { ok: false, error: data }
    }
  }
}
