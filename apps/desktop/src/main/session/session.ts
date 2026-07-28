import type {
  AgentEvent,
  ChatMessage,
  CodexGoal,
  CodexGoalStatus,
  CodexUsageInfo,
  ContextUsageInfo,
  McpServerInfo,
  PermissionMode,
  QuestionAnnotations,
  RemoteActiveProvider,
  RewindFilesResult,
  SandboxInfo,
  SandboxMode,
  SendMessageRequest,
} from '@superone/shared/agent-types'
import log from '../logger'
import { trace } from '../agent/event-trace'
import { getSandboxCapability } from '../sandbox-platform'
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
import { renameSession as dbRenameSession } from '../db-sessions'
import { updateAcpAgentId as dbUpdateAcpAgentId } from './session-repo'
import { rejectSessionAgentsConfirm, resolveSessionAgentsConfirm } from './session-collaboration-confirm'
import { nextEventSeq } from './event-seq'
import { collectChangedMessageIds } from './message-dirty'
import {
  redactTaskNotificationForDisplay,
  taskNotificationRequest,
} from './task-notification-queue'
import {
  LOCAL_OWNER,
  SessionClaimConflictError,
  SessionLockedError,
  type BackendCommand,
  type BackendStartOptions,
  type HarnessId,
  type PrewarmHint,
  type ProjectResources,
  type SendProviderOrigin,
  type Session as SessionContract,
  type SessionBackend,
  type SessionLeaveReason,
  type SessionLifecycleEvent,
  type SessionOwner,
  type SessionSnapshot,
  type SessionStateChange,
  type SessionStatus,
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
  gitBranch?: string | null
  missingWorktreePath?: string | null
  resumedProviderSessionId?: string
  initialMessages?: ChatMessage[]
  initialTotalCostUsd?: number
  initialContextTokens?: number
  apiProviderId?: string | null
  acpAgentId?: string | null
  systemPromptAppend?: string
  homedir?: string
  getProjectResources?: (cwd: string) => ProjectResources
  invalidateProjectResources?: (cwd: string) => void
  onStateChange?: (snapshot: SessionStateChange) => void
  onProviderSessionIdChange?: (sid: string, providerSessionId: string) => void
  getActiveProvider?: (harnessId: HarnessId, apiProviderId: string | null) => RemoteActiveProvider | null
  resolveProviderConfigForApiProvider?: (apiProviderId: string | null) => unknown
  getActiveDefaultApiProviderId?: (harnessId: HarnessId) => string | null
  onBeforeInterrupt?: () => void
}

function agentIdFromConfig(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null
  const id = (config as { agentId?: unknown }).agentId
  return typeof id === 'string' && id ? id : null
}

function withAgentId(config: unknown, agentId: string): unknown {
  const base = (config && typeof config === 'object') ? config as Record<string, unknown> : {}
  return { ...base, agentId }
}

function getDefaultSandbox(): SandboxInfo {
  const capability = getSandboxCapability()
  return { enabled: capability.defaultMode !== 'off', autoAllowBash: capability.defaultMode === 'auto' }
}

function coerceSandboxInfo(info: SandboxInfo): SandboxInfo {
  if (!info.enabled) return info
  if (getSandboxCapability().supportLevel === 'unsupported') return { enabled: false, autoAllowBash: false }
  return info
}

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

  private _gitBranch: string | null = null
  get gitBranch(): string | null { return this._gitBranch }

  private _missingWorktreePath: string | null = null
  get worktreeMissing(): boolean { return this._missingWorktreePath !== null }

  private backend: SessionBackend
  private providerConfig: unknown

  private _status: SessionStatus = 'idle'
  private _sendChain: Promise<void> = Promise.resolve()
  private _currentMessageId: string | null = null
  private _providerSessionId: string | null = null
  private _lastUserMessageAt: number | null = null
  private _lastEventAt = 0
  private _lastRuntimeActivityAt = Date.now()
  private _runtimeRelease: Promise<boolean> | null = null
  private _needsRebuild = false

  get lastEventAt(): number { return this._lastEventAt }

  private _messages: ChatMessage[] = []
  /** Message ids mutated since last successful persist. */
  private _dirtyMessageIds = new Set<string>()
  /** When true, next persist upserts all messages (still no DELETE-all). */
  private _forceFullPersist = false
  /**
   * Set when messages are removed (truncate/rewind). Allows empty-transcript
   * persist so session-repo can stale-delete orphans. Cleared only after a
   * successful save; retained on failure for retry.
   */
  private _needsStaleReconcile = false
  private _title: string | null = null
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
  private _apiProviderId: string | null = null
  private _acpAgentId: string | null = null
  private systemPromptAppend: string | undefined

  private homedir: string
  private getProjectResources?: (cwd: string) => ProjectResources
  private invalidateProjectResources?: (cwd: string) => void
  private onStateChange?: (snapshot: SessionStateChange) => void
  private onProviderSessionIdChange?: (sid: string, providerSessionId: string) => void
  private getActiveProvider?: (harnessId: HarnessId, apiProviderId: string | null) => RemoteActiveProvider | null
  private resolveProviderConfigForApiProvider?: (apiProviderId: string | null) => unknown
  private getActiveDefaultApiProviderId?: (harnessId: HarnessId) => string | null
  private onBeforeInterrupt?: () => void

  private abortController: AbortController | null = null
  private backendStarted = false
  private eventListeners = new Set<(e: AgentEvent) => void>()
  private unsubs: Array<() => void> = []
  private _cachedInitReady: AgentEvent | null = null
  private _cachedWorktreeMissing: AgentEvent | null = null
  private _pendingQueuedRequests = new Map<string, { request: SendMessageRequest; providerOrigin: SendProviderOrigin }>()
  /** Shared so concurrent ensureStarted callers await the same backend.start(). */
  private _startPromise: Promise<void> | null = null

  private _foregroundRefCount = 0

  /**
   * A session can be rendered in more than one place at once (e.g. a mosaic tile
   * and a mini window on the same session) — ref-count so unmounting one place
   * doesn't drop foreground status while another is still visible.
   */
  setForeground(visible: boolean): void {
    this._foregroundRefCount = Math.max(0, this._foregroundRefCount + (visible ? 1 : -1))
  }

  hasActiveRuntime(): boolean {
    return this.backend.hasActiveRuntime()
  }

  isRuntimeIdle(now: number, timeoutMs: number): boolean {
    if (!this.hasActiveRuntime()) return false
    if (this._foregroundRefCount > 0) return false
    if (this.isStreaming()) return false
    if (this._pendingQueuedRequests.size > 0) return false
    if (this.backend.hasActiveBackgroundTasks?.()) return false
    if (this.backend.getPendingInteractions().length > 0) return false
    return now - this._lastRuntimeActivityAt >= timeoutMs
  }

  async releaseRuntime(reason: 'idle', afterRelease?: () => Promise<void>): Promise<boolean> {
    if (this._runtimeRelease) return this._runtimeRelease
    const release = (async () => {
      await this.backend.releaseRuntime(reason)
      if (this.backend.hasActiveRuntime()) return false
      await afterRelease?.()
      return true
    })()
    this._runtimeRelease = release
    try {
      return await release
    } finally {
      if (this._runtimeRelease === release) this._runtimeRelease = null
    }
  }

  private async waitForRuntimeRelease(): Promise<void> {
    await this._runtimeRelease
  }

  private touchRuntimeActivity(): void {
    this._lastRuntimeActivityAt = Date.now()
  }

  private _owner: SessionOwner = LOCAL_OWNER
  private _subscribers = new Set<string>()
  private _lifecycleListeners = new Set<(event: SessionLifecycleEvent) => void>()
  get owner(): SessionOwner { return this._owner }
  get subscribers(): ReadonlySet<string> { return this._subscribers }

  onLifecycle(handler: (event: SessionLifecycleEvent) => void): () => void {
    this._lifecycleListeners.add(handler)
    return () => { this._lifecycleListeners.delete(handler) }
  }

  private emitLifecycle(event: SessionLifecycleEvent): void {
    for (const cb of this._lifecycleListeners) {
      try { cb(event) } catch (err) { log.warn('[Session] lifecycle handler error:', err) }
    }
  }

  claim(owner: Extract<SessionOwner, { kind: 'remote' }>): void {
    if (this._status === 'disposed') return
    if (this._owner.kind === 'remote' && this._owner.deviceId !== owner.deviceId) {
      throw new SessionClaimConflictError(this.id, this._owner.deviceId, owner.deviceId)
    }
    for (const sub of this._subscribers) {
      if (sub !== owner.deviceId) {
        throw new SessionClaimConflictError(this.id, sub, owner.deviceId)
      }
    }
    if (this._owner.kind === 'remote' && this._owner.deviceId === owner.deviceId) return
    const previous = this._owner
    this._owner = owner
    trace('session.lifecycle', 'claim', { sid: this.id, deviceId: owner.deviceId, prevOwner: previous.kind === 'remote' ? previous.deviceId : 'local' })
    this.emitLifecycle({ type: 'owner_changed', sessionId: this.id, previous, current: owner })
  }

  release(deviceId: string, reason?: SessionLeaveReason): void {
    if (this._owner.kind !== 'remote' || this._owner.deviceId !== deviceId) return
    const previous = this._owner
    this._owner = LOCAL_OWNER
    trace('session.lifecycle', 'release', { sid: this.id, deviceId, reason: reason ?? null })
    this.emitLifecycle({ type: 'owner_changed', sessionId: this.id, previous, current: LOCAL_OWNER, reason })
  }

  subscribe(deviceId: string): void {
    if (this._status === 'disposed') return
    if (this._subscribers.has(deviceId)) return
    if (this._owner.kind === 'remote' && this._owner.deviceId !== deviceId) {
      throw new SessionClaimConflictError(this.id, this._owner.deviceId, deviceId)
    }
    for (const sub of this._subscribers) {
      if (sub !== deviceId) {
        throw new SessionClaimConflictError(this.id, sub, deviceId)
      }
    }
    this._subscribers.add(deviceId)
    trace('session.lifecycle', 'subscribe', { sid: this.id, deviceId, owner: this._owner.kind === 'remote' ? this._owner.deviceId : 'local' })
    this.emitLifecycle({ type: 'subscriber_added', sessionId: this.id, deviceId })
  }

  unsubscribe(deviceId: string, reason?: SessionLeaveReason): void {
    if (!this._subscribers.delete(deviceId)) return
    trace('session.lifecycle', 'unsubscribe', { sid: this.id, deviceId, reason: reason ?? null, remainingSubs: [...this._subscribers] })
    this.emitLifecycle({ type: 'subscriber_removed', sessionId: this.id, deviceId, reason })
  }

  private assertCanSend(providerOrigin: SendProviderOrigin): void {
    // remote: device that owns/subscribes the session
    // host: trusted main-process wakes (mailbox, download settle) — not UI ownership
    if (providerOrigin === 'remote' || providerOrigin === 'host') return
    if (this._owner.kind === 'remote') {
      throw new SessionLockedError(this.id, 'remote-owned', this._owner.deviceId)
    }
    if (this._subscribers.size > 0) {
      throw new SessionLockedError(this.id, 'remote-subscribed')
    }
  }

  constructor(opts: SessionConstructorOptions) {
    this.id = opts.id
    this.projectPath = opts.projectPath
    this._cwd = opts.cwd
    this.providerId = opts.providerId
    this.harnessId = opts.harnessId
    this.providerConfig = opts.providerConfig
    this.backend = opts.backend
    // Idle task-notification flushes must take Session.send / _sendChain — never
    // backend.send alone (races status machine and concurrent user sends).
    this.backend.bindTaskNotificationSend?.((content) =>
      this.send(taskNotificationRequest(content), { providerOrigin: 'host' }),
    )
    this.permissionMode = opts.permissionMode ?? 'default'
    this.sandboxInfo = coerceSandboxInfo(opts.sandboxInfo ?? getDefaultSandbox())
    this.effort = opts.effort
    this.model = opts.model
    this.additionalDirectories = opts.additionalDirectories ?? []
    this.createdAt = opts.createdAt ?? Date.now()
    this._providerSessionId = opts.resumedProviderSessionId ?? null
    if (opts.initialMessages?.length) this._messages = [...opts.initialMessages]
    if (opts.title) this._title = opts.title
    this._totalCostUsd = opts.initialTotalCostUsd ?? 0
    this._contextTokens = opts.initialContextTokens ?? 0
    this._gitBranch = opts.gitBranch ?? null
    this._missingWorktreePath = opts.missingWorktreePath ?? null
    this._apiProviderId = opts.apiProviderId ?? null
    this._acpAgentId = opts.acpAgentId ?? agentIdFromConfig(opts.providerConfig)
    this.systemPromptAppend = opts.systemPromptAppend
    if (this.harnessId === 'acp' && this._acpAgentId) {
      this.providerConfig = withAgentId(this.providerConfig, this._acpAgentId)
    }
    this.homedir = opts.homedir ?? ''
    this.getProjectResources = opts.getProjectResources
    this.invalidateProjectResources = opts.invalidateProjectResources
    this.onStateChange = opts.onStateChange
    this.onProviderSessionIdChange = opts.onProviderSessionIdChange
    this.getActiveProvider = opts.getActiveProvider
    this.resolveProviderConfigForApiProvider = opts.resolveProviderConfigForApiProvider
    this.getActiveDefaultApiProviderId = opts.getActiveDefaultApiProviderId
    this.onBeforeInterrupt = opts.onBeforeInterrupt

    this.unsubs.push(this.backend.onEvent((e) => this.forwardEvent(e)))
    this.unsubs.push(this.backend.onProviderSessionId((id) => {
      if (this._providerSessionId === id) return
      this._providerSessionId = id
      try { this.onProviderSessionIdChange?.(this.id, id) } catch (err) {
        log.warn('[Session] onProviderSessionIdChange hook error:', err)
      }
      // Draft sessions are not in DB until the first message; re-persist when we
      // already have transcript so a late-arriving provider id is not lost.
      if (this._messages.length > 0) this.notifyStateChange()
    }))
    this.unsubs.push(this.backend.onPermissionModeApplied((mode) => {
      if (this.permissionMode === mode) return
      trace('permission.flow', 'session_mode_synced_from_backend', { sid: this.id, prev: this.permissionMode, next: mode })
      this.permissionMode = mode
      this.forwardEvent({ type: 'permission_mode_change', mode })
    }))
    this.emitInitReady()
    if (this._missingWorktreePath) {
      this._cachedWorktreeMissing = this.forwardEvent({
        type: 'worktree_missing',
        worktreePath: this._missingWorktreePath,
        fallbackCwd: this._cwd,
      } as AgentEvent)
    }
  }

  get snapshot(): SessionSnapshot {
    const isWorktree = this._cwd !== this.projectPath
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
      lastEventAt: this._lastEventAt,
      messages: this._messages,
      totalCostUsd: this._totalCostUsd,
      contextTokens: this._contextTokens,
      title: this.computeTitle(),
      isWorktree,
      worktreePath: isWorktree ? this._cwd : null,
      gitBranch: this._gitBranch,
      worktreeMissing: this._missingWorktreePath !== null,
      apiProviderId: this._apiProviderId,
    }
  }

  getApiProviderId(): string | null {
    return this._apiProviderId
  }

  setApiProviderId(apiProviderId: string | null): void {
    this.assertNotDisposed()
    if (this._apiProviderId === apiProviderId) return
    this._apiProviderId = apiProviderId
    if (this.resolveProviderConfigForApiProvider) {
      this.providerConfig = this.resolveProviderConfigForApiProvider(apiProviderId)
    }
    this._needsRebuild = true
    this.notifyStateChange()
    const resolvedProvider = this.getActiveProvider?.(this.harnessId, apiProviderId) ?? null
    this.forwardEvent({
      type: 'agent_setting_change',
      patch: { apiProviderId, apiProvider: resolvedProvider },
    } as AgentEvent)
  }

  private snapEffectiveApiProviderId(): void {
    if (this._apiProviderId !== null) return
    if (!this.getActiveDefaultApiProviderId) return
    const id = this.getActiveDefaultApiProviderId(this.harnessId)
    if (!id) return
    this._apiProviderId = id
    if (this.resolveProviderConfigForApiProvider) {
      const nextConfig = this.resolveProviderConfigForApiProvider(id)
      let changed = false
      try {
        changed = JSON.stringify(this.providerConfig) !== JSON.stringify(nextConfig)
      } catch {
        changed = true
      }
      if (changed) {
        this.providerConfig = nextConfig
        this._needsRebuild = true
      }
    }
    this.notifyStateChange()
    const resolvedProvider = this.getActiveProvider?.(this.harnessId, id) ?? null
    this.forwardEvent({
      type: 'agent_setting_change',
      patch: { apiProviderId: id, apiProvider: resolvedProvider },
    } as AgentEvent)
  }

  async send(request: SendMessageRequest, opts?: { providerOrigin?: SendProviderOrigin }): Promise<void> {
    const providerOrigin = opts?.providerOrigin ?? 'local'
    this.assertCanSend(providerOrigin)
    this.touchRuntimeActivity()
    const isQueued = request.priority === 'next' && this.isStreaming()
    if (isQueued) {
      this.assertNotDisposed()
      if (!this.backendStarted) {
        log.warn('[Session] queued send before backend start sid=%s — promoting to normal send', this.id)
      } else if (this._needsRebuild) {
        log.info('[Session] queued send promoted to normal send sid=%s (pending rebuild)', this.id)
      } else {
        if (request.clientMessageId) {
          this._pendingQueuedRequests.set(request.clientMessageId, { request, providerOrigin })
        }
        await this.backend.send(request)
        return
      }
    }
    const prev = this._sendChain
    let release!: () => void
    this._sendChain = new Promise<void>((r) => { release = r })
    try {
      await prev.catch(() => {})
      await this.waitForRuntimeRelease()
      this.assertNotDisposed()
      const effortChanged = request.effort !== undefined && request.effort !== this.effort
      const dirsChanged = request.additionalDirs !== undefined
        && !sameStringArray(request.additionalDirs, this.additionalDirectories)
      if (request.effort !== undefined) this.effort = request.effort
      if (request.model !== undefined) this.model = request.model
      if (request.additionalDirs !== undefined) this.additionalDirectories = request.additionalDirs
      this.appendUserMessage(request, providerOrigin)
      this.snapEffectiveApiProviderId()
      const needsRebuild = this._needsRebuild
      let dirsNeedRebuild = dirsChanged
      if (dirsChanged && this.backendStarted && !effortChanged && !needsRebuild) {
        const applied = (await this.backend.setAdditionalDirectories?.(this.additionalDirectories)) ?? false
        dirsNeedRebuild = !applied
      }
      if (this.backendStarted && (effortChanged || dirsNeedRebuild || needsRebuild)) {
        log.info('[Session] rebuilding backend sid=%s effortChanged=%s dirsChanged=%s needsRebuild=%s', this.id, effortChanged, dirsChanged, needsRebuild)
        await this.backend.rebuild(this.buildBackendStartOpts())
        this._needsRebuild = false
      } else {
        await this.ensureStarted()
        // Codex snapshots its MCP tool set when the thread starts — including at prewarm,
        // before a first-turn @-mention can register app tools. The just-adopted prewarmed
        // thread is then stale, so rebuild to re-establish the connection on a fresh snapshot.
        // Claude's in-process MCP server reflects the live tool set, so it needs no rebuild.
        if (needsRebuild && this.harnessId === 'codex') {
          log.info('[Session] rebuilding codex backend post-start to pick up tools registered before first send sid=%s', this.id)
          await this.backend.rebuild(this.buildBackendStartOpts())
        }
        this._needsRebuild = false
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

  async interrupt(): Promise<boolean> {
    if (this._status === 'disposed') return false
    if (this._status === 'interrupting') return true
    if (this._status !== 'streaming' && this._status !== 'starting') return false
    this.touchRuntimeActivity()
    const prev = this._status
    this._status = 'interrupting'
    this._pendingQueuedRequests.clear()
    try {
      this.onBeforeInterrupt?.()
    } catch (err) {
      log.warn('[Session] onBeforeInterrupt hook error:', err)
    }
    try {
      await this.backend.interrupt()
    } catch (err) {
      log.debug('[Session] interrupt error:', err)
    } finally {
      if ((this._status as SessionStatus) !== 'disposed') {
        this._status = prev === 'starting' ? 'idle' : 'ended'
      }
    }
    return true
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    const prev = this.permissionMode
    trace('permission.flow', 'session_setMode_in', { sid: this.id, prev, next: mode, status: this._status, backendStarted: this.backendStarted })
    if (prev === mode) {
      trace('permission.flow', 'session_setMode_noop', { sid: this.id, mode })
      return
    }
    this.permissionMode = mode
    this.forwardEvent({ type: 'permission_mode_change', mode })
    this.forwardEvent({ type: 'agent_setting_change', patch: { permissionMode: mode } } as AgentEvent)
    // Always push to the backend: ACP/Claude may already have a prewarmed runtime
    // before ensureStarted() flips backendStarted. Backends no-op when not ready.
    trace('permission.flow', 'session_setMode_fast_path', { sid: this.id, prev, next: mode, backendStarted: this.backendStarted })
    try {
      await this.backend.setPermissionMode(mode)
      trace('permission.flow', 'session_setMode_fast_done', { sid: this.id, mode })
    } catch (err) {
      trace('permission.flow', 'session_setMode_fast_error', { sid: this.id, mode, err: (err as Error)?.message })
      throw err
    }
  }

  async setSandboxMode(mode: SandboxMode): Promise<SandboxInfo> {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    if (mode !== 'off') {
      const capability = getSandboxCapability()
      if (capability.supportLevel === 'unsupported') {
        throw new Error(capability.unsupportedReason ?? '当前平台不支持沙盒')
      }
    }
    const next: SandboxInfo = {
      enabled: mode !== 'off',
      autoAllowBash: mode === 'auto',
    }
    if (
      this.sandboxInfo.enabled === next.enabled &&
      this.sandboxInfo.autoAllowBash === next.autoAllowBash
    ) {
      return this.sandboxInfo
    }
    this.sandboxInfo = next
    if (this.backendStarted) {
      try {
        await this.backend.setSandbox(next)
      } catch (err) {
        log.warn('[Session] backend.setSandbox failed:', err)
      }
    }
    this.forwardEvent({ type: 'agent_setting_change', patch: { sandboxInfo: next } } as AgentEvent)
    return this.sandboxInfo
  }

  async setModel(model: string): Promise<void> {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    this.model = model
    // Always push: ACP may already have a prewarmed runtime before backendStarted flips.
    try {
      await this.backend.setModel(model)
    } catch (err) {
      log.warn('[Session] backend.setModel failed:', err)
    }
  }

  async setSessionMode(modeId: string): Promise<void> {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    // Always push: Grok effort (session/set_model + reasoningEffort) must apply on
    // prewarmed runtimes even when ensureStarted has not flipped backendStarted yet.
    try {
      await this.backend.setSessionMode(modeId)
    } catch (err) {
      log.warn('[Session] backend.setSessionMode failed mode=%s:', modeId, err)
    }
  }

  /**
   * Broadcast a generic settings patch to all listeners (multi-window sync).
   *
   * Used for harness-specific settings that aren't owned by Session itself
   * (e.g. codex collaborationMode/permissionPreset live in the renderer store).
   * Main process here is just a transport bus — the patch is forwarded as-is.
   */
  broadcastSettingsPatch(patch: import('@superone/shared/agent-types').SessionSettingsPatch): void {
    if (!patch || Object.keys(patch).length === 0) return
    this.forwardEvent({ type: 'agent_setting_change', patch } as AgentEvent)
  }

  setSelectedSettings(opts: { model?: string | null; effort?: SendMessageRequest['effort'] | null; mode?: string | null }): void {
    this.assertNotDisposed()
    let changed = false
    if (opts.model !== undefined) {
      const next = opts.model ?? undefined
      if (this.model !== next) { this.model = next; changed = true }
    }
    if (opts.effort !== undefined) {
      const next = (opts.effort ?? undefined) as SendMessageRequest['effort']
      if (this.effort !== next) {
        this.effort = next
        changed = true
        if (this.backendStarted) this._needsRebuild = true
      }
    }
    if (opts.mode !== undefined && opts.mode) {
      void this.setSessionMode(opts.mode)
    }
    if (!changed) return
    this.forwardEvent({
      type: 'agent_setting_change',
      selectedModel: this.model ?? null,
      selectedEffort: this.effort ?? null,
      patch: { selectedModel: this.model ?? null, selectedEffort: this.effort ?? null },
    })
  }

  getSelectedModel(): string | undefined { return this.model }
  getSelectedEffort(): SendMessageRequest['effort'] { return this.effort }

  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], decision?: 'cancel', formAnswers?: Record<string, unknown>): boolean {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    if (decision === 'cancel') {
      if (rejectSessionAgentsConfirm(requestId, 'User cancelled')) return true
    } else if (resolveSessionAgentsConfirm(requestId, allow ? 'accept' : 'decline', formAnswers)) {
      return true
    }
    return this.backend.respondToPermission(requestId, allow, alwaysAllow, reason, selectedSuggestions, decision, formAnswers)
  }

  respondToQuestion(requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations): void {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    this.backend.respondToQuestion(requestId, answers, annotations)
  }

  dismissQuestion(requestId: string): void {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    this.backend.dismissQuestion(requestId)
  }

  respondToPlanApproval(requestId: string, approved: boolean, feedback?: string): void {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    this.backend.respondToPlanApproval(requestId, approved, feedback)
  }

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    if (!this.backendStarted) return null
    this.touchRuntimeActivity()
    return this.backend.getContextUsage()
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    if (!this.backendStarted) return []
    this.touchRuntimeActivity()
    return this.backend.getMcpServerStatus()
  }

  async authenticateMcp(serverName: string): Promise<void> {
    this.assertStarted()
    this.touchRuntimeActivity()
    if (!this.backend.authenticateMcp) throw new Error(`MCP authentication is not supported by ${this.harnessId}`)
    return this.backend.authenticateMcp(serverName)
  }

  async rewindFiles(userMessageId: string, opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    if (!this.backendStarted) return { canRewind: false, error: 'No active session' }
    this.touchRuntimeActivity()
    return this.backend.rewindFiles(userMessageId, opts)
  }

  async reconnectMcp(serverName: string): Promise<void> {
    this.assertStarted()
    this.touchRuntimeActivity()
    return this.backend.reconnectMcp(serverName)
  }

  async reloadMcpServers(): Promise<void> {
    if (!this.backendStarted) return
    this.touchRuntimeActivity()
    // A pending rebuild already discards the connection and re-snapshots tools on the
    // next send, so an explicit reload now is redundant — and for codex it is a heavy
    // process-wide MCP reconnect. Let the rebuild carry the tool change instead.
    if (this._needsRebuild) return
    return this.backend.reloadMcpServers()
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    this.assertStarted()
    this.touchRuntimeActivity()
    return this.backend.toggleMcpServer(serverName, enabled)
  }

  async reloadPlugins(): Promise<boolean> {
    if (!this.backendStarted) return false
    this.touchRuntimeActivity()
    return this.backend.reloadPlugins()
  }

  prewarm(hint?: PrewarmHint): void {
    this.touchRuntimeActivity()
    if (this.harnessId === 'acp' && this.resolveProviderConfigForApiProvider) {
      try {
        this.providerConfig = this.resolveProviderConfigForApiProvider(this._apiProviderId)
      } catch { /* keep previous config */ }
    }
    if (this.harnessId === 'acp') {
      if (hint?.acpAgentId) this.setAcpAgentId(hint.acpAgentId)
      else this.applyAcpAgentToConfig()
    }
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
      apiProviderId: this._apiProviderId,
      systemPromptAppend: this.systemPromptAppend,
    }
    if (this._runtimeRelease) {
      void this.waitForRuntimeRelease()
        .then(() => {
          if (this._status !== 'disposed') this.backend.prewarm(opts)
        })
        .catch((err) => log.debug('[Session] prewarm after runtime release failed:', err))
      return
    }
    this.backend.prewarm(opts)
  }

  setAcpAgentId(agentId: string | null): void {
    if (this.harnessId !== 'acp') return
    if (this._acpAgentId === agentId) {
      this.applyAcpAgentToConfig()
      return
    }
    this._acpAgentId = agentId
    this.applyAcpAgentToConfig()
    try {
      dbUpdateAcpAgentId(this.id, agentId)
    } catch (err) {
      log.debug('[Session] updateAcpAgentId skipped:', err instanceof Error ? err.message : String(err))
    }
  }

  private applyAcpAgentToConfig(): void {
    if (this.harnessId !== 'acp' || !this._acpAgentId) return
    this.providerConfig = withAgentId(this.providerConfig, this._acpAgentId)
  }

  dequeueMessage(clientMessageId: string): boolean {
    this._pendingQueuedRequests.delete(clientMessageId)
    if (!this.backendStarted) return false
    return this.backend.dequeueMessage(clientMessageId)
  }

  getPendingInteractions(): AgentEvent[] {
    if (!this.backendStarted) return []
    return this.backend.getPendingInteractions().map((event) => {
      const existingProjectPath = (event as { projectPath?: string }).projectPath
      return { ...event, sessionId: this.id, projectPath: existingProjectPath ?? this.projectPath } as AgentEvent
    })
  }

  async getCodexGoal(threadId: string): Promise<CodexGoal | null> {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    if (this.harnessId !== 'codex') throw new Error(`Session ${this.id} is not a Codex session`)
    await this.ensureStarted()
    if (!this.backend.getCodexGoal) throw new Error('Codex goal operations are unavailable')
    return this.backend.getCodexGoal(threadId)
  }

  async setCodexGoal(threadId: string, objective: string, status?: CodexGoalStatus): Promise<CodexGoal | null> {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    if (this.harnessId !== 'codex') throw new Error(`Session ${this.id} is not a Codex session`)
    await this.ensureStarted()
    if (!this.backend.setCodexGoal) throw new Error('Codex goal operations are unavailable')
    return this.backend.setCodexGoal(threadId, objective, status)
  }

  async clearCodexGoal(threadId: string): Promise<boolean> {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    if (this.harnessId !== 'codex') throw new Error(`Session ${this.id} is not a Codex session`)
    await this.ensureStarted()
    if (!this.backend.clearCodexGoal) throw new Error('Codex goal operations are unavailable')
    return this.backend.clearCodexGoal(threadId)
  }

  async dispatchBackendCommand(cmd: BackendCommand): Promise<void> {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
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
      case 'claude.set_additional_dirs': {
        if (this.harnessId !== 'claude') return
        if (sameStringArray(cmd.dirs, this.additionalDirectories)) return
        this.additionalDirectories = [...cmd.dirs]
        if (!this.backendStarted) return
        const applied = (await this.backend.setAdditionalDirectories?.(cmd.dirs)) ?? false
        if (applied) return
        if (!this.isStreaming() && !this.backend.hasActiveBackgroundTasks?.()) {
          await this.backend.rebuild(this.buildBackendStartOpts())
          this._needsRebuild = false
        } else {
          this._needsRebuild = true
        }
        return
      }
      case 'claude.stop_task': {
        if (this.harnessId !== 'claude') return
        await this.backend.stopTask?.(cmd.taskId)
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
    this.replaceMessages([...this._messages, userMsg])
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
    this.replaceMessages(this._messages.map((m, i) => (i === msgIdx ? updated : m)))
    this.notifyStateChange()
  }

  isStreaming(): boolean {
    return this._status === 'streaming' || this._status === 'starting' || this._status === 'interrupting'
  }

  truncateMessagesAt(checkpointId: string): void {
    const idx = this._messages.findIndex((m) => m.checkpointId === checkpointId)
    if (idx < 0) return
    // Prefix slice: remaining message objects keep identity; stale-id delete removes the rest.
    this._messages = this._messages.slice(0, idx)
    this._totalCostUsd = 0
    this._contextTokens = 0
    this._taskProgress = {}
    this._streamingTokensByMessageId = {}
    this._lastUsageByMessageId = {}
    // Allow empty-transcript persist (e.g. rewind to first checkpoint at index 0).
    this._needsStaleReconcile = true
    this.notifyStateChange()
  }

  async dispose(): Promise<void> {
    if (this._status === 'disposed') return
    trace('session.lifecycle', 'dispose', { sid: this.id, owner: this._owner.kind === 'remote' ? this._owner.deviceId : 'local', subscribers: [...this._subscribers] })
    this._status = 'disposed'
    this._pendingQueuedRequests.clear()
    try { await this.waitForRuntimeRelease() } catch { /* backend close still needs to run */ }
    try { await this.backend.close() } catch (err) { log.debug('[Session] backend.close error:', err) }
    if (this._owner.kind === 'remote') {
      const previous = this._owner
      this._owner = LOCAL_OWNER
      this.emitLifecycle({ type: 'owner_changed', sessionId: this.id, previous, current: LOCAL_OWNER, reason: 'session_closed' })
    }
    for (const deviceId of Array.from(this._subscribers)) {
      this._subscribers.delete(deviceId)
      this.emitLifecycle({ type: 'subscriber_removed', sessionId: this.id, deviceId, reason: 'session_closed' })
    }
    this.emitLifecycle({ type: 'closed', sessionId: this.id })
    this._lifecycleListeners.clear()
    for (const unsub of this.unsubs) {
      try { unsub() } catch { /* ignore */ }
    }
    this.unsubs = []
    this.eventListeners.clear()
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
    const out: AgentEvent[] = []
    if (this._cachedInitReady) out.push(this._cachedInitReady)
    if (this._cachedWorktreeMissing) out.push(this._cachedWorktreeMissing)
    return out
  }

  private emitInitReady(): void {
    if (this.harnessId !== 'claude') return
    if (!this.getProjectResources) return
    const resources = this.getProjectResources(this._cwd)
    const activeProvider = this.getActiveProvider?.(this.harnessId, this._apiProviderId) ?? null
    const event: AgentEvent = {
      type: 'init_ready',
      skills: resources.skills,
      projectCommands: resources.projectCommands,
      projectAgents: resources.projectAgents,
      additionalDirectories: resources.additionalDirectories,
      additionalDirsScoped: {
        user: [...resources.additionalDirsScoped.user],
        projectShared: [...resources.additionalDirsScoped.projectShared],
        projectLocal: [...resources.additionalDirsScoped.projectLocal],
      },
      cwd: this._cwd,
      homedir: this.homedir,
      sandboxInfo: this.sandboxInfo,
      permissionMode: this.permissionMode,
      selectedModel: this.model ?? null,
      selectedEffort: this.effort ?? null,
      activeProvider,
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

  markNeedsRebuild(): void {
    this.assertNotDisposed()
    this._needsRebuild = true
  }

  getAdditionalDirectoriesSnapshot(): string[] {
    return [...this.additionalDirectories]
  }

  async switchCwd(nextCwd: string, gitBranch?: string | null): Promise<void> {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    const branchChanged = gitBranch !== undefined && gitBranch !== this._gitBranch
    if (this._cwd === nextCwd && !branchChanged) return
    this._cwd = nextCwd
    if (gitBranch !== undefined) this._gitBranch = gitBranch
    this.emitInitReady()
    this.notifyStateChange()
    if (!this.backendStarted) return
    if (this._status === 'streaming' || this._status === 'starting' || this._status === 'interrupting' || this.backend.hasActiveBackgroundTasks?.()) {
      this._needsRebuild = true
      return
    }
    await this.waitForRuntimeRelease()
    this.assertNotDisposed()
    await this.backend.rebuild(this.buildBackendStartOpts())
  }

  private buildBackendStartOpts(): BackendStartOptions {
    this.abortController = new AbortController()
    this.applyAcpAgentToConfig()
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
      apiProviderId: this._apiProviderId,
      systemPromptAppend: this.systemPromptAppend,
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.backendStarted) return
    if (this._startPromise) return this._startPromise
    this._status = 'starting'
    const startOpts = this.buildBackendStartOpts()
    this._startPromise = (async () => {
      try {
        await this.backend.start(startOpts)
        this.backendStarted = true
        if ((this._status as SessionStatus) === 'starting') this._status = 'ended'
      } catch (err) {
        if ((this._status as SessionStatus) === 'starting') this._status = 'idle'
        this.backendStarted = false
        throw err
      } finally {
        this._startPromise = null
      }
    })()
    return this._startPromise
  }

  private forwardEvent(event: AgentEvent): AgentEvent {
    this._lastEventAt = Date.now()
    this.touchRuntimeActivity()
    if (event.type === 'permission_request') {
      log.info('[Session.forwardEvent] permission_request sessionId=%s listeners=%d requestId=%s', this.id, this.eventListeners.size, event.request.requestId)
    }
    if (event.type === 'queued_message_consumed') {
      const pending = this._pendingQueuedRequests.get(event.clientMessageId)
      if (pending) {
        this.appendUserMessage(pending.request, pending.providerOrigin)
        this._pendingQueuedRequests.delete(event.clientMessageId)
      }
    } else if (event.type === 'message_start') {
      this._currentMessageId = event.message.id
    } else if (
      event.type === 'message_complete' ||
      event.type === 'message_interrupted' ||
      event.type === 'message_error'
    ) {
      this._currentMessageId = null
    }
    const sequenced = event.seq === undefined
      ? ({ ...event, ...nextEventSeq() } as AgentEvent)
      : event
    this.applyReducer(sequenced)
    const outbound = this.enrichOutboundEvent(sequenced)
    const existingProjectPath = (sequenced as { projectPath?: string }).projectPath
    const tagged = { ...outbound, sessionId: this.id, projectPath: existingProjectPath ?? this.projectPath } as AgentEvent
    const traceMessageId = (event as Record<string, unknown>).messageId as string | undefined
      ?? this._currentMessageId
      ?? ''
    trace('agent.emit', event.type, tagged, traceMessageId)
    if (event.type === 'permission_request') {
      trace('permission.flow', 'forward', { sessionId: this.id, projectPath: this.projectPath, toolName: event.request.toolName }, event.request.requestId)
    }
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

  private enrichOutboundEvent(event: AgentEvent): AgentEvent {
    if (this.harnessId !== 'codex' || event.type !== 'message_complete') return event
    const completedMessage = this._messages.find((message) => message.id === event.messageId)
    const consumedTokens = completedMessage?.metadata?.consumedTokens
    if (!consumedTokens) return event
    return {
      ...event,
      metadata: {
        ...event.metadata,
        consumedTokens: event.metadata?.consumedTokens ?? consumedTokens,
      },
    }
  }

  private noteMessageDiff(prev: readonly ChatMessage[], next: readonly ChatMessage[]): void {
    for (const id of collectChangedMessageIds(prev, next)) {
      this._dirtyMessageIds.add(id)
    }
  }

  private replaceMessages(next: ChatMessage[], opts?: { fullPersist?: boolean }): void {
    const prev = this._messages
    this.noteMessageDiff(prev, next)
    this._messages = next
    if (opts?.fullPersist) this._forceFullPersist = true
  }

  private applyReducer(event: AgentEvent): void {
    if (this.harnessId === 'claude' || this.harnessId === 'acp' || this.harnessId === 'opencode') {
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
      this.replaceMessages(next.messages)
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
        if (!existing) this.replaceMessages([...this._messages, event.message])
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
          model: codexMeta?.model as string | undefined,
        })
        this.replaceMessages(next.messages)
        this._totalCostUsd = next.totalCostUsd
        this._contextTokens = next.contextTokens
        this._streamingTokensByMessageId = next.streamingTokensByMessageId
        this._lastUsageByMessageId = next.lastUsageByMessageId
        return
      }
      const next = applyCodexEventToRuntime(runtime, event)
      this.replaceMessages(next.messages)
      this._totalCostUsd = next.totalCostUsd
      this._contextTokens = next.contextTokens
      this._streamingTokensByMessageId = next.streamingTokensByMessageId
      this._lastUsageByMessageId = next.lastUsageByMessageId
    }
  }

  private appendUserMessage(request: SendMessageRequest, providerOrigin: SendProviderOrigin): void {
    // Transcript providerId is local|remote only; host wakes are local-origin bubbles.
    const messageOrigin = providerOrigin === 'remote' ? 'remote' : 'local'
    // Provider still receives request.content (may include collab credential);
    // persist a redacted bubble so DB / remote snapshot / export never leak it.
    const displayRequest = request.source === 'task-notification' && !request.userMessageContent
      ? {
          ...request,
          userMessageContent: [{ type: 'text' as const, text: redactTaskNotificationForDisplay(request.content) }],
        }
      : request
    const userMsg = buildClaudeUserMessage(displayRequest, messageOrigin)
    const wasNew = !this._messages.some((m) => m.id === userMsg.id)
    if (wasNew) {
      this.replaceMessages([...this._messages, userMsg])
    }
    this._lastUserMessageAt = Date.now()
    this.notifyStateChange()
    if (wasNew) {
      this.forwardEvent({ type: 'user_message_appended', message: userMsg } as AgentEvent)
    }
  }

  private notifyStateChange(): void {
    if (!this.onStateChange) return
    // Empty transcript is only persisted after an explicit removal (truncate).
    // Avoid creating DB rows / sessions_started for never-messaged sessions
    // (api provider switch, ghost message_complete, etc.).
    if (this._messages.length === 0 && !this._needsStaleReconcile) return
    const isWorktree = this._cwd !== this.projectPath
    if (this.harnessId === 'acp' && !this._acpAgentId) {
      this._acpAgentId = agentIdFromConfig(this.providerConfig)
    }
    const submittedDirty = [...this._dirtyMessageIds]
    const forceFull = this._forceFullPersist
    const submittedStaleReconcile = this._needsStaleReconcile
    const messagePersistMode = forceFull
      ? ({ kind: 'full' } as const)
      : ({ kind: 'incremental', dirtyMessageIds: submittedDirty } as const)
    try {
      this.onStateChange({
        sid: this.id,
        projectPath: this.projectPath,
        providerId: this.providerId,
        messages: this._messages,
        totalCostUsd: this._totalCostUsd,
        contextTokens: this._contextTokens,
        title: this.computeTitle(),
        isWorktree,
        worktreePath: isWorktree ? this._cwd : null,
        gitBranch: this._gitBranch,
        worktreeMissing: this._missingWorktreePath !== null,
        apiProviderId: this._apiProviderId,
        acpAgentId: this._acpAgentId,
        providerSessionId: this._providerSessionId,
        messagePersistMode,
      })
      if (forceFull) {
        this._dirtyMessageIds.clear()
        this._forceFullPersist = false
      } else {
        for (const id of submittedDirty) this._dirtyMessageIds.delete(id)
      }
      if (submittedStaleReconcile) this._needsStaleReconcile = false
    } catch (err) {
      // Retain dirty ids / full / stale-reconcile flags for retry on the next notify.
      log.warn('[Session] onStateChange hook error:', err)
    }
  }

  setTitle(title: string, source: 'user' | 'agent'): void {
    if (this._status === 'disposed') return
    const trimmed = title.trim()
    if (!trimmed) return
    if (this._title === trimmed) return
    this._title = trimmed
    try {
      dbRenameSession(this.id, trimmed, source)
    } catch (err) {
      log.warn('[Session] dbRenameSession error:', err)
    }
    if (this.backendStarted && this.backend.setTitle) {
      void this.backend.setTitle(trimmed).catch((err) => log.debug('[Session] provider title sync failed:', err))
    }
    this.forwardEvent({ type: 'session_title_changed', sessionId: this.id, title: trimmed, source } as AgentEvent)
  }

  emitHostEvent(event: AgentEvent): void {
    if (this._status === 'disposed') return
    this.forwardEvent(event)
  }

  /**
   * Append a user-role bubble to the transcript without forwarding it to the model.
   * Used for multi-agent mailbox traffic so humans can see peer messages.
   */
  appendTranscriptMessage(message: ChatMessage): void {
    if (this._status === 'disposed') return
    if (this._messages.some((m) => m.id === message.id)) return
    this._messages = [...this._messages, message]
    this.notifyStateChange()
    this.forwardEvent({ type: 'user_message_appended', message } as AgentEvent)
  }

  /**
   * Wake the agent after a host background task settles.
   * Mid-turn: backend hook (Claude SDK push, Codex steer, or queue).
   * Idle: always Session.send so synthetic turns take `_sendChain` / status machine.
   */
  async injectTaskNotification(content: string): Promise<void> {
    if (this._status === 'disposed') return
    const text = content.trim()
    if (!text) return
    this.touchRuntimeActivity()
    try {
      await this.ensureStarted()
    } catch (err) {
      log.warn('[Session] injectTaskNotification ensureStarted failed sid=%s: %s', this.id, err instanceof Error ? err.message : String(err))
      return
    }
    if (this.backend.injectTaskNotification) {
      try {
        const handled = await this.backend.injectTaskNotification(text)
        if (handled) return
      } catch (err) {
        log.warn('[Session] injectTaskNotification harness path failed, falling back sid=%s: %s', this.id, err instanceof Error ? err.message : String(err))
      }
    }
    try {
      await this.send(
        {
          ...taskNotificationRequest(text),
          priority: this.isStreaming() ? 'next' : 'now',
        },
        { providerOrigin: 'host' },
      )
    } catch (err) {
      log.warn('[Session] injectTaskNotification fallback send failed sid=%s: %s', this.id, err instanceof Error ? err.message : String(err))
    }
  }

  private computeTitle(): string | null {
    if (this._title) return this._title
    if (this._messages.length === 0) return null
    const title = this.harnessId === 'codex'
      ? extractCodexTitle(this._messages)
      : extractClaudeTitle(this._messages)
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
