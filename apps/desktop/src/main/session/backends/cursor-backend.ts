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
import type { BackendStartOptions, HarnessId, SessionBackend } from '../types'

/**
 * PR1 skeleton: registers Cursor as a first-class harness.
 * Runtime / @cursor/sdk wiring lands in PR2–PR3 (see docs/design/cursor-sdk-harness.md).
 */
export class CursorBackend implements SessionBackend {
  readonly kind: HarnessId = 'cursor'

  private disposed = false
  private permissionMode: PermissionMode = 'default'
  private eventListeners = new Set<(event: AgentEvent) => void>()
  private providerSessionListeners = new Set<(id: string) => void>()
  private permissionModeListeners = new Set<(mode: PermissionMode) => void>()

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.disposed) throw new Error('CursorBackend already disposed')
    this.permissionMode = opts.permissionMode
  }

  async rebuild(opts: BackendStartOptions): Promise<void> {
    this.disposed = false
    await this.start(opts)
  }

  prewarm(opts: BackendStartOptions): void {
    if (this.disposed) return
    this.permissionMode = opts.permissionMode
  }

  async send(_request: SendMessageRequest): Promise<void> {
    throw new Error(
      'Cursor harness is not ready yet — @cursor/sdk runtime ships in a later PR (see docs/design/cursor-sdk-harness.md PR3).',
    )
  }

  async interrupt(): Promise<void> {
    // no-op until runtime
  }

  async close(): Promise<void> {
    this.disposed = true
    this.eventListeners.clear()
    this.providerSessionListeners.clear()
    this.permissionModeListeners.clear()
  }

  async setModel(_model: string): Promise<void> {
    // no-op until runtime
  }

  async setSessionMode(_modeId: string): Promise<void> {
    // Cursor plan/agent mode maps via create/send options later
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionMode = mode
    for (const listener of this.permissionModeListeners) listener(mode)
  }

  async setSandbox(_sandboxInfo: SandboxInfo): Promise<void> {
    // Mapped to local.sandboxOptions on Agent.create in PR6
  }

  respondToPermission(): boolean {
    return false
  }

  respondToQuestion(
    _requestId: string,
    _answers: Record<string, string>,
    _annotations?: QuestionAnnotations,
  ): void {
    // SDK has no Claude-style ask prompts in public surface
  }

  dismissQuestion(_requestId: string): void {}

  respondToPlanApproval(_requestId: string, _approved: boolean, _feedback?: string): void {}

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    // D8: no context window from SDK TokenUsage
    return null
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    return []
  }

  async rewindFiles(_userMessageId: string, _opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return { canRewind: false, filesChanged: [], insertions: 0, deletions: 0 }
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
    return []
  }

  onEvent(handler: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(handler)
    return () => {
      this.eventListeners.delete(handler)
    }
  }

  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionListeners.add(handler)
    return () => {
      this.providerSessionListeners.delete(handler)
    }
  }

  onPermissionModeApplied(handler: (mode: PermissionMode) => void): () => void {
    this.permissionModeListeners.add(handler)
    return () => {
      this.permissionModeListeners.delete(handler)
    }
  }
}
