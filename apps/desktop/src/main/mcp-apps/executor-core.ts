import { createHash, randomUUID } from 'node:crypto'
import { McpUiMessageRequestSchema, McpUiUpdateModelContextRequestSchema } from '@modelcontextprotocol/ext-apps/app-bridge'
import { parseSessionKey, type SessionRef } from '@superone/shared/environment/refs'
import type { McpAppsProviderRpcRequest, McpAppsRpcResult } from '@superone/shared/environment/mcp-apps-rpc'
import { assertMcpAppSize, MCP_APP_HTML_MAX_BYTES, MCP_APP_MIME_TYPE, McpAppsError, mcpAppToolVisible } from '@superone/shared/mcp-apps'
import type { McpAppApprovalPrompt, McpAppAttachmentUpdate, McpAppHostOperation, McpAppHostRequest, McpAppHostResult, McpAppRequester, McpAppReadResult, McpAppsCallResult, McpAppsCapabilities, McpAppToolApproval, McpToolDescriptor, ToolAppAttachment } from '@superone/shared/mcp-apps'
import { mcpAppMessageAttachments, type McpAppMessage } from '@superone/shared/mcp-apps-state'

export interface McpAppResolvedTarget {
  ref: SessionRef
  node: string
  projectPath: string
  messageId: string
  app: ToolAppAttachment
  messages: readonly McpAppMessage[]
}

export interface McpAppExecutorPorts {
  resolve(ref: SessionRef, appInstanceId: string, messageId: string | undefined, signal: AbortSignal): Promise<McpAppResolvedTarget>
  persist(target: McpAppResolvedTarget, update: McpAppAttachmentUpdate, signal: AbortSignal): Promise<void>
  provider(target: McpAppResolvedTarget, operation: Omit<McpAppsProviderRpcRequest, 'binding' | 'origin'>, signal: AbortSignal): Promise<McpAppsRpcResult>
  sendMessage(target: McpAppResolvedTarget, params: Extract<McpAppHostOperation, { operation: 'sendMessage' }>['params'], requester: McpAppRequester, signal: AbortSignal): Promise<void>
  openLink(url: string): Promise<void>
  /** Read-only hints never confer trust by themselves. No trust policy means prompt. */
  trustedServer?(target: McpAppResolvedTarget): boolean
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
    case 'openLink': {
      let url: URL
      try { url = new URL(request.url) } catch { throw new McpAppsError('invalid', 'Invalid MCP App link') }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new McpAppsError('denied', 'Unsupported MCP App link')
      return { operation: 'openLink', url: url.href }
    }
    default: throw new McpAppsError('invalid', 'Unknown MCP App host operation')
  }
}

function approvalKey(app: ToolAppAttachment, tool: string): McpAppToolApproval {
  const { node, session, server, account, configFingerprint } = app.binding
  return { node, session, server, ...(account ? { account } : {}), configFingerprint, tool }
}

interface Challenge { expires: number; key: string; binding: string; prompt: McpAppApprovalPrompt }

/** Host policy is shared by desktop IPC and paired-device requests. */
export class McpAppExecutor {
  private readonly active = new Map<string, string>()
  private readonly challenges = new Map<string, Challenge>()
  private readonly messageTimes = new Map<string, number[]>()
  constructor(private readonly ports: McpAppExecutorPorts) {}
  private now(): number { return this.ports.now?.() ?? Date.now() }
  private targetKey(ref: SessionRef, appInstanceId: string): string { return JSON.stringify([ref.environmentId, ref.sessionId, appInstanceId]) }
  private bindingKey(app: ToolAppAttachment): string { return jsonHash({ binding: app.binding, origin: app.origin, resourceUri: app.resourceUri }) }

  /** Only a new live provider event can auto-activate a View; replay/hydrate never calls this. */
  observeLive(ref: SessionRef, app: ToolAppAttachment): void {
    this.active.set(this.targetKey(ref, app.appInstanceId), this.bindingKey(app))
  }

  async execute(request: McpAppHostRequest, requester: McpAppRequester, signal: AbortSignal): Promise<McpAppHostResult> {
    let dispatchedCall = false
    try {
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      const ref = typeof request?.sessionKey === 'string' ? parseSessionKey(request.sessionKey) : null
      if (!ref || typeof request.appInstanceId !== 'string' || !request.appInstanceId) throw new McpAppsError('invalid', 'Scoped MCP App identity required')
      if (requester.kind === 'mobile' && !requester.deviceId) throw new McpAppsError('denied', 'MCP App device identity required')
      const operation = operationOf(request)
      assertMcpAppSize(operation)
      const target = await this.ports.resolve(ref, request.appInstanceId, request.messageId, signal)
      if (target.app.binding.node !== target.node || target.app.binding.session !== ref.sessionId) throw new McpAppsError('denied', 'MCP App node or session binding mismatch')
      const key = this.targetKey(ref, target.app.appInstanceId)
      const binding = this.bindingKey(target.app)
      if (operation.operation === 'load' && target.app.resource) return { ok: true, value: target.app.resource }
      if (!target.app.origin?.providerSessionId) throw new McpAppsError('not_connected', 'MCP App provider origin unavailable')
      if (operation.operation !== 'activate' && this.active.get(key) !== binding) throw new McpAppsError('denied', 'Activate this restored MCP App to reconnect')
      const capabilities = unwrap<McpAppsCapabilities>(await this.ports.provider(target, { operation: 'ready' }, signal))
      if (signal.aborted) throw new McpAppsError('cancelled', 'MCP App request cancelled')
      if (capabilities.mode === 'unsupported') throw new McpAppsError('not_connected', 'This harness does not support MCP Apps')
      if (operation.operation === 'activate') {
        this.active.set(key, binding)
        return { ok: true, value: capabilities }
      }

      let prompt: McpAppApprovalPrompt | undefined
      let tool: McpToolDescriptor | undefined
      let remembered = false
      if (operation.operation === 'callTool') {
        if (!capabilities.toolCall) throw new McpAppsError('denied', 'MCP App tool calls are unavailable')
        const tools = unwrap<McpToolDescriptor[]>(await this.ports.provider(target, { operation: 'tools' }, signal))
        tool = tools.find(value => value.name === operation.tool)
        if (!tool || !mcpAppToolVisible(tool)) throw new McpAppsError('denied', 'This tool is not available to the App')
        const consentKey = jsonHash(approvalKey(target.app, operation.tool))
        remembered = target.messages.some(message => mcpAppMessageAttachments(message).some(app => app.approvedTools?.some(approval => jsonHash(approval) === consentKey)))
        if (!remembered && !(tool.annotations?.readOnlyHint === true && this.ports.trustedServer?.(target) === true)) prompt = {
          kind: 'callTool', server: target.app.binding.server, tool: operation.tool,
          ...(typeof tool.annotations?.title === 'string' ? { toolTitle: tool.annotations.title } : {}),
          argsPreview: preview(JSON.stringify(operation.args, null, 2), 2048), rememberable: true,
        }
      } else if (operation.operation === 'sendMessage') {
        prompt = { kind: 'sendMessage', server: target.app.binding.server,
          text: preview(operation.params.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'), 4096),
          nonTextBlocks: operation.params.content.filter(block => block.type !== 'text').length }
      } else if (operation.operation === 'openLink') {
        if (requester.kind !== 'desktop') throw new McpAppsError('denied', 'Open links on the device showing this View')
        prompt = { kind: 'openLink', server: target.app.binding.server, url: operation.url }
      }
      const challengeKey = jsonHash({ ref, appInstanceId: target.app.appInstanceId, requester, operation })
      for (const [id, challenge] of this.challenges) if (challenge.expires <= this.now()) this.challenges.delete(id)
      if (request.approval) {
        const challenge = this.challenges.get(request.approval.challenge)
        this.challenges.delete(request.approval.challenge) // single use, even for an invalid confirmation
        if (!prompt || !challenge || challenge.key !== challengeKey || challenge.binding !== binding) throw new McpAppsError('denied', 'MCP App approval expired or does not match this request')
        if (request.approval.remember && operation.operation !== 'callTool') throw new McpAppsError('invalid', 'Only tool approvals can be remembered')
      } else if (prompt) {
        if (this.challenges.size >= 128) throw new McpAppsError('denied', 'Too many pending MCP App approvals')
        const challenge = randomUUID()
        this.challenges.set(challenge, { expires: this.now() + 300_000, key: challengeKey, binding, prompt })
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
          if (request.approval?.remember && !remembered) {
            const approvedTools = [...(target.app.approvedTools ?? []), approvalKey(target.app, operation.tool)]
            if (approvedTools.length > 64) throw new McpAppsError('denied', 'MCP App session approval limit reached')
            await this.ports.persist(target, { approvedTools }, signal)
          }
          dispatchedCall = true
          const value = unwrap<McpAppsCallResult>(await this.ports.provider(target, operation, signal))
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
        case 'openLink':
          await this.ports.openLink(operation.url)
          return { ok: true, value: {} }
      }
    } catch (error) {
      const data = error instanceof McpAppsError ? error.toJSON() : { code: 'invalid' as const, message: error instanceof Error ? error.message : String(error) }
      if (dispatchedCall && ['timeout', 'cancelled', 'not_connected', 'unknown_outcome'].includes(data.code)) return { ok: true, value: {
        outcome: 'unknown_outcome', result: { content: [{ type: 'text', text: 'The result of this call is unknown. It was not retried.' }], isError: true },
      } satisfies McpAppsCallResult }
      return { ok: false, error: data }
    }
  }
}
