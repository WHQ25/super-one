import type {
  AgentEvent,
  AgentInfo,
  ChatMessage,
  ContextUsageInfo,
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

export interface Harness {
  readonly id: HarnessId
  readonly name: string
  readonly configSchema: unknown
  createBackend(): SessionBackend
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
}

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
}

export interface PrewarmHint {
  effort?: SendMessageRequest['effort']
  model?: string
  additionalDirs?: string[]
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
      kind: 'claude.set_additional_dirs'
      dirs: string[]
    }

export type BackendEvent = AgentEvent

export type SessionOwner =
  | { kind: 'local' }
  | { kind: 'remote'; deviceId: string }

export const LOCAL_OWNER: SessionOwner = { kind: 'local' }

export type SessionLockReason = 'remote-owned' | 'remote-subscribed'

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
  start(opts: BackendStartOptions): Promise<void>
  rebuild(opts: BackendStartOptions): Promise<void>
  prewarm(opts: BackendStartOptions): void
  send(request: SendMessageRequest): Promise<void>
  interrupt(): Promise<void>
  close(): Promise<void>
  setModel(model: string): Promise<void>
  setPermissionMode(mode: PermissionMode): Promise<void>
  setSandbox(sandboxInfo: SandboxInfo): Promise<void>
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
  getMcpServerStatus(): Promise<McpServerInfo[]>
  rewindFiles(userMessageId: string, opts?: { dryRun?: boolean }): Promise<RewindFilesResult>
  reconnectMcp(serverName: string): Promise<void>
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>
  reloadPlugins(): Promise<boolean>
  dequeueMessage(clientMessageId: string): boolean
  getPendingInteractions(): AgentEvent[]
  handleCommand?(cmd: BackendCommand): Promise<void>
  onEvent(handler: (event: BackendEvent) => void): () => void
  onProviderSessionId(handler: (id: string) => void): () => void
  onPermissionModeApplied(handler: (mode: PermissionMode) => void): () => void
}

export interface Session {
  readonly id: string
  readonly projectPath: string
  readonly cwd: string
  readonly snapshot: SessionSnapshot
  readonly owner: SessionOwner
  readonly subscribers: ReadonlySet<string>
  claim(owner: Extract<SessionOwner, { kind: 'remote' }>): void
  release(deviceId: string, reason?: SessionLeaveReason): void
  subscribe(deviceId: string): void
  unsubscribe(deviceId: string, reason?: SessionLeaveReason): void
  onLifecycle(handler: (event: SessionLifecycleEvent) => void): () => void
  send(request: SendMessageRequest, opts?: { providerOrigin?: 'local' | 'remote' }): Promise<void>
  interrupt(): Promise<boolean>
  setPermissionMode(mode: PermissionMode): Promise<void>
  setSandboxMode(mode: SandboxMode): Promise<SandboxInfo>
  getCurrentPermissionMode(): PermissionMode
  getCurrentSandboxInfo(): SandboxInfo
  setModel(model: string): Promise<void>
  setSelectedSettings(opts: { model?: string | null; effort?: SendMessageRequest['effort'] | null }): void
  broadcastSettingsPatch(patch: import('@superone/shared/agent-types').SessionSettingsPatch): void
  getSelectedModel(): string | undefined
  getSelectedEffort(): SendMessageRequest['effort']
  setApiProviderId(apiProviderId: string | null): void
  getApiProviderId(): string | null
  setTitle(title: string, source: 'user' | 'agent'): void
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
  getMcpServerStatus(): Promise<McpServerInfo[]>
  rewindFiles(userMessageId: string, opts?: { dryRun?: boolean }): Promise<RewindFilesResult>
  reconnectMcp(serverName: string): Promise<void>
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>
  reloadPlugins(): Promise<boolean>
  prewarm(hint?: PrewarmHint): void
  dequeueMessage(clientMessageId: string): boolean
  getPendingInteractions(): AgentEvent[]
  dispatchBackendCommand(cmd: BackendCommand): Promise<void>
  updateProviderConfig(nextConfig: unknown): void
  markNeedsRebuild(): void
  getAdditionalDirectoriesSnapshot(): string[]
  switchCwd(nextCwd: string, gitBranch?: string | null): Promise<void>
  isStreaming(): boolean
  truncateMessagesAt(checkpointId: string): void
  dispose(): Promise<void>
  on(handler: (event: AgentEvent) => void): () => void
  getReplayEvents(): AgentEvent[]
}

export interface ScopedAdditionalDirs {
  readonly user: string[]
  readonly projectShared: string[]
  readonly projectLocal: string[]
}

export interface ProjectResources {
  readonly cwd: string
  readonly skills: SlashCommandInfo[]
  readonly projectCommands: SlashCommandInfo[]
  readonly projectAgents: AgentInfo[]
  readonly additionalDirectories: string[]
  readonly additionalDirsScoped: ScopedAdditionalDirs
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
  disposeSession(sessionId: string): Promise<void>
  forEachSession(fn: (session: Session) => void): void

  on(sessionId: string, handler: (event: AgentEvent) => void): () => void
  onAny(handler: (sessionId: string, event: AgentEvent) => void): () => void
}
