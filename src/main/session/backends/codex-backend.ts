import type {
  AgentEvent,
  ContextUsageInfo,
  McpServerInfo,
  PermissionMode,
  QuestionAnnotations,
  RewindFilesResult,
  SendMessageRequest,
} from '../../../shared/agent-types'
import log from '../../logger'
import type { BackendStartOptions, HarnessId, SessionBackend } from '../types'

interface CodexConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  extraEnv?: Record<string, string>
  permissionPreset?: 'default' | 'full-access'
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
}

export class CodexBackend implements SessionBackend {
  readonly kind: HarnessId = 'codex'

  private started = false
  private disposed = false
  private providerSessionId: string | null = null
  private startOpts: BackendStartOptions | null = null

  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.started) throw new Error('CodexBackend already started')
    if (this.disposed) throw new Error('CodexBackend already disposed')
    this.startOpts = opts
    this.providerSessionId = opts.providerSessionId ?? null
    this.started = true
  }

  prewarm(_opts: BackendStartOptions): void {
    // Codex backend has no equivalent to Claude CLI subprocess warmup.
  }

  async rebuild(opts: BackendStartOptions): Promise<void> {
    if (!this.started) {
      await this.start(opts)
      return
    }
    this.startOpts = opts
  }

  async send(_request: SendMessageRequest): Promise<void> {
    this.assertStarted()
    throw new Error('CodexBackend.send not yet wired to Codex SDK (Phase 3 work)')
  }

  async interrupt(): Promise<void> {
    if (!this.started) return
    log.debug('[CodexBackend] interrupt called (not yet wired)')
  }

  async close(): Promise<void> {
    this.disposed = true
    this.started = false
    this.startOpts = null
    this.eventListeners.clear()
    this.providerSessionIdListeners.clear()
  }

  async setModel(_model: string): Promise<void> {
    this.assertStarted()
  }

  async setPermissionMode(_mode: PermissionMode): Promise<void> {
    this.assertStarted()
  }

  respondToPermission(_requestId: string, _allow: boolean): void {
    log.debug('[CodexBackend] respondToPermission not yet wired')
  }

  respondToQuestion(_requestId: string, _answers: Record<string, string>, _annotations?: QuestionAnnotations): void {
    log.debug('[CodexBackend] respondToQuestion not yet wired')
  }

  dismissQuestion(_requestId: string): void {
    log.debug('[CodexBackend] dismissQuestion not yet wired')
  }

  respondToPlanApproval(_requestId: string, _approved: boolean, _feedback?: string): void {
    log.debug('[CodexBackend] respondToPlanApproval not applicable to Codex')
  }

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    return null
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    return []
  }

  async rewindFiles(_userMessageId: string, _opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return { canRewind: false, error: 'rewindFiles not supported by Codex' }
  }

  async reconnectMcp(_serverName: string): Promise<void> {
    throw new Error('reconnectMcp not supported by Codex')
  }

  async toggleMcpServer(_serverName: string, _enabled: boolean): Promise<void> {
    throw new Error('toggleMcpServer not supported by Codex')
  }

  async reloadPlugins(): Promise<boolean> {
    return false
  }

  dequeueMessage(_clientMessageId: string): boolean {
    return false
  }

  getPendingInteractions(): AgentEvent[] {
    return []
  }

  onEvent(handler: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(handler)
    return () => { this.eventListeners.delete(handler) }
  }

  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionIdListeners.add(handler)
    return () => { this.providerSessionIdListeners.delete(handler) }
  }

  getCurrentProviderSessionId(): string | null {
    return this.providerSessionId
  }

  getStartOpts(): BackendStartOptions | null {
    return this.startOpts
  }

  emitForTest(event: AgentEvent): void {
    for (const cb of this.eventListeners) {
      try { cb(event) } catch (err) { log.warn('[CodexBackend] event listener error:', err) }
    }
  }

  private assertStarted(): void {
    if (!this.started) throw new Error('CodexBackend not started')
    if (this.disposed) throw new Error('CodexBackend already disposed')
  }

  readonly _configShape: CodexConfig = {}
}
