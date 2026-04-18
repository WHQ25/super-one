import type {
  AgentEvent,
  ChatMessage,
  CodexUsageInfo,
  ContextUsageInfo,
  McpServerInfo,
  PermissionMode,
  QuestionAnnotations,
  RewindFilesResult,
  SandboxInfo,
  SandboxMode,
  SendMessageRequest,
} from '../../shared/agent-types'
import log from '../logger'
import { trace } from '../agent/event-trace'
import {
  applyClaudeEventToRuntime,
  buildClaudeUserMessage,
  extractClaudeTitle,
  type ClaudeSessionRuntime,
  type TaskProgressEntry,
} from '../agent/claude-session-runtime'
import {
  applyCodexEventToRuntime,
  extractCodexTitle,
  finalizeCodexAssistantMessage,
  type CodexSessionRuntime,
} from '../agent/codex-session-runtime'
import type {
  BackendCommand,
  BackendStartOptions,
  HarnessId,
  PrewarmHint,
  ProjectResources,
  Session as SessionContract,
  SessionBackend,
  SessionSnapshot,
  SessionStateChange,
  SessionStatus,
} from './types'

export interface SessionConstructorOptions {
  id: string
  projectPath: string
  cwd: string
  providerId: string
  harnessId: HarnessId
  providerConfig: unknown
  backend: SessionBackend
  permissionMode?: PermissionMode
  sandboxInfo?: SandboxInfo
  effort?: SendMessageRequest['effort']
  model?: string
  additionalDirectories?: string[]
  title?: string | null
  createdAt?: number
  resumedProviderSessionId?: string
  initialMessages?: ChatMessage[]
  initialTotalCostUsd?: number
  initialContextTokens?: number
  homedir?: string
  getProjectResources?: (cwd: string) => ProjectResources
  invalidateProjectResources?: (cwd: string) => void
  onStateChange?: (snapshot: SessionStateChange) => void
  onProviderSessionIdChange?: (sid: string, providerSessionId: string) => void
}

const DEFAULT_SANDBOX: SandboxInfo = { enabled: true, autoAllowBash: false }

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const as = [...a].sort()
  const bs = [...b].sort()
  for (let i = 0; i < as.length; i++) if (as[i] !== bs[i]) return false
  return true
}

export class Session implements SessionContract {
  readonly id: string
  readonly projectPath: string
  readonly providerId: string
  readonly harnessId: HarnessId
  readonly createdAt: number

  private _cwd: string
  get cwd(): string { return this._cwd }

  private backend: SessionBackend
  private providerConfig: unknown

  private _status: SessionStatus = 'idle'
  private _sendChain: Promise<void> = Promise.resolve()
  private _currentMessageId: string | null = null
  private _providerSessionId: string | null = null
  private _lastUserMessageAt: number | null = null
  private _needsRebuild = false

  private _messages: ChatMessage[] = []
  private _totalCostUsd = 0
  private _contextTokens = 0
  private _taskProgress: Record<string, TaskProgressEntry> = {}
  private _streamingTokensByMessageId: Record<string, { input: number; output: number }> = {}
  private _lastUsageByMessageId: Record<string, CodexUsageInfo | null> = {}

  private permissionMode: PermissionMode
  private sandboxInfo: SandboxInfo
  private effort: SendMessageRequest['effort']
  private model: string | undefined
  private additionalDirectories: string[]

  private homedir: string
  private getProjectResources?: (cwd: string) => ProjectResources
  private invalidateProjectResources?: (cwd: string) => void
  private onStateChange?: (snapshot: SessionStateChange) => void
  private onProviderSessionIdChange?: (sid: string, providerSessionId: string) => void

  private abortController: AbortController | null = null
  private backendStarted = false
  private eventListeners = new Set<(e: AgentEvent) => void>()
  private unsubs: Array<() => void> = []
  private _cachedInitReady: AgentEvent | null = null

  constructor(opts: SessionConstructorOptions) {
    this.id = opts.id
    this.projectPath = opts.projectPath
    this._cwd = opts.cwd
    this.providerId = opts.providerId
    this.harnessId = opts.harnessId
    this.providerConfig = opts.providerConfig
    this.backend = opts.backend
    this.permissionMode = opts.permissionMode ?? 'default'
    this.sandboxInfo = opts.sandboxInfo ?? DEFAULT_SANDBOX
    this.effort = opts.effort
    this.model = opts.model
    this.additionalDirectories = opts.additionalDirectories ?? []
    this.createdAt = opts.createdAt ?? Date.now()
    this._providerSessionId = opts.resumedProviderSessionId ?? null
    if (opts.initialMessages?.length) this._messages = [...opts.initialMessages]
    this._totalCostUsd = opts.initialTotalCostUsd ?? 0
    this._contextTokens = opts.initialContextTokens ?? 0
    this.homedir = opts.homedir ?? ''
    this.getProjectResources = opts.getProjectResources
    this.invalidateProjectResources = opts.invalidateProjectResources
    this.onStateChange = opts.onStateChange
    this.onProviderSessionIdChange = opts.onProviderSessionIdChange

    this.unsubs.push(this.backend.onEvent((e) => this.forwardEvent(e)))
    this.unsubs.push(this.backend.onProviderSessionId((id) => {
      if (this._providerSessionId === id) return
      this._providerSessionId = id
      try { this.onProviderSessionIdChange?.(this.id, id) } catch (err) {
        log.warn('[Session] onProviderSessionIdChange hook error:', err)
      }
    }))
    this.emitInitReady()
  }

  get snapshot(): SessionSnapshot {
    return {
      id: this.id,
      projectPath: this.projectPath,
      cwd: this.cwd,
      providerId: this.providerId,
      harnessId: this.harnessId,
      status: this._status,
      providerSessionId: this._providerSessionId,
      currentMessageId: this._currentMessageId,
      createdAt: this.createdAt,
      lastUserMessageAt: this._lastUserMessageAt,
      messages: this._messages,
      totalCostUsd: this._totalCostUsd,
      contextTokens: this._contextTokens,
      title: this.computeTitle(),
    }
  }

  async send(request: SendMessageRequest, opts?: { providerOrigin?: 'local' | 'remote' }): Promise<void> {
    const prev = this._sendChain
    let release!: () => void
    this._sendChain = new Promise<void>((r) => { release = r })
    try {
      await prev.catch(() => {})
      this.assertNotDisposed()
      const effortChanged = request.effort !== undefined && request.effort !== this.effort
      const dirsChanged = request.additionalDirs !== undefined
        && !sameStringArray(request.additionalDirs, this.additionalDirectories)
      if (request.effort !== undefined) this.effort = request.effort
      if (request.model !== undefined) this.model = request.model
      if (request.additionalDirs !== undefined) this.additionalDirectories = request.additionalDirs
      this.appendUserMessage(request, opts?.providerOrigin ?? 'local')
      const needsRebuild = this._needsRebuild
      if (this.backendStarted && (effortChanged || dirsChanged || needsRebuild)) {
        log.info('[Session] rebuilding backend sid=%s effortChanged=%s dirsChanged=%s needsRebuild=%s', this.id, effortChanged, dirsChanged, needsRebuild)
        await this.backend.rebuild(this.buildBackendStartOpts())
        this._needsRebuild = false
      } else {
        await this.ensureStarted()
      }
      this._status = 'streaming'
      try {
        await this.backend.send(request)
      } finally {
        if ((this._status as SessionStatus) !== 'disposed') this._status = 'ended'
      }
    } finally {
      release()
    }
  }

  async interrupt(): Promise<void> {
    if (this._status === 'disposed') return
    if (this._status !== 'streaming' && this._status !== 'starting') return
    const prev = this._status
    this._status = 'interrupting'
    try {
      await this.backend.interrupt()
    } catch (err) {
      log.debug('[Session] interrupt error:', err)
    } finally {
      if ((this._status as SessionStatus) !== 'disposed') {
        this._status = prev === 'starting' ? 'idle' : 'ended'
      }
    }
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.assertNotDisposed()
    this.permissionMode = mode
    if (this.backendStarted) await this.backend.setPermissionMode(mode)
  }

  setSandboxMode(mode: SandboxMode): SandboxInfo {
    this.sandboxInfo = {
      enabled: mode !== 'off',
      autoAllowBash: mode === 'auto',
    }
    return this.sandboxInfo
  }

  async setModel(model: string): Promise<void> {
    this.assertNotDisposed()
    this.model = model
    if (this.backendStarted) await this.backend.setModel(model)
  }

  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[]): void {
    this.assertNotDisposed()
    this.backend.respondToPermission(requestId, allow, alwaysAllow, reason, selectedSuggestions)
  }

  respondToQuestion(requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations): void {
    this.assertNotDisposed()
    this.backend.respondToQuestion(requestId, answers, annotations)
  }

  dismissQuestion(requestId: string): void {
    this.assertNotDisposed()
    this.backend.dismissQuestion(requestId)
  }

  respondToPlanApproval(requestId: string, approved: boolean, feedback?: string): void {
    this.assertNotDisposed()
    this.backend.respondToPlanApproval(requestId, approved, feedback)
  }

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    if (!this.backendStarted) return null
    return this.backend.getContextUsage()
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    if (!this.backendStarted) return []
    return this.backend.getMcpServerStatus()
  }

  async rewindFiles(userMessageId: string, opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    if (!this.backendStarted) return { canRewind: false, error: 'No active session' }
    return this.backend.rewindFiles(userMessageId, opts)
  }

  async reconnectMcp(serverName: string): Promise<void> {
    this.assertStarted()
    return this.backend.reconnectMcp(serverName)
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    this.assertStarted()
    return this.backend.toggleMcpServer(serverName, enabled)
  }

  async reloadPlugins(): Promise<boolean> {
    if (!this.backendStarted) return false
    return this.backend.reloadPlugins()
  }

  prewarm(hint?: PrewarmHint): void {
    const dirs = hint?.additionalDirs ?? this.additionalDirectories
    const opts: BackendStartOptions = {
      sessionId: this.id,
      projectPath: this.projectPath,
      cwd: this.cwd,
      config: this.providerConfig,
      permissionMode: this.permissionMode,
      sandboxInfo: this.sandboxInfo,
      effort: hint?.effort ?? this.effort,
      model: hint?.model ?? this.model,
      additionalDirectories: dirs.length > 0 ? dirs : undefined,
      abortController: new AbortController(),
      providerSessionId: this._providerSessionId ?? undefined,
    }
    this.backend.prewarm(opts)
  }

  dequeueMessage(clientMessageId: string): boolean {
    if (!this.backendStarted) return false
    return this.backend.dequeueMessage(clientMessageId)
  }

  getPendingInteractions(): AgentEvent[] {
    if (!this.backendStarted) return []
    return this.backend.getPendingInteractions()
  }

  async dispatchBackendCommand(cmd: BackendCommand): Promise<void> {
    this.assertNotDisposed()
    switch (cmd.kind) {
      case 'codex.steer': {
        if (cmd.newUserMessageId && cmd.newUserText) this.appendSideChannelUserMessage(cmd.newUserMessageId, cmd.newUserText)
        if (!this.backend.handleCommand) throw new Error(`Session ${this.id} harness=${this.harnessId} does not support backend commands`)
        await this.backend.handleCommand(cmd)
        return
      }
      case 'codex.plan_approval': {
        this.applyCodexPlanApprovalToMessage(cmd.messageId, { status: cmd.status, ...(cmd.feedback ? { feedback: cmd.feedback } : {}) })
        this.forwardEvent({
          type: 'codex_plan_approval',
          messageId: cmd.messageId,
          status: cmd.status,
          ...(cmd.feedback ? { feedback: cmd.feedback } : {}),
          projectPath: this.projectPath,
          sessionId: this.id,
        } as AgentEvent)
        return
      }
      case 'codex.collaboration_mode_change': {
        this.forwardEvent({
          type: 'codex_collaboration_mode_change',
          mode: cmd.mode,
          projectPath: this.projectPath,
          sessionId: this.id,
        } as AgentEvent)
        return
      }
    }
  }

  private appendSideChannelUserMessage(messageId: string, text: string): void {
    if (this._messages.some((m) => m.id === messageId)) return
    const userMsg: ChatMessage = {
      id: messageId,
      role: 'user',
      status: 'complete',
      content: [{ type: 'text', text }],
      createdAt: new Date().toISOString(),
      providerId: this.harnessId,
    }
    this._messages = [...this._messages, userMsg]
    this._lastUserMessageAt = Date.now()
    this.notifyStateChange()
  }

  private applyCodexPlanApprovalToMessage(
    messageId: string,
    approval: { status: 'approved' | 'rejected'; feedback?: string },
  ): void {
    const msgIdx = this._messages.findIndex((m) => m.id === messageId)
    if (msgIdx < 0) return
    const msg = this._messages[msgIdx]
    const existingCodexMeta = msg.metadata?.codex
    if (!existingCodexMeta) return
    const updated: ChatMessage = {
      ...msg,
      metadata: {
        ...(msg.metadata ?? {}),
        codex: { ...existingCodexMeta, planApproval: approval },
      },
    }
    this._messages = this._messages.map((m, i) => (i === msgIdx ? updated : m))
    this.notifyStateChange()
  }

  isStreaming(): boolean {
    return this._status === 'streaming' || this._status === 'starting' || this._status === 'interrupting'
  }

  truncateMessagesAt(checkpointId: string): void {
    const idx = this._messages.findIndex((m) => m.checkpointId === checkpointId)
    if (idx < 0) return
    this._messages = this._messages.slice(0, idx)
    this._totalCostUsd = 0
    this._contextTokens = 0
    this._taskProgress = {}
    this._streamingTokensByMessageId = {}
    this._lastUsageByMessageId = {}
    this.notifyStateChange()
  }

  async dispose(): Promise<void> {
    if (this._status === 'disposed') return
    this._status = 'disposed'
    for (const unsub of this.unsubs) {
      try { unsub() } catch { /* ignore */ }
    }
    this.unsubs = []
    this.eventListeners.clear()
    if (this.backendStarted) {
      try { await this.backend.close() } catch (err) { log.debug('[Session] backend.close error:', err) }
    }
    this.abortController?.abort()
    this.abortController = null
  }

  on(handler: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(handler)
    for (const e of this.getReplayEvents()) {
      try { handler(e) } catch (err) { log.warn('[Session] replay error:', err) }
    }
    return () => { this.eventListeners.delete(handler) }
  }

  getReplayEvents(): AgentEvent[] {
    return this._cachedInitReady ? [this._cachedInitReady] : []
  }

  private emitInitReady(): void {
    if (this.harnessId !== 'claude') return
    if (!this.getProjectResources) return
    const resources = this.getProjectResources(this._cwd)
    const event: AgentEvent = {
      type: 'init_ready',
      skills: resources.skills,
      projectCommands: resources.projectCommands,
      projectAgents: resources.projectAgents,
      additionalDirectories: resources.additionalDirectories,
      cwd: this._cwd,
      homedir: this.homedir,
      sandboxInfo: this.sandboxInfo,
      permissionMode: this.permissionMode,
    }
    this._cachedInitReady = this.forwardEvent(event)
  }

  getStatus(): SessionStatus {
    return this._status
  }

  getProviderSessionId(): string | null {
    return this._providerSessionId
  }

  getCurrentPermissionMode(): PermissionMode {
    return this.permissionMode
  }

  getCurrentSandboxInfo(): SandboxInfo {
    return this.sandboxInfo
  }

  updateProviderConfig(nextConfig: unknown): void {
    this.assertNotDisposed()
    if (this.providerConfig === nextConfig) return
    try {
      if (JSON.stringify(this.providerConfig) === JSON.stringify(nextConfig)) return
    } catch { /* fall through to rebuild */ }
    this.providerConfig = nextConfig
    this._needsRebuild = true
  }

  async switchCwd(nextCwd: string): Promise<void> {
    this.assertNotDisposed()
    if (this._cwd === nextCwd) return
    this._cwd = nextCwd
    this.emitInitReady()
    if (!this.backendStarted) return
    if (this._status === 'streaming' || this._status === 'starting' || this._status === 'interrupting') {
      this._needsRebuild = true
      return
    }
    await this.backend.rebuild(this.buildBackendStartOpts())
  }

  private buildBackendStartOpts(): BackendStartOptions {
    this.abortController = new AbortController()
    return {
      sessionId: this.id,
      projectPath: this.projectPath,
      cwd: this.cwd,
      config: this.providerConfig,
      permissionMode: this.permissionMode,
      sandboxInfo: this.sandboxInfo,
      effort: this.effort,
      model: this.model,
      additionalDirectories: this.additionalDirectories.length > 0 ? this.additionalDirectories : undefined,
      abortController: this.abortController,
      providerSessionId: this._providerSessionId ?? undefined,
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.backendStarted) return
    if (this._status === 'starting') return
    this._status = 'starting'
    const startOpts = this.buildBackendStartOpts()
    try {
      await this.backend.start(startOpts)
      this.backendStarted = true
      this._status = 'ended'
    } catch (err) {
      this._status = 'idle'
      this.backendStarted = false
      throw err
    }
  }

  private forwardEvent(event: AgentEvent): AgentEvent {
    if (event.type === 'message_start') {
      this._currentMessageId = event.message.id
    } else if (
      event.type === 'message_complete' ||
      event.type === 'message_interrupted' ||
      event.type === 'message_error'
    ) {
      this._currentMessageId = null
    }
    this.applyReducer(event)
    const existingProjectPath = (event as { projectPath?: string }).projectPath
    const tagged = { ...event, sessionId: this.id, projectPath: existingProjectPath ?? this.projectPath } as AgentEvent
    const traceMessageId = (event as Record<string, unknown>).messageId as string | undefined
      ?? this._currentMessageId
      ?? ''
    trace('agent.emit', event.type, tagged, traceMessageId)
    for (const cb of this.eventListeners) {
      try { cb(tagged) } catch (err) { log.warn('[Session] event listener error:', err) }
    }
    if (
      event.type === 'message_complete' ||
      event.type === 'message_interrupted' ||
      event.type === 'message_error' ||
      event.type === 'checkpoint_captured'
    ) {
      this.notifyStateChange()
    }
    return tagged
  }

  private applyReducer(event: AgentEvent): void {
    if (this.harnessId === 'claude') {
      const runtime: ClaudeSessionRuntime = {
        projectPath: this.projectPath,
        sessionId: this.id,
        messages: this._messages,
        totalCostUsd: this._totalCostUsd,
        contextTokens: this._contextTokens,
        session: null,
        gitBranch: null,
        worktreePath: null,
        taskProgress: this._taskProgress,
      }
      const next = applyClaudeEventToRuntime(runtime, event)
      this._messages = next.messages
      this._totalCostUsd = next.totalCostUsd
      this._contextTokens = next.contextTokens
      this._taskProgress = next.taskProgress
    } else {
      const runtime: CodexSessionRuntime = {
        projectPath: this.projectPath,
        sessionId: this.id,
        messages: this._messages,
        totalCostUsd: this._totalCostUsd,
        contextTokens: this._contextTokens,
        gitBranch: null,
        worktreePath: null,
        streamingTokensByMessageId: this._streamingTokensByMessageId,
        lastUsageByMessageId: this._lastUsageByMessageId,
      }
      if (event.type === 'message_start') {
        const existing = this._messages.find((m) => m.id === event.message.id)
        this._messages = existing ? this._messages : [...this._messages, event.message]
        return
      }
      if (
        event.type === 'message_complete' ||
        event.type === 'message_interrupted' ||
        event.type === 'message_error'
      ) {
        const codexMeta = event.type === 'message_complete'
          ? (event.metadata as Record<string, unknown> | undefined)?.codex as Record<string, unknown> | undefined
          : undefined
        const finalText = (codexMeta?.finalResponse as string | undefined)
          ?? (event.type === 'message_interrupted' ? 'Codex run interrupted.' : event.type === 'message_error' ? `Codex run failed: ${event.error}` : '')
        const result = codexMeta ? {
          threadId: (codexMeta.threadId as string | null) ?? null,
          finalResponse: (codexMeta.finalResponse as string | undefined) ?? '',
          usage: (codexMeta.usage as CodexSessionRuntime['lastUsageByMessageId'][string] | null) ?? null,
          items: (codexMeta.items as never) ?? [],
        } : undefined
        const status: 'complete' | 'interrupted' | 'error' = event.type === 'message_complete'
          ? 'complete'
          : event.type === 'message_interrupted' ? 'interrupted' : 'error'
        const next = finalizeCodexAssistantMessage(runtime, {
          messageId: event.messageId,
          status,
          text: finalText,
          result,
          durationMs: codexMeta?.durationMs as number | undefined,
        })
        this._messages = next.messages
        this._totalCostUsd = next.totalCostUsd
        this._contextTokens = next.contextTokens
        this._streamingTokensByMessageId = next.streamingTokensByMessageId
        this._lastUsageByMessageId = next.lastUsageByMessageId
        return
      }
      const next = applyCodexEventToRuntime(runtime, event)
      this._messages = next.messages
      this._totalCostUsd = next.totalCostUsd
      this._contextTokens = next.contextTokens
      this._streamingTokensByMessageId = next.streamingTokensByMessageId
      this._lastUsageByMessageId = next.lastUsageByMessageId
    }
  }

  private appendUserMessage(request: SendMessageRequest, providerOrigin: 'local' | 'remote'): void {
    const userMsg = buildClaudeUserMessage(request, providerOrigin)
    if (!this._messages.some((m) => m.id === userMsg.id)) {
      this._messages = [...this._messages, userMsg]
    }
    this._lastUserMessageAt = Date.now()
    this.notifyStateChange()
  }

  private notifyStateChange(): void {
    if (!this.onStateChange) return
    if (this._messages.length === 0) return
    try {
      this.onStateChange({
        sid: this.id,
        projectPath: this.projectPath,
        providerId: this.providerId,
        messages: this._messages,
        totalCostUsd: this._totalCostUsd,
        contextTokens: this._contextTokens,
        title: this.computeTitle(),
      })
    } catch (err) {
      log.warn('[Session] onStateChange hook error:', err)
    }
  }

  private computeTitle(): string | null {
    if (this._messages.length === 0) return null
    const title = this.harnessId === 'claude'
      ? extractClaudeTitle(this._messages)
      : extractCodexTitle(this._messages)
    return title ?? null
  }

  private assertStarted(): void {
    if (!this.backendStarted) throw new Error(`Session ${this.id} is not started`)
    if (this._status === 'disposed') throw new Error(`Session ${this.id} is disposed`)
  }

  private assertNotDisposed(): void {
    if (this._status === 'disposed') throw new Error(`Session ${this.id} is disposed`)
  }
}
