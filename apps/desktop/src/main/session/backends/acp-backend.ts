import type {
  AgentEvent,
  ContextUsageInfo,
  McpServerInfo,
  PermissionMode,
  QuestionAnnotations,
  RewindFilesResult,
  SandboxInfo,
  SendMessageRequest,
} from '@superone/shared/agent-types'
import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import log from '../../logger'
import { createAcpRuntime, type AcpRuntime, type AcpRuntimeOptions } from '../../acp/acp-runtime'
import { mapPermissionDecision, mapPermissionRequest, type PendingPermissionOptions } from '../../acp/acp-permission-map'
import type { BackendStartOptions, HarnessId, SessionBackend } from '../types'

export interface AcpBackendConfig {
  agentId?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export type AcpRuntimeFactory = (opts: AcpRuntimeOptions) => Promise<AcpRuntime>

function readConfig(raw: unknown): AcpBackendConfig {
  if (raw && typeof raw === 'object') return raw as AcpBackendConfig
  return {}
}

let runtimeFactory: AcpRuntimeFactory = createAcpRuntime

export function setAcpRuntimeFactory(factory: AcpRuntimeFactory | null): void {
  runtimeFactory = factory ?? createAcpRuntime
}

export class AcpBackend implements SessionBackend {
  readonly kind: HarnessId = 'acp'

  private started = false
  private disposed = false
  private startOpts: BackendStartOptions | null = null
  private config: AcpBackendConfig = {}
  private runtime: AcpRuntime | null = null
  private activePrompt: Promise<void> | null = null
  private interrupted = false
  private currentMessageId: string | null = null

  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()
  private permissionModeAppliedListeners = new Set<(mode: PermissionMode) => void>()

  private pendingPermissions = new Map<string, {
    resolve: (response: RequestPermissionResponse) => void
    options: PendingPermissionOptions[]
    event: AgentEvent
  }>()

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.started) throw new Error('AcpBackend already started')
    if (this.disposed) throw new Error('AcpBackend already disposed')
    this.startOpts = opts
    this.config = readConfig(opts.config)
    this.started = true
    log.info('[AcpBackend] start sid=%s agentId=%s', opts.sessionId, this.config.agentId ?? '(none)')
  }

  async rebuild(opts: BackendStartOptions): Promise<void> {
    await this.teardownRuntime()
    this.startOpts = opts
    this.config = readConfig(opts.config)
    this.started = true
    this.disposed = false
  }

  prewarm(_opts: BackendStartOptions): void {}

  private async ensureRuntime(): Promise<AcpRuntime> {
    if (this.runtime) return this.runtime
    if (!this.startOpts) throw new Error('AcpBackend missing startOpts')
    if (!this.config.agentId && !this.config.command) {
      throw new Error('No ACP agent configured. Pick an agent under Others, then try again.')
    }
    const runtime = await runtimeFactory({
      launch: {
        agentId: this.config.agentId,
        command: this.config.command,
        args: this.config.args,
        env: this.config.env,
        cwd: this.config.cwd,
        defaultCwd: this.startOpts.cwd || this.startOpts.projectPath,
      },
      permission: {
        request: (params) => this.handlePermissionRequest(params),
      },
    })
    this.runtime = runtime
    for (const cb of this.providerSessionIdListeners) {
      try { cb(runtime.sessionId) } catch (err) { log.warn('[AcpBackend] providerSessionId listener error:', err) }
    }
    return runtime
  }

  private handlePermissionRequest(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const { request, options } = mapPermissionRequest(params)
    const event: AgentEvent = { type: 'permission_request', request }
    return new Promise((resolve) => {
      this.pendingPermissions.set(request.requestId, { resolve, options, event })
      this.emit(event)
    })
  }

  async send(request: SendMessageRequest): Promise<void> {
    if (!this.started || this.disposed) throw new Error('AcpBackend not started')
    const messageId = request.assistantMessageId
      ?? `acp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.interrupted = false
    this.currentMessageId = messageId

    this.emit({
      type: 'message_start',
      message: {
        id: messageId,
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'acp',
      },
    })
    this.emit({ type: 'status_change', status: 'streaming' })

    let emittedTerminal = false
    const onEvent = (event: AgentEvent) => {
      if (
        event.type === 'message_complete'
        || event.type === 'message_interrupted'
        || event.type === 'message_error'
      ) {
        emittedTerminal = true
      }
      this.emit(event)
    }

    try {
      const runtime = await this.ensureRuntime()
      const turn = runtime.prompt(request.content, messageId, onEvent)
      this.activePrompt = turn
      await turn
    } catch (err) {
      if (this.interrupted) {
        if (!emittedTerminal) {
          this.emit({ type: 'message_interrupted', messageId })
          this.emit({ type: 'status_change', status: 'idle' })
        }
        return
      }
      if (!emittedTerminal) {
        const error = err instanceof Error ? err.message : String(err)
        this.emit({ type: 'message_error', messageId, error })
        this.emit({ type: 'status_change', status: 'error' })
      }
    } finally {
      this.activePrompt = null
      this.currentMessageId = null
    }
  }

  async interrupt(): Promise<void> {
    this.interrupted = true
    for (const [id, pending] of this.pendingPermissions) {
      pending.resolve({ outcome: { outcome: 'cancelled' } })
      this.pendingPermissions.delete(id)
    }
    try {
      await this.runtime?.cancel()
    } catch (err) {
      log.debug('[AcpBackend] interrupt cancel error:', err)
    }
  }

  private async teardownRuntime(): Promise<void> {
    for (const [id, pending] of this.pendingPermissions) {
      pending.resolve({ outcome: { outcome: 'cancelled' } })
      this.pendingPermissions.delete(id)
    }
    const runtime = this.runtime
    this.runtime = null
    if (runtime) {
      try { await runtime.close() } catch (err) { log.debug('[AcpBackend] runtime close error:', err) }
    }
  }

  async close(): Promise<void> {
    this.disposed = true
    this.started = false
    await this.teardownRuntime()
    this.startOpts = null
    this.eventListeners.clear()
    this.providerSessionIdListeners.clear()
    this.permissionModeAppliedListeners.clear()
  }

  async setModel(_model: string): Promise<void> {}

  async setPermissionMode(_mode: PermissionMode): Promise<void> {}

  async setSandbox(_sandboxInfo: SandboxInfo): Promise<void> {}

  respondToPermission(
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    _reason?: string,
    _selectedSuggestions?: number[],
    decision?: 'cancel',
  ): boolean {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return false
    this.pendingPermissions.delete(requestId)
    pending.resolve(mapPermissionDecision(pending.options, allow, alwaysAllow, decision))
    return true
  }

  respondToQuestion(
    _requestId: string,
    _answers: Record<string, string>,
    _annotations?: QuestionAnnotations,
  ): void {}

  dismissQuestion(_requestId: string): void {}

  respondToPlanApproval(_requestId: string, _approved: boolean, _feedback?: string): void {}

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    return null
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    return []
  }

  async rewindFiles(_userMessageId: string, _opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return { canRewind: false, error: 'ACP harness does not support rewind yet' }
  }

  async reconnectMcp(_serverName: string): Promise<void> {}

  async toggleMcpServer(_serverName: string, _enabled: boolean): Promise<void> {}

  async reloadMcpServers(): Promise<void> {}

  async reloadPlugins(): Promise<boolean> {
    return false
  }

  dequeueMessage(_clientMessageId: string): boolean {
    return false
  }

  getPendingInteractions(): AgentEvent[] {
    return Array.from(this.pendingPermissions.values()).map((p) => p.event)
  }

  onEvent(handler: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(handler)
    return () => this.eventListeners.delete(handler)
  }

  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionIdListeners.add(handler)
    return () => this.providerSessionIdListeners.delete(handler)
  }

  onPermissionModeApplied(handler: (mode: PermissionMode) => void): () => void {
    this.permissionModeAppliedListeners.add(handler)
    return () => this.permissionModeAppliedListeners.delete(handler)
  }

  private emit(event: AgentEvent): void {
    for (const cb of this.eventListeners) {
      try {
        cb(event)
      } catch (err) {
        log.warn('[AcpBackend] event listener error:', err)
      }
    }
  }
}
