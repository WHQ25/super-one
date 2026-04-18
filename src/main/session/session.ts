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
  type CodexSessionRuntime,
} from '../agent/codex-session-runtime'
import type {
  BackendStartOptions,
  HarnessId,
  PrewarmHint,
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
  onStateChange?: (snapshot: SessionStateChange) => void
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
  readonly cwd: string
  readonly providerId: string
  readonly harnessId: HarnessId
  readonly createdAt: number

  private backend: SessionBackend
  private providerConfig: unknown

  private _status: SessionStatus = 'idle'
  private _sendChain: Promise<void> = Promise.resolve()
  private _currentMessageId: string | null = null
  private _providerSessionId: string | null = null
  private _lastUserMessageAt: number | null = null

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

  private onStateChange?: (snapshot: SessionStateChange) => void

  private abortController: AbortController | null = null
  private backendStarted = false
  private eventListeners = new Set<(e: AgentEvent) => void>()
  private unsubs: Array<() => void> = []

  constructor(opts: SessionConstructorOptions) {
    this.id = opts.id
    this.projectPath = opts.projectPath
    this.cwd = opts.cwd
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
    this.onStateChange = opts.onStateChange

    this.unsubs.push(this.backend.onEvent((e) => this.forwardEvent(e)))
    this.unsubs.push(this.backend.onProviderSessionId((id) => {
      this._providerSessionId = id
    }))
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

  async send(request: SendMessageRequest): Promise<void> {
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
      this.appendUserMessage(request)
      if (this.backendStarted && (effortChanged || dirsChanged)) {
        log.info('[Session] rebuilding backend sid=%s effortChanged=%s dirsChanged=%s', this.id, effortChanged, dirsChanged)
        await this.backend.rebuild(this.buildBackendStartOpts())
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
    return () => { this.eventListeners.delete(handler) }
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

  private buildBackendStartOpts(): BackendStartOptions {
    this.abortController = new AbortController()
    return {
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

  private forwardEvent(event: AgentEvent): void {
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
    const tagged = { ...event, sessionId: this.id }
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
      const next = applyCodexEventToRuntime(runtime, event)
      this._messages = next.messages
      this._totalCostUsd = next.totalCostUsd
      this._contextTokens = next.contextTokens
      this._streamingTokensByMessageId = next.streamingTokensByMessageId
      this._lastUsageByMessageId = next.lastUsageByMessageId
    }
  }

  private appendUserMessage(request: SendMessageRequest): void {
    const userMsg = buildClaudeUserMessage(request, 'local')
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
