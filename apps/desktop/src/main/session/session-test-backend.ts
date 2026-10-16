import type { AgentEvent, SendMessageRequest } from '@superone/shared/agent-types'
import type { BackendStartOptions, SessionBackend } from './types'

export class FakeBackend implements SessionBackend {
  readonly kind = 'claude' as const

  started = false
  disposed = false
  startOpts: BackendStartOptions | null = null
  sendCalls: SendMessageRequest[] = []
  interruptCalls = 0
  startShouldFail: Error | null = null
  sendShouldFail: Error | null = null
  resolveStart: (() => void) | null = null
  startBlocked = false

  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()

  resolveSend: (() => void) | null = null
  resolveInterrupt: (() => void) | null = null

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.startShouldFail) throw this.startShouldFail
    if (this.startBlocked) {
      await new Promise<void>((resolve) => { this.resolveStart = resolve })
    }
    this.started = true
    this.activeRuntime = true
    this.startOpts = opts
  }

  prewarmCalls: BackendStartOptions[] = []
  activeRuntime = false
  releaseRuntimeCalls = 0
  hasActiveRuntime(): boolean { return this.activeRuntime }
  async releaseRuntime(): Promise<void> {
    this.releaseRuntimeCalls += 1
    this.activeRuntime = false
  }
  prewarm(opts: BackendStartOptions): void {
    this.prewarmCalls.push(opts)
    this.activeRuntime = true
  }

  rebuildCalls: BackendStartOptions[] = []
  async rebuild(opts: BackendStartOptions): Promise<void> {
    this.rebuildCalls.push(opts)
    this.activeRuntime = true
    this.startOpts = opts
  }

  dequeueMessage(_clientMessageId: string): boolean { return false }
  startQueuedMessagesCalls = 0
  async startQueuedMessages(): Promise<boolean> {
    this.startQueuedMessagesCalls += 1
    return true
  }
  pendingInteractions: AgentEvent[] = []
  getPendingInteractions(): AgentEvent[] { return this.pendingInteractions }

  commandCalls: import('./types').BackendCommand[] = []
  async handleCommand(cmd: import('./types').BackendCommand): Promise<void> {
    this.commandCalls.push(cmd)
  }

  async send(request: SendMessageRequest): Promise<void> {
    this.sendCalls.push(request)
    if (this.sendShouldFail) throw this.sendShouldFail
    await new Promise<void>((resolve) => { this.resolveSend = resolve })
  }

  realtimeCalls: import('@superone/shared/agent-types').RealtimeVoiceStartRequest[] = []
  async startRealtimeVoice(request: import('@superone/shared/agent-types').RealtimeVoiceStartRequest): Promise<void> {
    this.realtimeCalls.push(request)
    this.fireProviderSessionId('thread-realtime')
  }
  async stopRealtimeVoice(): Promise<void> {}
  async getRealtimeTimeline() {
    return { segments: [], threadMessages: [], activeRealtimeSessionId: null, hasTimeline: false }
  }

  async interrupt(): Promise<void> {
    this.interruptCalls++
    await new Promise<void>((resolve) => { this.resolveInterrupt = resolve })
  }

  async close(): Promise<void> {
    this.disposed = true
  }

  setModelCalls: string[] = []
  setModelOpts: Array<{ contextWindow?: number } | undefined> = []
  setModelError: Error | null = null
  async setModel(model: string, opts?: { contextWindow?: number }): Promise<void> {
    this.setModelCalls.push(model)
    this.setModelOpts.push(opts)
    if (this.setModelError) throw this.setModelError
  }
  setCodexSelectionCalls: Array<{
    model?: string | null
    reasoningEffort?: import('@superone/shared/agent-types').CodexReasoningEffort | null
    serviceTier?: string | null
  }> = []
  async setCodexSelection(selection: {
    model?: string | null
    reasoningEffort?: import('@superone/shared/agent-types').CodexReasoningEffort | null
    serviceTier?: string | null
  }): Promise<void> {
    this.setCodexSelectionCalls.push(selection)
  }
  setTitleCalls: string[] = []
  async setTitle(title: string): Promise<void> { this.setTitleCalls.push(title) }
  setSessionModeCalls: string[] = []
  async setSessionMode(modeId: string): Promise<void> {
    this.setSessionModeCalls.push(modeId)
  }
  setPermissionModeCalls: import('@superone/shared/agent-types').PermissionMode[] = []
  setPermissionModeError: Error | null = null
  async setPermissionMode(mode: import('@superone/shared/agent-types').PermissionMode): Promise<void> {
    this.setPermissionModeCalls.push(mode)
    if (this.setPermissionModeError) throw this.setPermissionModeError
  }
  setSandboxCalls: import('@superone/shared/agent-types').SandboxInfo[] = []
  async setSandbox(info: import('@superone/shared/agent-types').SandboxInfo): Promise<void> {
    this.setSandboxCalls.push(info)
  }
  setUltracodeCalls: boolean[] = []
  async setUltracode(enabled: boolean): Promise<void> {
    this.setUltracodeCalls.push(enabled)
  }
  requestSessionRecapCalls: boolean[] = []
  async requestSessionRecap(auto: boolean): Promise<boolean> {
    this.requestSessionRecapCalls.push(auto)
    return true
  }
  setAdditionalDirectoriesCalls: string[][] = []
  setAdditionalDirectoriesResult = true
  async setAdditionalDirectories(dirs: string[]): Promise<boolean> {
    this.setAdditionalDirectoriesCalls.push([...dirs])
    return this.setAdditionalDirectoriesResult
  }
  hasActiveBackgroundTasksResult = false
  hasActiveBackgroundTasks(): boolean {
    return this.hasActiveBackgroundTasksResult
  }
  hasScheduledWakeupsResult = false
  hasScheduledWakeups(): boolean {
    return this.hasScheduledWakeupsResult
  }
  stopTaskCalls: string[] = []
  async stopTask(taskId: string): Promise<void> {
    this.stopTaskCalls.push(taskId)
  }
  respondToPermissionCalls: Array<{
    requestId: string
    allow: boolean
    formAnswers?: Record<string, unknown>
  }> = []
  respondToPermissionResult = false
  respondToPermission(
    requestId: string,
    allow: boolean,
    _alwaysAllow?: boolean,
    _reason?: string,
    _selectedSuggestions?: number[],
    _decision?: 'cancel',
    formAnswers?: Record<string, unknown>,
  ): boolean {
    this.respondToPermissionCalls.push({ requestId, allow, formAnswers })
    return this.respondToPermissionResult
  }
  respondToQuestion(): void {}
  dismissQuestion(): void {}
  respondToPlanApproval(): void {}
  async getContextUsage() { return null }
  async getMcpServerStatus() { return [] }
  rewindFilesCalls: Array<{ id: string; opts?: { dryRun?: boolean; includeConversation?: boolean } }> = []
  async rewindFiles(id: string, opts?: { dryRun?: boolean; includeConversation?: boolean }) {
    this.rewindFilesCalls.push({ id, opts })
    return { canRewind: true, supportsCodeOnly: true }
  }
  rewindConversationCalls: string[] = []
  async rewindConversation(id: string) {
    this.rewindConversationCalls.push(id)
    return { canRewind: true, supportsCodeOnly: true }
  }
  async reconnectMcp(): Promise<void> {}
  async toggleMcpServer(): Promise<void> {}
  async reloadMcpServers(): Promise<void> {}
  async reloadPlugins(): Promise<boolean> { return false }

  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.eventListeners.add(handler)
    return () => { this.eventListeners.delete(handler) }
  }

  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionIdListeners.add(handler)
    return () => { this.providerSessionIdListeners.delete(handler) }
  }

  permissionModeAppliedListeners = new Set<(mode: import('@superone/shared/agent-types').PermissionMode) => void>()
  onPermissionModeApplied(handler: (mode: import('@superone/shared/agent-types').PermissionMode) => void): () => void {
    this.permissionModeAppliedListeners.add(handler)
    return () => { this.permissionModeAppliedListeners.delete(handler) }
  }

  firePermissionModeApplied(mode: import('@superone/shared/agent-types').PermissionMode): void {
    for (const cb of this.permissionModeAppliedListeners) cb(mode)
  }

  emit(event: AgentEvent): void {
    for (const cb of this.eventListeners) cb(event)
  }

  fireProviderSessionId(id: string): void {
    for (const cb of this.providerSessionIdListeners) cb(id)
  }
}
