import type {
  AgentEvent,
  ChatMessage,
  CodexGoal,
  CodexGoalStatus,
  CodexRunResult,
  CodexUsageInfo,
  ContextUsageInfo,
  ProviderRateLimits,
  McpServerInfo,
  PermissionMode,
  QuestionAnnotations,
  RemoteActiveProvider,
  RewindFilesResult,
  SandboxInfo,
  SandboxMode,
  SendMessageRequest,
} from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
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
import { resolveMiniappCallConfirm, rejectMiniappCallConfirm } from '../mcp/miniapp-call-confirm'
import { resolveWebmcpTrustConfirm, rejectWebmcpTrustConfirm } from '../mcp/browser-webmcp-confirm'
import { forgetWebMcpSessionTrust } from '../mcp/webmcp-trust'
import { resolveConfigConfirm, rejectConfigConfirm } from '../mcp/config-tools'
import { resolveVideoConfirm, rejectVideoConfirm } from '../mcp/media-tools'
import { resolveSessionCleanupConfirm, rejectSessionCleanupConfirm } from '../mcp/session-archive-tools'
import { resolveAutomationConfirm, rejectAutomationConfirm } from '../mcp/automation-tools'
import { resolveDeviceControlConfirm, rejectDeviceControlConfirm } from '../device-agent/control-confirm'
import { nextEventSeq } from './event-seq'
import { notifySessionRecapForeground, notifySessionRecapSessionRemoved } from '../acp/acp-recap-focus'
import { asEffortLevel } from '../acp/acp-config'
import { collectChangedMessageIds } from './message-dirty'
import { messageDialectFor } from './message-dialect'
import {
  redactTaskNotificationForDisplay,
  taskNotificationRequest,
} from './task-notification-queue'
import { buildOrphanTaskNotificationMessage } from './orphan-task-notification'
import { buildModelFallbackMessage, modelFallbackSignature } from './model-fallback-notification'
import {
  LOCAL_OWNER,
  SessionClaimConflictError,
  SessionLockedError,
  SessionWorktreeRemovedError,
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
  /**
   * Project-level workspace folders. Keyed by projectPath, NOT cwd — a worktree
   * session has cwd !== projectPath, which is also why these stay out of the
   * cwd-keyed `ProjectResources`.
   */
  getProjectExtraDirs?: (projectPath: string) => string[]
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

/**
 * Union the project's workspace folders into a caller-supplied directory set.
 *
 * Project folders lead so the result is stable regardless of what the caller
 * knew about; removal still propagates, because an emptied project contributes
 * nothing and the caller's own set is passed through untouched.
 */
function withProjectExtraDirs(
  projectExtraDirs: string[] | undefined,
  requested: readonly string[],
): string[] {
  if (!projectExtraDirs?.length) return [...requested]
  return [...new Set([...projectExtraDirs, ...requested])]
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
  /**
   * Backend-reported stream liveness, maintained from the event stream rather
   * than from the `send()` call.
   *
   * `_status` only spans an awaited `Session.send`, and a *continuation* turn
   * never comes back through it: Claude's `priority:'next'` send returns as
   * soon as the message is pushed and the real turn is flushed at the next step
   * boundary, `QueuedUserMessageQueue.flush()` re-enters `backend.send`
   * directly, and Codex drains its durable queue inside the live stream. During
   * those turns `_status` is already `'ended'`, which used to make
   * `interrupt()` return false without ever reaching `backend.interrupt()` —
   * Stop looked acknowledged while the agent kept writing.
   */
  private _backendStreaming = false
  /**
   * Bumped every time a run opens. `interrupt()` clears `_backendStreaming` in a
   * `finally` that awaits the backend, so a turn started during that await would
   * otherwise be cleared by a decision made before it existed.
   */
  private _streamGeneration = 0
  private _sendChain: Promise<void> = Promise.resolve()
  private _currentMessageId: string | null = null
  private _computerUseTurnGeneration = 0
  private _computerUseTurnGenerations = new Map<string, number>()
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
  /** Rename a new voice-only session from its first complete user utterance. */
  private _realtimeTitlePending = false
  private _totalCostUsd = 0
  private _contextTokens = 0
  private _taskProgress: Record<string, TaskProgressEntry> = {}
  /**
   * Terminal task ids already observed (or explicitly stopped) in this Session.
   * The set intentionally outlives an idle backend runtime release so Claude's
   * resume-time orphan scan cannot mint a second transcript row for the task.
   */
  private _settledBackgroundTaskIds = new Set<string>()
  /** Last announced model swap, so a retry loop cannot mint the same row twice. */
  private _lastModelFallbackSignature: string | null = null
  private _streamingTokensByMessageId: Record<string, { input: number; output: number }> = {}
  private _lastUsageByMessageId: Record<string, CodexUsageInfo | null> = {}

  private permissionMode: PermissionMode
  private sandboxInfo: SandboxInfo
  private effort: SendMessageRequest['effort']
  private model: string | undefined
  /** Effective set = project scope ∪ caller scope. Never assigned directly. */
  private additionalDirectories: string[]
  /**
   * The half of the directory set the caller owns (session `/add-dir`, harness
   * config scopes). Kept apart from the project's own folders so the effective
   * set can be recomputed every turn without a caller having to know about —
   * or resend — folders it never managed.
   */
  private callerScopedDirs: string[]
  private _apiProviderId: string | null = null
  private _acpAgentId: string | null = null
  private systemPromptAppend: string | undefined

  private homedir: string
  private getProjectResources?: (cwd: string) => ProjectResources
  private getProjectExtraDirs?: (projectPath: string) => string[]
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
  /** Last ACP catalog events — replayed for mini-window / late subscribers. */
  private _cachedAcpModels: AgentEvent | null = null
  private _cachedAcpModes: AgentEvent | null = null
  private _cachedAcpCommands: AgentEvent | null = null
  /**
   * Accumulated composer/status-bar settings. Replayed as agent_setting_change
   * and exposed on LiveSessionSnapshot.uiSettings so mini-window paints correctly.
   */
  private _uiSettings: import('@superone/shared/agent-types').SessionSettingsPatch = {}
  private _pendingQueuedRequests = new Map<string, { request: SendMessageRequest; providerOrigin: SendProviderOrigin }>()
  /** Shared so concurrent ensureStarted callers await the same backend.start(). */
  private _startPromise: Promise<void> | null = null

  private _foregroundRefCount = 0

  /**
   * A session can be rendered in more than one place at once (e.g. a mosaic tile
   * and a mini window on the same session) — ref-count so unmounting one place
   * doesn't drop foreground status while another is still visible.
   *
   * Transitions 0↔>0 also drive ACP auto session-recap away/return tracking
   * (user switched chats), not whole-window OS focus.
   */
  setForeground(visible: boolean): void {
    const prev = this._foregroundRefCount
    this._foregroundRefCount = Math.max(0, this._foregroundRefCount + (visible ? 1 : -1))
    const next = this._foregroundRefCount
    if (prev === next) return
    if (this.harnessId !== 'acp') return
    // Empty drafts have nothing to summarize — never enter the away-recap poll
    // (dev harness-switch spam used to fire x.ai/recap for every abandoned draft).
    if (this._messages.length === 0) {
      if (prev > 0 && next === 0) {
        notifySessionRecapSessionRemoved(this.id)
      }
      return
    }
    if (prev > 0 && next === 0) {
      notifySessionRecapForeground(this.id, false)
    } else if (prev === 0 && next > 0) {
      notifySessionRecapForeground(this.id, true)
    }
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
      // Whether the runtime survived is the authoritative answer, and it is only
      // knowable after the await. A backend can decline to release: Claude waits
      // on its old iterator, and a host wake (task notification / download
      // settle) reaches `backend.injectTaskNotification` without taking
      // `_runtimeRelease`, so a brand-new runtime with a live turn can exist by
      // the time this resolves. Clearing then would erase it.
      //
      // The mirror case needs no such care: no runtime means no stream, whatever
      // events the teardown flushed on the way out, and no terminal event will
      // ever arrive to correct a flag left set here.
      if (this.backend.hasActiveRuntime()) return false
      this._backendStreaming = false
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

  /**
   * The backend announced a run. Always a new generation, including when one was
   * already in flight — the interrupt this must outrank was issued against the
   * *previous* run, and that is exactly the case where the backend admits a
   * queued turn before it acks the stop.
   *
   * Only monotonicity is contractual, not the count: a normal turn bumps twice
   * (`message_start` then `status_change: 'streaming'`), and OpenCode re-announces
   * on busy/retry. Every consumer asks "did this change while I was awaiting?",
   * never "how many runs have there been".
   */
  private openBackendStream(): void {
    this._streamGeneration += 1
    this._backendStreaming = true
  }

  /**
   * The only place a backend runtime is replaced.
   *
   * Replacing the runtime destroys whatever stream was running on it, and no
   * backend reports that as a turn event — Claude's SDK iterator just reaches a
   * clean EOF (`claude-query.ts`, "loop ended normally"), which emits nothing.
   * Without clearing here the session would believe a killed stream is still
   * live and never release its runtime again.
   */
  private async rebuildBackend(): Promise<void> {
    this._backendStreaming = false
    await this.backend.rebuild(this.buildBackendStartOpts())
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

  /**
   * Composer withdraws when the worktree checkout is gone. Main process must
   * refuse new turns the same way — collab / mobile / automation otherwise
   * bypass the READ ONLY banner. Live deletion of the directory is detected
   * at resume (`missingWorktreePath`) and by collaboration's DB-path check.
   */
  private rejectIfWorktreeRemoved(): SessionWorktreeRemovedError | null {
    if (!this._missingWorktreePath) return null
    return new SessionWorktreeRemovedError(this.id, this._missingWorktreePath)
  }

  private assertCanSend(providerOrigin: SendProviderOrigin): void {
    const worktreeErr = this.rejectIfWorktreeRemoved()
    if (worktreeErr) throw worktreeErr
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
    this.callerScopedDirs = [...(opts.additionalDirectories ?? [])]
    // Assigned before the seed below, which reads it.
    this.getProjectExtraDirs = opts.getProjectExtraDirs
    this.additionalDirectories = this.resolveEffectiveDirs()
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
    this._uiSettings = {
      permissionMode: this.permissionMode,
      sandboxInfo: this.sandboxInfo,
      selectedModel: this.model ?? null,
      selectedEffort: this.effort ?? null,
      apiProviderId: this._apiProviderId,
    }
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
      this.mergeUiSettings({ permissionMode: mode })
      this.forwardEvent({ type: 'permission_mode_change', mode })
      this.forwardEvent({ type: 'agent_setting_change', patch: { permissionMode: mode } } as AgentEvent)
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
      acpAgentId: this._acpAgentId,
      selectedModel: this.model ?? null,
      selectedEffort: this.effort ?? null,
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
      this.applyAcpAgentToConfig()
    }
    this._needsRebuild = true
    this.notifyStateChange()
    const resolvedProvider = this.getActiveProvider?.(this.harnessId, apiProviderId) ?? null
    this.mergeUiSettings({ apiProviderId, apiProvider: resolvedProvider })
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
        this.applyAcpAgentToConfig()
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
    const isQueued = (request.priority === 'next' || request.priority === 'later') && this.isStreaming()
    if (isQueued) {
      this.assertNotDisposed()
      // Stage the caller half first so the check below — and the normal path,
      // if we fall through to it — both see what this request actually asks for.
      if (request.additionalDirs !== undefined) {
        this.callerScopedDirs = [...request.additionalDirs]
      }
      // A queued send rides the in-flight backend, whose roots are fixed for the
      // turn, and the backend flushes its own queue at turn end without coming
      // back through here. Flagging a rebuild would therefore land one turn too
      // late, so a changed root set takes the existing promote-to-normal path.
      const queuedDirsChanged = this.dirsReachBackend() && !sameStringArray(this.resolveEffectiveDirs(), this.additionalDirectories)
      if (!this.backendStarted) {
        log.warn('[Session] queued send before backend start sid=%s — promoting to normal send', this.id)
      } else if (this._needsRebuild) {
        log.info('[Session] queued send promoted to normal send sid=%s (pending rebuild)', this.id)
      } else if (queuedDirsChanged) {
        log.info('[Session] queued send promoted to normal send sid=%s (workspace roots changed)', this.id)
      } else {
        if (request.clientMessageId) {
          this._pendingQueuedRequests.set(request.clientMessageId, { request, providerOrigin })
        }
        try {
          await this.backend.send(request)
        } catch (error) {
          if (request.clientMessageId) this._pendingQueuedRequests.delete(request.clientMessageId)
          throw error
        }
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
      // The project's workspace folders are re-applied here rather than trusted
      // from the caller. A renderer that has not hydrated them — a detached
      // session window, a promoted draft, a mini-app-opened project — would
      // otherwise send a set without them, which reads as a removal and both
      // revokes the agent's access and rebuilds the backend for nothing.
      if (request.additionalDirs !== undefined) this.callerScopedDirs = [...request.additionalDirs]
      const nextDirs = this.resolveEffectiveDirs()
      const dirsChanged = this.dirsReachBackend() && !sameStringArray(nextDirs, this.additionalDirectories)
      if (request.effort !== undefined) this.effort = request.effort
      if (request.model !== undefined) this.model = request.model
      this.additionalDirectories = nextDirs
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
        await this.rebuildBackend()
        this._needsRebuild = false
      } else {
        await this.ensureStarted()
        // Codex snapshots its MCP tool set when the thread starts — including at prewarm,
        // before a first-turn @-mention can register app tools. The just-adopted prewarmed
        // thread is then stale, so rebuild to re-establish the connection on a fresh snapshot.
        // Claude's in-process MCP server reflects the live tool set, so it needs no rebuild.
        if (needsRebuild && this.harnessId === 'codex') {
          log.info('[Session] rebuilding codex backend post-start to pick up tools registered before first send sid=%s', this.id)
          await this.rebuildBackend()
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
    // Not `_status`-only: a continuation turn runs with `_status === 'ended'`,
    // and refusing here is what let the agent keep streaming past Stop.
    if (!this.isStreaming()) return false
    this.touchRuntimeActivity()
    const prev = this._status
    const generation = this._streamGeneration
    this._status = 'interrupting'
    // Codex 149 persists queued submissions and pauses them after interruption.
    // Keep the host-side transcript entries so the user can resume or delete them.
    if (this.harnessId !== 'codex') this._pendingQueuedRequests.clear()
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
      // The backend owns the terminal event, but an interrupt that never lands
      // one must not leave the session permanently "busy". Only clear the run we
      // set out to stop: `backend.interrupt()` is awaited, and a queued turn that
      // opened meanwhile is live work this decision predates.
      if (this._streamGeneration === generation) this._backendStreaming = false
      // Agent no longer controlling — drop software cursor + menu-bar chip.
      void this.clearComputerUseVisuals('interrupt')
    }
    return true
  }

  async startRealtimeVoice(request: import('@superone/shared/agent-types').RealtimeVoiceStartRequest): Promise<void> {
    this.assertNotDisposed()
    if (this.harnessId !== 'codex' || !this.backend.startRealtimeVoice) {
      throw new Error('Realtime voice is not supported by this agent.')
    }
    if (this.isStreaming()) throw new Error('Wait for the current turn to finish before starting voice.')
    await this.waitForRuntimeRelease()
    if (request.additionalDirs !== undefined) this.callerScopedDirs = [...request.additionalDirs]
    const nextDirs = this.resolveEffectiveDirs()
    const dirsChanged = this.dirsReachBackend() && !sameStringArray(nextDirs, this.additionalDirectories)
    this.additionalDirectories = nextDirs
    if (dirsChanged && this.backendStarted) {
      const applied = (await this.backend.setAdditionalDirectories?.(this.additionalDirectories)) ?? false
      if (!applied) await this.rebuildBackend()
    }
    const shouldTitleFromFirstUtterance = this._title === null && this._messages.length === 0
    await this.ensureStarted()
    await this.backend.startRealtimeVoice(request)
    if (shouldTitleFromFirstUtterance && this._title === null && this._messages.length === 0) {
      this._realtimeTitlePending = true
    }
    // A voice-only conversation has no SuperOne messages yet, but it is still a
    // durable product session because Codex has now created/attached its thread.
    this.notifyStateChange(true)
  }

  async stopRealtimeVoice(): Promise<void> {
    if (this._status === 'disposed') return
    await this.backend.stopRealtimeVoice?.()
  }

  async getRealtimeTimeline(): Promise<import('@superone/shared/agent-types').RealtimeTimelineResult> {
    this.assertNotDisposed()
    if (this.harnessId !== 'codex' || !this.backend.getRealtimeTimeline) {
      return { segments: [], threadMessages: [], activeRealtimeSessionId: null, hasTimeline: false }
    }
    await this.waitForRuntimeRelease()
    await this.ensureStarted()
    return this.backend.getRealtimeTimeline()
  }

  async requestSessionRecap(auto: boolean): Promise<boolean> {
    if (this._status === 'disposed') return false
    if (this.harnessId !== 'acp') return false
    // No transcript → nothing for the agent to recap (skip auto and manual).
    if (this._messages.length === 0) return false
    const busy =
      this._status === 'streaming'
      || this._status === 'starting'
      || this._status === 'interrupting'
    if (busy) return false
    if (this.backend.getPendingInteractions().length > 0) return false
    if (!this.backend.hasActiveRuntime()) return false
    try {
      return (await this.backend.requestSessionRecap?.(auto)) ?? false
    } catch (err) {
      log.debug(
        '[Session] requestSessionRecap failed sid=%s: %s',
        this.id,
        err instanceof Error ? err.message : String(err),
      )
      return false
    }
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
    this.mergeUiSettings({ permissionMode: mode })
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
    const prev = this.sandboxInfo
    this.sandboxInfo = next
    this.mergeUiSettings({ sandboxInfo: next })
    if (this.backendStarted) {
      try {
        await this.backend.setSandbox(next)
      } catch (err) {
        this.sandboxInfo = prev
        this.mergeUiSettings({ sandboxInfo: prev })
        log.warn('[Session] backend.setSandbox failed:', err)
        throw err
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
    this.mergeUiSettings(patch)
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
      this.mergeUiSettings({ selectedAcpModeId: opts.mode })
      void this.setSessionMode(opts.mode)
    }
    if (!changed && opts.mode === undefined) return
    const patch: import('@superone/shared/agent-types').SessionSettingsPatch = {
      selectedModel: this.model ?? null,
      selectedEffort: this.effort ?? null,
      ...(opts.mode ? { selectedAcpModeId: opts.mode } : {}),
    }
    this.mergeUiSettings(patch)
    this.forwardEvent({
      type: 'agent_setting_change',
      selectedModel: this.model ?? null,
      selectedEffort: this.effort ?? null,
      patch,
    })
    if (changed) this.notifyStateChange()
  }

  getSelectedModel(): string | undefined { return this.model }
  getSelectedEffort(): SendMessageRequest['effort'] { return this.effort }

  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], decision?: 'cancel', formAnswers?: Record<string, unknown>): boolean {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    // Host-owned confirms (config / video / miniapp / WebMCP / collab) must resolve here
    // *before* backends so every harness unblocks the waiting tool executor.
    // Claude/Codex backends also call these for history; second resolve is a no-op.
    if (decision === 'cancel') {
      if (rejectSessionAgentsConfirm(requestId, 'User cancelled')) return true
      if (rejectMiniappCallConfirm(requestId, reason ?? 'User cancelled')) return true
      if (rejectWebmcpTrustConfirm(requestId, reason ?? 'User cancelled')) return true
      if (rejectConfigConfirm(requestId, 'User cancelled')) return true
      if (rejectVideoConfirm(requestId, 'User cancelled')) return true
      if (rejectSessionCleanupConfirm(requestId, reason ?? 'User cancelled')) return true
      if (rejectAutomationConfirm(requestId, reason ?? 'User cancelled')) return true
      if (rejectDeviceControlConfirm(requestId, reason ?? 'User cancelled')) return true
    } else if (resolveSessionAgentsConfirm(requestId, allow ? 'accept' : 'decline', formAnswers)) {
      return true
    } else if (resolveMiniappCallConfirm(
      requestId,
      allow ? 'accept' : 'decline',
      alwaysAllow === true,
      reason,
    )) {
      return true
    } else if (resolveWebmcpTrustConfirm(
      requestId,
      allow ? 'accept' : 'decline',
      alwaysAllow === true,
      reason,
      formAnswers,
    )) {
      return true
    } else if (resolveConfigConfirm(requestId, allow ? 'accept' : 'decline', formAnswers)) {
      return true
    } else if (resolveVideoConfirm(requestId, allow ? 'accept' : 'decline', formAnswers)) {
      return true
    } else if (resolveSessionCleanupConfirm(requestId, allow ? 'accept' : 'decline')) {
      return true
    } else if (resolveAutomationConfirm(requestId, allow ? 'accept' : 'decline', formAnswers)) {
      return true
    } else if (resolveDeviceControlConfirm(requestId, allow ? 'accept' : 'decline', reason)) {
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

  /**
   * Reading the gauge is not agent activity — deliberately no `touchRuntimeActivity()`.
   * Also no `backendStarted` gate: ACP prewarm already has a runtime that can
   * answer `_x.ai/billing` before the first `send()` flips that flag.
   */
  async getRateLimits(): Promise<ProviderRateLimits | null> {
    return (await this.backend.getRateLimits?.()) ?? null
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

  async rewindConversation(userMessageId: string): Promise<RewindFilesResult> {
    this.assertNotDisposed()
    if (this.harnessId !== 'codex') return { canRewind: true }
    const userIndex = this._messages.findIndex((message) => message.id === userMessageId)
    const turnId = userIndex >= 0
      ? this._messages.slice(userIndex + 1).find((message) => message.role === 'assistant')?.metadata?.codex?.turnId
      : undefined
    if (!turnId) return { canRewind: false, error: 'Codex turn boundary not found' }
    await this.ensureStarted()
    if (!this.backend.rewindConversation) {
      return { canRewind: false, error: 'Conversation rewind is not supported by Codex' }
    }
    return this.backend.rewindConversation(turnId)
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

  async startQueuedMessages(): Promise<boolean> {
    this.assertNotDisposed()
    if (this.harnessId !== 'codex' || this.isStreaming()) return false
    await this.ensureStarted()
    if (!this.backend.startQueuedMessages) return false
    this.touchRuntimeActivity()
    this._status = 'streaming'
    try {
      return await this.backend.startQueuedMessages()
    } finally {
      if ((this._status as SessionStatus) !== 'disposed') this._status = 'ended'
    }
  }

  /** Cursor local: expire wedged run via LocalSendOptions.force. */
  async forceRecoverRun(message?: string): Promise<void> {
    this.assertStarted()
    const backend = this.backend as SessionBackend & {
      forceRecover?: (msg?: string) => Promise<void>
    }
    if (typeof backend.forceRecover !== 'function') {
      throw new Error(`forceRecover is not supported by ${this.harnessId}`)
    }
    await backend.forceRecover(message)
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
    // Same authority as `send`: a hint carries the caller half only, so the
    // project's folders are unioned here too. Otherwise a renderer that has
    // not hydrated warms a slot whose key can never match the real turn.
    const dirs = hint?.additionalDirs === undefined
      ? this.additionalDirectories
      : withProjectExtraDirs(this.getProjectExtraDirs?.(this.projectPath), hint.additionalDirs)
    const opts: BackendStartOptions = {
      sessionId: this.id,
      projectPath: this.projectPath,
      cwd: this.cwd,
      config: this.providerConfig,
      permissionMode: this.permissionMode,
      sandboxInfo: this.sandboxInfo,
      effort: hint?.effort ?? asEffortLevel(this._uiSettings.selectedAcpModeId) ?? this.effort,
      model: hint?.model ?? this.model,
      additionalDirectories: this.backendDirs(dirs),
      abortController: new AbortController(),
      providerSessionId: this._providerSessionId ?? undefined,
      apiProviderId: this._apiProviderId,
      systemPromptAppend: this.systemPromptAppend,
      agentName: this.computeTitle()?.trim() || undefined,
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

  /**
   * Record the dsh agent preset this session composes from.
   *
   * It lands in `providerConfig` rather than on a field of its own because that
   * is what the backend reads at creation — and creation is the only moment it
   * matters: a resumed session recomposes from its own durable log, and a live
   * one switches through the roster.
   * @param presetId - the preset to compose from, or `null` to take the default.
   */
  setAgentPreset(presetId: string | null): void {
    this.assertNotDisposed()
    if (this.harnessId !== 'dsh') return
    const current = (this.providerConfig as { agentPreset?: string } | null)?.agentPreset ?? null
    if (current === presetId) return
    this.providerConfig = { ...(this.providerConfig ?? {}), agentPreset: presetId ?? undefined }
    this._needsRebuild = true
    this.notifyStateChange()
  }

  private applyAcpAgentToConfig(): void {
    if (this.harnessId !== 'acp' || !this._acpAgentId) return
    this.providerConfig = withAgentId(this.providerConfig, this._acpAgentId)
  }

  async dequeueMessage(clientMessageId: string): Promise<boolean> {
    if (!this.backendStarted) return false
    const removed = await this.backend.dequeueMessage(clientMessageId)
    if (removed) this._pendingQueuedRequests.delete(clientMessageId)
    return removed
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
      case 'codex.steer_queued': {
        if (this.harnessId !== 'codex' || !this.isStreaming()) {
          throw new Error('Queued message can only steer an active Codex turn')
        }
        if (!this.backend.handleCommand) throw new Error(`Session ${this.id} harness=${this.harnessId} does not support backend commands`)
        await this.backend.handleCommand(cmd)
        return
      }
      case 'claude.steer_queued': {
        if (this.harnessId !== 'claude' || !this.isStreaming()) {
          throw new Error('Queued message can only steer an active Claude turn')
        }
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
      case 'session.set_additional_dirs': {
        // `cmd.dirs` is the SESSION scope only — mobile sends it when the user
        // edits session dirs. Writing it raw would drop the project's folders
        // from a live backend, and the next mobile turn sends no directory set
        // at all, so nothing would put them back.
        this.callerScopedDirs = [...cmd.dirs]
        const nextDirs = this.resolveEffectiveDirs()
        if (sameStringArray(nextDirs, this.additionalDirectories)) return
        this.additionalDirectories = nextDirs
        if (!this.backendStarted || !this.dirsReachBackend()) return
        const applied = (await this.backend.setAdditionalDirectories?.(nextDirs)) ?? false
        if (applied) return
        if (!this.isStreaming() && !this.backend.hasActiveBackgroundTasks?.()) {
          await this.rebuildBackend()
          this._needsRebuild = false
        } else {
          this._needsRebuild = true
        }
        return
      }
      case 'claude.stop_task': {
        if (this.harnessId !== 'claude') return
        if (!this.backend.stopTask) return
        await this.backend.stopTask(cmd.taskId)
        this._settledBackgroundTaskIds.add(cmd.taskId)
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
    return this._status === 'streaming'
      || this._status === 'starting'
      || this._status === 'interrupting'
      || this._backendStreaming
  }

  truncateMessagesAt(checkpointId: string): void {
    const idx = this._messages.findIndex((m) => m.checkpointId === checkpointId)
    if (idx < 0) return
    // Prefix slice: remaining message objects keep identity; stale-id delete removes the rest.
    this._messages = this._messages.slice(0, idx)
    this._totalCostUsd = 0
    this._contextTokens = 0
    this._taskProgress = {}
    this._settledBackgroundTaskIds.clear()
    this._lastModelFallbackSignature = null
    this._streamingTokensByMessageId = {}
    this._lastUsageByMessageId = {}
    // Allow empty-transcript persist (e.g. rewind to first checkpoint at index 0).
    this._needsStaleReconcile = true
    this.notifyStateChange()
  }

  async dispose(): Promise<void> {
    if (this._status === 'disposed') return
    if (this.harnessId === 'acp') {
      notifySessionRecapSessionRemoved(this.id)
    }
    trace('session.lifecycle', 'dispose', { sid: this.id, owner: this._owner.kind === 'remote' ? this._owner.deviceId : 'local', subscribers: [...this._subscribers] })
    this._status = 'disposed'
    this._backendStreaming = false
    this._pendingQueuedRequests.clear()
    forgetWebMcpSessionTrust(this.id)
    void this.clearComputerUseVisuals('dispose')
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
    // Full composer UI state when it diverges from defaults. Live snapshots also
    // carry uiSettings for mini-window cold paint; this covers Session.on() late
    // subscribers without flooding every listener with empty defaults.
    if (this.hasMeaningfulUiSettings()) {
      // A replay paints what this session KNOWS. A session created by the first send
      // (or by setPermissionMode on a draft) has no model/effort yet — replaying those
      // as null would be read as "clear", wiping the composer's model label.
      const { selectedModel, selectedEffort, ...rest } = this.getUiSettings()
      const known = {
        ...rest,
        ...(selectedModel != null ? { selectedModel } : {}),
        ...(selectedEffort != null ? { selectedEffort } : {}),
      }
      out.push({
        type: 'agent_setting_change',
        ...(selectedModel != null ? { selectedModel } : {}),
        ...(selectedEffort != null ? { selectedEffort } : {}),
        patch: known,
        sessionId: this.id,
        projectPath: this.projectPath,
      } as AgentEvent)
    }
    // ACP model/mode/command catalogs are one-shot at runtime start — cache them
    // so mini-window live sync can show model names without re-probing the agent.
    if (this._cachedAcpModels) out.push(this._cachedAcpModels)
    if (this._cachedAcpModes) out.push(this._cachedAcpModes)
    if (this._cachedAcpCommands) out.push(this._cachedAcpCommands)
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
      additionalDirectories: this.additionalDirectories,
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

  /** Accumulated composer/status-bar settings for live snapshot + multi-window paint. */
  getUiSettings(): import('@superone/shared/agent-types').SessionSettingsPatch {
    return {
      ...this._uiSettings,
      permissionMode: this.permissionMode,
      sandboxInfo: this.sandboxInfo,
      selectedModel: this.model ?? this._uiSettings.selectedModel ?? null,
      selectedEffort: this.effort ?? this._uiSettings.selectedEffort ?? null,
      apiProviderId: this._apiProviderId,
    }
  }

  private mergeUiSettings(patch: import('@superone/shared/agent-types').SessionSettingsPatch): void {
    this._uiSettings = { ...this._uiSettings, ...patch }
  }

  /** Whether UI settings differ enough from fresh-session defaults to warrant event replay. */
  private hasMeaningfulUiSettings(): boolean {
    const ui = this.getUiSettings()
    if (ui.permissionMode && ui.permissionMode !== 'default') return true
    if (ui.selectedModel) return true
    if (ui.selectedEffort) return true
    if (ui.selectedAcpModeId) return true
    if (ui.selectedCodexModel) return true
    if (ui.selectedCodexReasoningEffort) return true
    if (ui.selectedCodexServiceTier) return true
    if (ui.selectedCodexPermissionPreset && ui.selectedCodexPermissionPreset !== 'default') return true
    if (ui.selectedCodexCollaborationMode && ui.selectedCodexCollaborationMode !== 'default') return true
    if (ui.openCodeAgentId) return true
    if (ui.apiProviderId) return true
    if (ui.sandboxInfo) {
      try {
        const def = coerceSandboxInfo(getDefaultSandbox())
        if (
          ui.sandboxInfo.enabled !== def.enabled
          || ui.sandboxInfo.autoAllowBash !== def.autoAllowBash
        ) return true
      } catch {
        return true
      }
    }
    return false
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

  /**
   * Effective directory set for the next turn.
   *
   * Recomputed rather than stored so a project's folders can change under a
   * live session without every caller having to resend them — scheduled sends,
   * automations, mobile turns and collaboration turns all send no directory
   * set at all.
   */
  private resolveEffectiveDirs(): string[] {
    return withProjectExtraDirs(this.getProjectExtraDirs?.(this.projectPath), this.callerScopedDirs)
  }

  /**
   * Does a change to the working-directory set have to reach the backend?
   *
   * The set itself is tracked for every harness — SuperOne derives its own
   * file-read allowlists from it, and a project's folders belong to the project
   * rather than to whichever harness is selected. But `setAdditionalDirectories`
   * is optional on `SessionBackend`, so for a harness that reads only its cwd
   * the optional call resolves `false` and every edit would tear down and
   * rebuild a backend over a folder it will never look at. Hiding the UI cannot
   * prevent that: project folders are shared, and a Claude session can have
   * added them already.
   */
  private dirsReachBackend(): boolean {
    return HARNESS_CAPABILITIES[this.harnessId]?.supportsAdditionalDirs ?? false
  }

  /** The directory set as the backend should see it — nothing, if it cannot use one. */
  private backendDirs(dirs: readonly string[] = this.additionalDirectories): string[] | undefined {
    if (!this.dirsReachBackend() || dirs.length === 0) return undefined
    return [...dirs]
  }

  /**
   * The caller-owned half only.
   *
   * `additional_dirs_changed` reports this as `sessionAdditionalDirs`, and the
   * renderer writes it straight back into its session scope — so reporting the
   * effective set here would echo the project's folders into caller scope and
   * defeat the split.
   */
  getCallerScopedDirsSnapshot(): string[] {
    return [...this.callerScopedDirs]
  }

  getAdditionalDirectoriesSnapshot(): string[] {
    return [...this.additionalDirectories]
  }

  async switchCwd(nextCwd: string, gitBranch?: string | null): Promise<void> {
    this.assertNotDisposed()
    this.touchRuntimeActivity()
    const branchChanged = gitBranch !== undefined && gitBranch !== this._gitBranch
    if (this._cwd === nextCwd && !branchChanged) return
    if (this._pendingQueuedRequests.size > 0) {
      throw new Error('Cannot switch worktree while Codex queued messages are pending')
    }
    this._cwd = nextCwd
    if (gitBranch !== undefined) this._gitBranch = gitBranch
    this.emitInitReady()
    this.notifyStateChange()
    if (!this.backendStarted) return
    // isStreaming(), not an inline copy of it: a continuation turn runs with
    // `_status === 'ended'`, and rebuilding under it kills the live stream.
    if (this.isStreaming() || this.backend.hasActiveBackgroundTasks?.()) {
      this._needsRebuild = true
      return
    }
    await this.waitForRuntimeRelease()
    this.assertNotDisposed()
    await this.rebuildBackend()
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
      effort: asEffortLevel(this._uiSettings.selectedAcpModeId) ?? this.effort,
      model: this.model,
      additionalDirectories: this.backendDirs(),
      abortController: this.abortController,
      providerSessionId: this._providerSessionId ?? undefined,
      apiProviderId: this._apiProviderId,
      systemPromptAppend: this.systemPromptAppend,
      agentName: this.computeTitle()?.trim() || undefined,
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
    if (
      this._realtimeTitlePending
      && event.type === 'realtime_transcript'
      && event.role === 'user'
      && event.final
    ) {
      const title = event.text.trim().replace(/\s+/g, ' ').slice(0, 100)
      if (title) {
        this._realtimeTitlePending = false
        this.setTitle(title, 'agent')
      }
    }
    // Stream liveness follows the backend, not the send call — see `_backendStreaming`.
    if (event.type === 'status_change') {
      if (event.status === 'streaming') this.openBackendStream()
      else this._backendStreaming = false
    } else if (event.type === 'message_start' && event.message.role === 'assistant') {
      this.openBackendStream()
    } else if (
      event.type === 'message_interrupted'
      || event.type === 'message_error'
    ) {
      // A terminal event for the whole run. `message_complete` is deliberately
      // absent: Codex fires one at every queued-turn boundary while the stream
      // continues, and only `status_change: 'idle'` closes that run.
      this._backendStreaming = false
    }
    if (event.type === 'permission_request') {
      log.info('[Session.forwardEvent] permission_request sessionId=%s listeners=%d requestId=%s', this.id, this.eventListeners.size, event.request.requestId)
    }
    if (event.type === 'queued_message_consumed') {
      const pending = this._pendingQueuedRequests.get(event.clientMessageId)
      if (pending) {
        this.appendUserMessage(pending.request, pending.providerOrigin)
        this._pendingQueuedRequests.delete(event.clientMessageId)
      }
    } else if (event.type === 'queued_messages_restored') {
      const nextPending = new Map<string, { request: SendMessageRequest; providerOrigin: SendProviderOrigin }>()
      for (const message of event.messages) {
        const existing = this._pendingQueuedRequests.get(message.clientMessageId)
        nextPending.set(message.clientMessageId, existing ?? {
          request: {
            content: message.content,
            clientMessageId: message.clientMessageId,
            assistantMessageId: `codex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            priority: 'next',
          },
          providerOrigin: 'local',
        })
      }
      this._pendingQueuedRequests = nextPending
    } else if (event.type === 'message_start') {
      this._currentMessageId = event.message.id
      // Scope the swap dedup to one turn: the same fallback recurring in a later
      // turn is news again, only a retry loop re-announcing it is not.
      this._lastModelFallbackSignature = null
      this._computerUseTurnGeneration += 1
      this._computerUseTurnGenerations.set(
        event.message.id,
        this._computerUseTurnGeneration,
      )
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
    const taskNotificationId = sequenced.type === 'task_notification'
      ? (sequenced.taskId || sequenced.toolUseId)
      : undefined
    const isRepeatedTaskNotification = !!taskNotificationId
      && this._settledBackgroundTaskIds.has(taskNotificationId)
    // Snapshot the pre-reducer transcript: the reducer may attach the result to a
    // tool block, and only its absence from the current turn *before* that
    // decides whether to mint a wake row.
    const orphanNotificationRow = sequenced.type === 'task_notification' && !isRepeatedTaskNotification
      ? buildOrphanTaskNotificationMessage(sequenced, this._messages, this._taskProgress)
      : null
    // The swap outlives its turn, so it lands in the transcript instead of in
    // transient session state that `status: idle` would wipe.
    let modelFallbackRow: ChatMessage | null = null
    if (sequenced.type === 'model_fallback') {
      const signature = modelFallbackSignature(sequenced)
      if (signature !== this._lastModelFallbackSignature) {
        this._lastModelFallbackSignature = signature
        modelFallbackRow = buildModelFallbackMessage(sequenced)
      }
    }
    this.applyReducer(sequenced)
    if (taskNotificationId) this._settledBackgroundTaskIds.add(taskNotificationId)
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
    // Append after the notification itself is out, so the row lands before the
    // assistant turn the wake triggers. appendTranscriptMessage persists it and
    // re-emits it as user_message_appended — renderer and mobile both pick it up
    // without either having to reduce task_notification a second time.
    if (orphanNotificationRow) this.appendTranscriptMessage(orphanNotificationRow)
    if (modelFallbackRow) this.appendTranscriptMessage(modelFallbackRow)
    if (tagged.type === 'acp_models') {
      this._cachedAcpModels = tagged
      // Keep Session.model aligned with agent-advertised selection for snapshots.
      if (tagged.selectedModelId) {
        this.model = tagged.selectedModelId
        this.mergeUiSettings({ selectedModel: tagged.selectedModelId })
      }
    } else if (tagged.type === 'acp_modes') {
      this._cachedAcpModes = tagged
      if (tagged.selectedModeId) {
        this.mergeUiSettings({ selectedAcpModeId: tagged.selectedModeId })
      }
    } else if (tagged.type === 'acp_commands') {
      this._cachedAcpCommands = tagged
    } else if (tagged.type === 'permission_mode_change') {
      this.mergeUiSettings({ permissionMode: tagged.mode })
    }
    // Persist on complete/error and on late Grok metadata that often arrives
    // after message_complete (turn usage + last_turn_summary).
    if (
      event.type === 'message_complete' ||
      event.type === 'message_interrupted' ||
      event.type === 'message_error' ||
      event.type === 'checkpoint_captured' ||
      event.type === 'turn_summary' ||
      (event.type === 'message_usage'
        && (event.inputTokens > 0 || event.outputTokens > 0 || (event.cacheReadTokens ?? 0) > 0))
    ) {
      this.notifyStateChange()
    }
    // Turn finished / aborted / errored → agent is idle; hide CU control chrome.
    if (
      event.type === 'message_complete'
      || event.type === 'message_interrupted'
      || event.type === 'message_error'
    ) {
      const generation = this._computerUseTurnGenerations.get(event.messageId)
      this._computerUseTurnGenerations.delete(event.messageId)
      void this.clearComputerUseVisuals(event.type, generation)
    }
    return tagged
  }

  /**
   * Best-effort: hide Computer Use software cursor + menu-bar chip when this
   * session is no longer actively controlling the desktop.
   */
  private async clearComputerUseVisuals(
    reason: string,
    expectedTurnGeneration?: number,
  ): Promise<void> {
    try {
      const { hideComputerUseVisuals, disposeComputerUseService } = await import(
        '../computer-use/tools'
      )
      if (
        expectedTurnGeneration !== undefined
        && expectedTurnGeneration !== this._computerUseTurnGeneration
      ) {
        return
      }
      await hideComputerUseVisuals(this.id)
      if (reason === 'dispose') {
        disposeComputerUseService(this.id)
      }
      log.debug('[Session] cleared computer-use visuals reason=%s sid=%s', reason, this.id)
    } catch (err) {
      log.debug('[Session] clear computer-use visuals failed: %s', err)
    }
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

  /**
   * Materialize the event into `_messages` through the reducer that speaks this
   * harness's dialect. Dispatch is table-driven (`message-dialect.ts`) so an
   * unregistered harness is a compile error, never a silent default.
   */
  private applyReducer(event: AgentEvent): void {
    const dialect = messageDialectFor(this.harnessId)
    switch (dialect) {
      case 'claude':
        this.applyClaudeDialectEvent(event)
        return
      case 'codex':
        this.applyCodexDialectEvent(event)
        return
      default: {
        const unhandled: never = dialect
        throw new Error(`Unhandled message dialect: ${String(unhandled)}`)
      }
    }
  }

  private applyClaudeDialectEvent(event: AgentEvent): void {
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
  }

  private applyCodexDialectEvent(event: AgentEvent): void {
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
      // A failed turn's detail now travels in metadata (the footer error badge
      // reads it); only fall back to inline text when the harness sent none.
      const errorInfo = event.type === 'message_error'
        ? event.errorInfo ?? { raw: event.error }
        : undefined
      const finalText = (codexMeta?.finalResponse as string | undefined)
        ?? (event.type === 'message_interrupted' ? 'Codex run interrupted.' : '')
      const result = codexMeta ? {
        threadId: (codexMeta.threadId as string | null) ?? null,
        finalResponse: (codexMeta.finalResponse as string | undefined) ?? '',
        usage: (codexMeta.usage as CodexSessionRuntime['lastUsageByMessageId'][string] | null) ?? null,
        turnUsage: codexMeta.turnUsage as CodexRunResult['turnUsage'],
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
      this.replaceMessages(errorInfo
        ? next.messages.map((m) => (m.id === event.messageId
            ? { ...m, metadata: { ...m.metadata, errorInfo } }
            : m))
        : next.messages)
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

  private notifyStateChange(allowEmpty = false): void {
    if (!this.onStateChange) return
    // Empty transcript is only persisted after an explicit removal (truncate).
    // Avoid creating DB rows / sessions_started for never-messaged sessions
    // (api provider switch, ghost message_complete, etc.).
    if (this._messages.length === 0 && !this._needsStaleReconcile && !allowEmpty) return
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
        selectedModel: this.model ?? null,
        selectedEffort: this.effort ?? null,
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
    this._realtimeTitlePending = false
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
   *
   * A backend that delivers the wake itself (`sent-inline`) bypasses Session.send,
   * so the redacted transcript bubble — the "inbox has messages" row, and the only
   * persisted trace of the wake — is appended here on its behalf.
   */
  async injectTaskNotification(content: string): Promise<void> {
    if (this._status === 'disposed') return
    if (this.rejectIfWorktreeRemoved()) return
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
        const outcome = await this.backend.injectTaskNotification(text)
        if (outcome === 'sent-inline') {
          this.appendUserMessage(taskNotificationRequest(text), 'host')
          return
        }
        if (outcome === 'deferred') return
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
    const title = messageDialectFor(this.harnessId) === 'codex'
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
