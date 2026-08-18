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
import type { BackendEvent, BackendStartOptions, HarnessId, SessionBackend } from '../types'

/**
 * DeepSeek Harness backend — P0 skeleton.
 *
 * The real runtime embeds the dsh Cordis tree in-process and drives it through
 * `ctx.agents` (design: docs/draft/deepseek-harness-integration.md). Until P1
 * lands, every entry point reports "not implemented" honestly instead of
 * pretending a turn happened.
 */
export class DeepseekBackend implements SessionBackend {
  readonly kind: HarnessId = 'deepseek'
  private eventHandlers = new Set<(event: BackendEvent) => void>()
  private providerSessionIdHandlers = new Set<(id: string) => void>()
  private permissionModeHandlers = new Set<(mode: PermissionMode) => void>()

  hasActiveRuntime(): boolean {
    return false
  }

  async releaseRuntime(_reason: 'idle'): Promise<void> {}

  async start(_opts: BackendStartOptions): Promise<void> {}

  async rebuild(_opts: BackendStartOptions): Promise<void> {}

  prewarm(_opts: BackendStartOptions): void {}

  async send(_request: SendMessageRequest): Promise<void> {
    throw new Error('DeepSeek harness runtime is not implemented yet (P1)')
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {
    this.eventHandlers.clear()
    this.providerSessionIdHandlers.clear()
    this.permissionModeHandlers.clear()
  }

  async setModel(_model: string): Promise<void> {}

  async setSessionMode(_modeId: string): Promise<void> {}

  async setPermissionMode(_mode: PermissionMode): Promise<void> {}

  async setSandbox(_sandboxInfo: SandboxInfo): Promise<void> {}

  respondToPermission(): boolean {
    return false
  }

  respondToQuestion(_requestId: string, _answers: Record<string, string>, _annotations?: QuestionAnnotations): void {}

  dismissQuestion(_requestId: string): void {}

  respondToPlanApproval(_requestId: string, _approved: boolean, _feedback?: string): void {}

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    return null
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    return []
  }

  async rewindFiles(_userMessageId: string, _opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return { canRewind: false, error: 'DeepSeek harness does not support rewind yet' }
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

  onEvent(handler: (event: BackendEvent) => void): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionIdHandlers.add(handler)
    return () => this.providerSessionIdHandlers.delete(handler)
  }

  onPermissionModeApplied(handler: (mode: PermissionMode) => void): () => void {
    this.permissionModeHandlers.add(handler)
    return () => this.permissionModeHandlers.delete(handler)
  }
}
