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
} from '../../shared/agent-types'

export type HarnessId = 'claude' | 'codex'

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

export type SessionStatus =
  | 'idle'
  | 'starting'
  | 'streaming'
  | 'interrupting'
  | 'ended'
  | 'disposed'

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
}

export interface SessionSnapshot {
  readonly id: string
  readonly projectPath: string
  readonly cwd: string
  readonly providerId: string
  readonly harnessId: HarnessId
  readonly status: SessionStatus
  readonly providerSessionId: string | null
  readonly currentMessageId: string | null
  readonly createdAt: number
  readonly lastUserMessageAt: number | null
  readonly messages: ReadonlyArray<ChatMessage>
  readonly totalCostUsd: number
  readonly contextTokens: number
  readonly title: string | null
}

export interface SessionStateChange {
  sid: string
  projectPath: string
  providerId: string
  messages: ChatMessage[]
  totalCostUsd: number
  contextTokens: number
  title: string | null
}

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

export type BackendEvent = AgentEvent

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
  respondToPermission(
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    reason?: string,
    selectedSuggestions?: number[],
  ): void
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
}

export interface Session {
  readonly id: string
  readonly projectPath: string
  readonly cwd: string
  readonly snapshot: SessionSnapshot
  send(request: SendMessageRequest, opts?: { providerOrigin?: 'local' | 'remote' }): Promise<void>
  interrupt(): Promise<void>
  setPermissionMode(mode: PermissionMode): Promise<void>
  setSandboxMode(mode: SandboxMode): SandboxInfo
  getCurrentPermissionMode(): PermissionMode
  getCurrentSandboxInfo(): SandboxInfo
  setModel(model: string): Promise<void>
  respondToPermission(
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    reason?: string,
    selectedSuggestions?: number[],
  ): void
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
  switchCwd(nextCwd: string): Promise<void>
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
  readonly additionalDirectories: string[]
}

export interface SessionManager {
  openProject(projectPath: string): void
  closeProject(projectPath: string): Promise<void>
  listProjectSessions(projectPath: string): SessionSnapshot[]
  getProjectResources(cwd: string): ProjectResources
  invalidateProjectResources(cwd: string): void

  createSession(opts: SessionCreateOptions): Session
  resumeSession(sessionId: string): Session
  getSession(sessionId: string): Session | null
  disposeSession(sessionId: string): Promise<void>

  on(sessionId: string, handler: (event: AgentEvent) => void): () => void
  onAny(handler: (sessionId: string, event: AgentEvent) => void): () => void
}
