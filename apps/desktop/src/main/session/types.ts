import type {
  AgentEvent,
  AgentInfo,
  ChatMessage,
  CodexGoal,
  CodexGoalStatus,
  ContextUsageInfo,
  ProviderRateLimits,
  McpServerInfo,
  PermissionMode,
  QuestionAnnotations,
  RewindFilesResult,
  SandboxInfo,
  SandboxMode,
  SendMessageRequest,
  SlashCommandInfo,
} from '@superone/shared/agent-types'
import type { HarnessId, LiveSessionSnapshot, SessionSnapshot, SessionStatus } from '@superone/shared/session-types'

export type { HarnessId, LiveSessionSnapshot, SessionSnapshot, SessionStatus }

export interface ForkSource {
  providerSessionId: string
  projectPath: string
  /** Effective cwd of the source session, including a source worktree. */
  cwd?: string
  /** Persisted harness provider config needed by cold fork operations. */
  providerConfig?: unknown
}

export interface ForkContext {
  /** Source transcript, oldest-first — `forkFromMessageId` is resolved against this order. */
  messages: ChatMessage[]
  forkFromMessageId?: string
}

export interface Harness {
  readonly id: HarnessId
  readonly name: string
  readonly configSchema: unknown
  createBackend(): SessionBackend
  forkTranscript(source: ForkSource, targetCwd: string, ctx: ForkContext): Promise<string>
}

export interface SessionProvider {
  id: string
  harnessId: HarnessId
  name: string
  isBase: boolean
  config: unknown
  createdAt: number
  updatedAt: number
}

export interface SessionCreateOptions {
  projectPath: string
  cwd?: string
  providerId: string
  id?: string
  permissionMode?: PermissionMode
  sandboxMode?: SandboxMode
  effort?: SendMessageRequest['effort']
  model?: string
  additionalDirectories?: string[]
  resumeFrom?: string
  title?: string
  gitBranch?: string | null
  apiProviderId?: string | null
  acpAgentId?: string | null
  /** Harness-specific system/developer instructions appended by SuperOne. */
  systemPromptAppend?: string
  /**
   * Provider/agent session id to resume (e.g. Grok ACP session/load).
   * When omitted but `id` matches a DB row for the same provider, SessionManager
   * hydrates this from the stored `provider_session_id`.
   */
  providerSessionId?: string | null
  /**
   * Never write this session to the SuperOne database.
   *
   * SessionManager drops the persistence hooks, so `Session.notifyStateChange`
   * short-circuits on its existing `if (!this.onStateChange)` guard — no row in
   * `sessions`, none in `chat_messages`, nothing in the sidebar. The session also
   * stays out of `activeByProject`, so opening one never steals the project's
   * active session from the chat the user is actually in.
   *
   * The provider's own transcript is NOT covered: `Harness.forkTranscript` exists
   * precisely to make the agent write one. Callers clean that up on close.
   */
  ephemeral?: boolean
  /**
   * Instructions delivered alongside the FIRST turn of this session, once.
   *
   * Deliberately not `systemPromptAppend`. The system block is the head of every
   * request, so changing it changes the cached prefix — a forked session whose
   * system prompt differs from its parent's gets no prompt-cache hit at all and
   * re-reads the whole copied transcript at full price. Delivering the same text
   * inside the conversation leaves the prefix byte-identical, so everything up to
   * the fork point still hits and only these tokens are new.
   *
   * How it travels is the harness's business — see `SessionBackend.stageInstruction`.
   * Harnesses with no such channel fall back to riding the user's message, where
   * `userMessageContent` keeps the bubble showing only what the user typed.
   */
  firstTurnPreamble?: string
}

/**
 * How chat_messages should be written on this state change.
 * - `full`: upsert every in-memory message (hydrate / repair).
 * - `incremental`: upsert only dirty ids (+ any ids missing from DB); always stale-delete.
 */
export type MessagePersistMode =
  | { kind: 'full' }
  | { kind: 'incremental'; dirtyMessageIds: readonly string[] }

export interface SessionStateChange {
  sid: string
  projectPath: string
  providerId: string
  messages: ChatMessage[]
  totalCostUsd: number
  contextTokens: number
  title: string | null
  isWorktree: boolean
  worktreePath: string | null
  gitBranch: string | null
  worktreeMissing: boolean
  apiProviderId: string | null
  acpAgentId: string | null
  selectedModel: string | null
  selectedEffort: SendMessageRequest['effort'] | null
  /**
   * Provider/agent session id (e.g. Grok ACP). Persisted with the SuperOne
   * session row so cold resume can session/load after app restart.
   */
  providerSessionId: string | null
  messagePersistMode: MessagePersistMode
}

export type ActiveApiProviderIdGetter = (harnessId: HarnessId) => string | null

export interface BackendStartOptions {
  sessionId: string
  projectPath: string
  cwd: string
  config: unknown
  permissionMode: PermissionMode
  sandboxInfo?: SandboxInfo
  effort?: SendMessageRequest['effort']
  model?: string
  additionalDirectories?: string[]
  abortController: AbortController
  providerSessionId?: string
  apiProviderId?: string | null
  systemPromptAppend?: string
  /** Human-readable session title (Cursor agent name, etc.). */
  agentName?: string
}

export interface PrewarmHint {
  effort?: SendMessageRequest['effort']
  model?: string
  additionalDirs?: string[]
  /** ACP agent id override from renderer (avoids settings write race). */
  acpAgentId?: string
}

export type BackendCommand =
  | {
      kind: 'codex.steer'
      input: string
      newAssistantMessageId?: string
      newUserMessageId?: string
      newUserText?: string
    }
  | {
      kind: 'codex.steer_queued'
      clientMessageId: string
    }
  | {
      kind: 'claude.steer_queued'
      clientMessageId: string
    }
  | {
      kind: 'codex.plan_approval'
      messageId: string
      status: 'approved' | 'rejected'
      feedback?: string
    }
  | {
      kind: 'codex.collaboration_mode_change'
      mode: string
    }
  | {
      kind: 'session.set_additional_dirs'
      dirs: string[]
    }
  | {
      kind: 'claude.stop_task'
      taskId: string
    }

export type BackendEvent = AgentEvent

export type SessionOwner =
  | { kind: 'local' }
  | { kind: 'remote'; deviceId: string }

export const LOCAL_OWNER: SessionOwner = { kind: 'local' }

export type SessionLockReason = 'remote-owned' | 'remote-subscribed'

/**
 * Who initiated a Session.send:
 * - local: desktop UI / local IPC (blocked while remote-owned or subscribed)
 * - remote: mobile remote-control owner/subscriber
 * - host: trusted main-process background work (task notifications, mailbox wakes)
 */
export type SendProviderOrigin = 'local' | 'remote' | 'host'

/**
 * How a backend disposed of a host wake (collab mailbox, download settle, …).
 *
 * The distinction matters because only `Session.send` appends the redacted user
 * bubble that renders the "inbox has messages" row — a backend that delivers the
 * wake itself leaves the transcript empty unless Session mirrors it.
 *
 * - `sent-inline`  — pushed straight into the live provider stream (Claude SDK
 *   push, Codex `turn/steer`). Session never sees a send, so Session appends the
 *   transcript bubble on the backend's behalf.
 * - `deferred`     — queued (or dropped because the backend is gone). Any later
 *   flush goes through `bindTaskNotificationSend` → `Session.send`, which
 *   appends the bubble itself; Session must not append now or it would double.
 * - `unhandled`    — backend is idle. Session.send owns the synthetic turn.
 */
export type TaskNotificationInjectResult = 'sent-inline' | 'deferred' | 'unhandled'

export class SessionLockedError extends Error {
  readonly sessionId: string
  readonly reason: SessionLockReason
  readonly ownerDeviceId?: string
  constructor(sessionId: string, reason: SessionLockReason, ownerDeviceId?: string) {
    super(reason === 'remote-owned'
      ? `Session ${sessionId} is controlled by remote device${ownerDeviceId ? ` ${ownerDeviceId}` : ''}`
      : `Session ${sessionId} is being viewed by a remote device`)
    this.name = 'SessionLockedError'
    this.sessionId = sessionId
    this.reason = reason
    this.ownerDeviceId = ownerDeviceId
  }
}

/** Worktree checkout is gone — session is read-only (composer withdrawn, no new turns). */
export class SessionWorktreeRemovedError extends Error {
  readonly sessionId: string
  readonly worktreePath: string
  constructor(sessionId: string, worktreePath: string) {
    super(`Session ${sessionId} is read-only because its worktree was removed: ${worktreePath}`)
    this.name = 'SessionWorktreeRemovedError'
    this.sessionId = sessionId
    this.worktreePath = worktreePath
  }
}

export class SessionClaimConflictError extends Error {
  readonly sessionId: string
  readonly currentOwnerDeviceId: string
  readonly attemptedDeviceId: string
  constructor(sessionId: string, currentOwnerDeviceId: string, attemptedDeviceId: string) {
    super(`Session ${sessionId} already claimed by device ${currentOwnerDeviceId}; ${attemptedDeviceId} cannot take over`)
    this.name = 'SessionClaimConflictError'
    this.sessionId = sessionId
    this.currentOwnerDeviceId = currentOwnerDeviceId
    this.attemptedDeviceId = attemptedDeviceId
  }
}

export type SessionLeaveReason =
  | 'self_leave'
  | 'self_switch'
  | 'desktop_kick'
  | 'transport_disconnect'
  | 'session_closed'

export type SessionLifecycleEvent =
  | { type: 'owner_changed'; sessionId: string; previous: SessionOwner; current: SessionOwner; reason?: SessionLeaveReason }
  | { type: 'subscriber_added'; sessionId: string; deviceId: string }
  | { type: 'subscriber_removed'; sessionId: string; deviceId: string; reason?: SessionLeaveReason }
  | { type: 'closed'; sessionId: string }

export interface SessionBackend {
  readonly kind: HarnessId
  hasActiveRuntime(): boolean
  releaseRuntime(reason: 'idle'): Promise<void>
  start(opts: BackendStartOptions): Promise<void>
  rebuild(opts: BackendStartOptions): Promise<void>
  prewarm(opts: BackendStartOptions): void
  send(request: SendMessageRequest): Promise<void>
  interrupt(): Promise<void>
  startRealtimeVoice?(request: import('@superone/shared/agent-types').RealtimeVoiceStartRequest): Promise<void>
  stopRealtimeVoice?(): Promise<void>
  getRealtimeTimeline?(): Promise<import('@superone/shared/agent-types').RealtimeTimelineResult>
  close(): Promise<void>
  setModel(model: string): Promise<void>
  /** ACP session config option category=mode; no-op for other harnesses. */
  setSessionMode(modeId: string): Promise<void>
  /** Sync a live provider session title when the harness exposes one. */
  setTitle?(title: string): Promise<void>
  setPermissionMode(mode: PermissionMode): Promise<void>
  /**
   * Grok ACP auto/manual session recap (`x.ai/recap`). Optional — only ACP/Grok.
   * Returns true when the RPC was sent (false = skipped: no runtime / busy / not advertised).
   */
  requestSessionRecap?(auto: boolean): Promise<boolean>
  setSandbox(sandboxInfo: SandboxInfo): Promise<void>
  setAdditionalDirectories?(dirs: string[]): Promise<boolean>
  hasActiveBackgroundTasks?(): boolean
  getCodexGoal?(threadId: string): Promise<CodexGoal | null>
  setCodexGoal?(threadId: string, objective: string, status?: CodexGoalStatus): Promise<CodexGoal | null>
  clearCodexGoal?(threadId: string): Promise<boolean>
  stopTask?(taskId: string): Promise<void>
  /**
   * Stage an out-of-band instruction to ride the NEXT turn, using whatever the
   * harness offers natively for conversation-level context.
   *
   * Present only on harnesses that have such a mechanism — its absence is the
   * signal to fall back, which is why there is no matching `HARNESS_CAPABILITIES`
   * flag: a boolean that has to stay in sync with a method's existence is one
   * fact in two places, and the copy nobody edits is the one that goes stale.
   *
   * Implementations must NOT put the text in the system prompt. The system block
   * heads every request, so changing it changes the cached prefix — for a forked
   * session that throws away the parent's prompt cache entirely. Staging is the
   * whole contract: the text belongs in the conversation, next to the turn it
   * qualifies.
   *
   * Called before `send`; the backend clears it once delivered.
   */
  stageInstruction?(text: string): void
  /**
   * Mid-turn host wake only. Never call backend.send() for a new turn from this
   * hook — that races the Session state machine. See
   * {@link TaskNotificationInjectResult} for what each outcome obliges Session
   * to do about the transcript.
   */
  injectTaskNotification?(content: string): Promise<TaskNotificationInjectResult>
  /**
   * Redirect idle flushes of queued task notifications through Session.send
   * (so they take `_sendChain` / status machine) instead of backend.send.
   */
  bindTaskNotificationSend?(send: (content: string) => Promise<void>): void
  respondToPermission(
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    reason?: string,
    selectedSuggestions?: number[],
    decision?: 'cancel',
    formAnswers?: Record<string, unknown>,
  ): boolean
  respondToQuestion(
    requestId: string,
    answers: Record<string, string>,
    annotations?: QuestionAnnotations,
  ): void
  dismissQuestion(requestId: string): void
  respondToPlanApproval(requestId: string, approved: boolean, feedback?: string): void
  getContextUsage(): Promise<ContextUsageInfo | null>
  /** Account-level usage/credits for the gauge. Only harnesses that expose one implement it. */
  getRateLimits?(): Promise<ProviderRateLimits | null>
  getMcpServerStatus(): Promise<McpServerInfo[]>
  authenticateMcp?(serverName: string): Promise<void>
  rewindFiles(userMessageId: string, opts?: { dryRun?: boolean }): Promise<RewindFilesResult>
  rewindConversation?(beforeTurnId: string): Promise<RewindFilesResult>
  reconnectMcp(serverName: string): Promise<void>
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>
  reloadMcpServers(): Promise<void>
  reloadPlugins(): Promise<boolean>
  /** Resume Codex's durable queue after an interrupted turn. */
  startQueuedMessages?(): Promise<boolean>
  dequeueMessage(clientMessageId: string): boolean | Promise<boolean>
  getPendingInteractions(): AgentEvent[]
  handleCommand?(cmd: BackendCommand): Promise<void>
  onEvent(handler: (event: BackendEvent) => void): () => void
  onProviderSessionId(handler: (id: string) => void): () => void
  onPermissionModeApplied(handler: (mode: PermissionMode) => void): () => void
}

export interface Session {
  /**
   * Record the dsh agent preset this session composes from. A no-op on every
   * other harness — the concept is dsh's own.
   */
  getAgentPreset(): string | null
  setAgentPreset(presetId: string | null): void

  readonly id: string
  readonly projectPath: string
  readonly cwd: string
  /** Side chat: process-local only, never persisted. See `SessionCreateOptions.ephemeral`. */
  readonly ephemeral: boolean
  readonly snapshot: SessionSnapshot
  readonly owner: SessionOwner
  readonly subscribers: ReadonlySet<string>
  claim(owner: Extract<SessionOwner, { kind: 'remote' }>): void
  release(deviceId: string, reason?: SessionLeaveReason): void
  setForeground(visible: boolean): void
  hasActiveRuntime(): boolean
  isRuntimeIdle(now: number, timeoutMs: number): boolean
  releaseRuntime(reason: 'idle', afterRelease?: () => Promise<void>): Promise<boolean>
  subscribe(deviceId: string): void
  unsubscribe(deviceId: string, reason?: SessionLeaveReason): void
  onLifecycle(handler: (event: SessionLifecycleEvent) => void): () => void
  send(request: SendMessageRequest, opts?: { providerOrigin?: SendProviderOrigin }): Promise<void>
  interrupt(): Promise<boolean>
  startRealtimeVoice(request: import('@superone/shared/agent-types').RealtimeVoiceStartRequest): Promise<void>
  stopRealtimeVoice(): Promise<void>
  getRealtimeTimeline(): Promise<import('@superone/shared/agent-types').RealtimeTimelineResult>
  setPermissionMode(mode: PermissionMode): Promise<void>
  /** Grok ACP return-from-away / `/recap` — no-op for other harnesses. Returns true if RPC sent. */
  requestSessionRecap?(auto: boolean): Promise<boolean>
  setSandboxMode(mode: SandboxMode): Promise<SandboxInfo>
  getCurrentPermissionMode(): PermissionMode
  getCurrentSandboxInfo(): SandboxInfo
  getUiSettings(): import('@superone/shared/agent-types').SessionSettingsPatch
  setModel(model: string): Promise<void>
  setSessionMode(modeId: string): Promise<void>
  setSelectedSettings(opts: { model?: string | null; effort?: SendMessageRequest['effort'] | null; mode?: string | null }): void
  broadcastSettingsPatch(patch: import('@superone/shared/agent-types').SessionSettingsPatch): void
  getSelectedModel(): string | undefined
  getSelectedEffort(): SendMessageRequest['effort']
  setApiProviderId(apiProviderId: string | null): void
  getApiProviderId(): string | null
  setAcpAgentId(agentId: string | null): void
  setTitle(title: string, source: 'user' | 'agent'): void
  emitHostEvent(event: import('@superone/shared/agent-types').AgentEvent): void
  /**
   * Append a transcript bubble without sending it to the model (e.g. collab mailbox
   * content for human observers). Dedupes by message id.
   */
  appendTranscriptMessage(message: import('@superone/shared/agent-types').ChatMessage): void
  injectTaskNotification(content: string): Promise<void>
  respondToPermission(
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    reason?: string,
    selectedSuggestions?: number[],
    decision?: 'cancel',
    formAnswers?: Record<string, unknown>,
  ): boolean
  respondToQuestion(
    requestId: string,
    answers: Record<string, string>,
    annotations?: QuestionAnnotations,
  ): void
  dismissQuestion(requestId: string): void
  respondToPlanApproval(requestId: string, approved: boolean, feedback?: string): void
  getContextUsage(): Promise<ContextUsageInfo | null>
  getRateLimits(): Promise<ProviderRateLimits | null>
  getMcpServerStatus(): Promise<McpServerInfo[]>
  authenticateMcp(serverName: string): Promise<void>
  rewindFiles(userMessageId: string, opts?: { dryRun?: boolean }): Promise<RewindFilesResult>
  rewindConversation(userMessageId: string): Promise<RewindFilesResult>
  reconnectMcp(serverName: string): Promise<void>
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>
  reloadMcpServers(): Promise<void>
  reloadPlugins(): Promise<boolean>
  /** Resume Codex's durable queue after an interrupted turn. */
  startQueuedMessages(): Promise<boolean>
  /** Cursor local: expire wedged run via LocalSendOptions.force. Optional on other harnesses. */
  forceRecoverRun?(message?: string): Promise<void>
  prewarm(hint?: PrewarmHint): void
  dequeueMessage(clientMessageId: string): Promise<boolean>
  getPendingInteractions(): AgentEvent[]
  getCodexGoal(threadId: string): Promise<CodexGoal | null>
  setCodexGoal(threadId: string, objective: string, status?: CodexGoalStatus): Promise<CodexGoal | null>
  clearCodexGoal(threadId: string): Promise<boolean>
  dispatchBackendCommand(cmd: BackendCommand): Promise<void>
  updateProviderConfig(nextConfig: unknown): void
  markNeedsRebuild(): void
  getAdditionalDirectoriesSnapshot(): string[]
  /** Caller-owned half only — see `Session.getCallerScopedDirsSnapshot`. */
  getCallerScopedDirsSnapshot(): string[]
  switchCwd(nextCwd: string, gitBranch?: string | null): Promise<void>
  isStreaming(): boolean
  truncateMessagesAt(checkpointId: string): void
  dispose(): Promise<void>
  on(handler: (event: AgentEvent) => void): () => void
  getReplayEvents(): AgentEvent[]
}

export interface ProjectResources {
  readonly cwd: string
  readonly skills: SlashCommandInfo[]
  readonly projectCommands: SlashCommandInfo[]
  readonly projectAgents: AgentInfo[]
}

export interface SessionManager {
  openProject(projectPath: string): void
  closeProject(projectPath: string): Promise<void>
  listProjectSessions(projectPath: string): SessionSnapshot[]
  listLiveSnapshots(): LiveSessionSnapshot[]
  getProjectResources(cwd: string): ProjectResources
  invalidateProjectResources(cwd: string): void

  createSession(opts: SessionCreateOptions): Session
  resumeSession(sessionId: string, opts?: { permissionMode?: PermissionMode; sandboxMode?: SandboxMode; passive?: boolean }): Session
  getSession(sessionId: string): Session | null
  getActiveSession(projectPath: string): Session | null
  setActiveSession(projectPath: string, sessionId: string): void
  clearActiveSession(projectPath: string): void
  disposeSession(sessionId: string): Promise<void>
  disposeAllSessions(): Promise<void>
  forEachSession(fn: (session: Session) => void): void

  on(sessionId: string, handler: (event: AgentEvent) => void): () => void
  onAny(handler: (sessionId: string, event: AgentEvent) => void): () => void
}
