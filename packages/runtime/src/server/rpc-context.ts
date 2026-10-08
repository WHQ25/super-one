import type {
  ClaimHostActionResult,
  EnvironmentCapabilities,
  EnvironmentEventEnvelope,
  EnvironmentGuiState,
  HostActionsPollResult,
  NodeHarnessId,
  ProjectSnapshot,
  RespondHostActionResult,
  RpcErrorCode,
  SessionMessagesListResult,
  WorkspaceEntry,
} from '@superone/shared/environment'
import type { GitMentionRefKind } from '@superone/shared/git-mention-query'
import type { ModUiOp, ModUiRequest } from '@superone/shared/mod-ui'
import type { ProjectExtraDirsPatch } from '@superone/shared/project-extra-dirs'
import type { ConsumerBinding, ConsumerId, Platform } from '@superone/shared/platform-registry'
import type {
  EnableHarnessInput,
  HarnessManager,
  ProbeHarnessResult,
  RuntimeReadyResult,
} from '../harness/index'
import type { ControlLeaseService } from '../lease/index'
import type {
  NodeSessionRecord,
  NodeSessionSettings,
  SessionProviderStore,
  SessionRuntime,
} from '../session/index'
import type { HarnessInstallationStatus } from '@superone/shared/environment'
import type { AuthenticatedClient } from './auth-service'
import type { NodeIdentity } from './identity'

/** Host-owned project catalog (CLI: ProjectRegistry). */
export interface ProjectsPort {
  list(): ProjectSnapshot[]
  get(projectId: string): ProjectSnapshot | null
  open(path: string, name?: string): ProjectSnapshot
  update(
    input: ProjectExtraDirsPatch & {
      projectId?: string
      path?: string
      name?: string
    },
  ): ProjectSnapshot | null
  remove(input: { projectId?: string; path?: string }): ProjectSnapshot | null
}

/** Host-owned PTY terminals (CLI: NodeTerminalManager). */
export interface TerminalsPort {
  create(opts: {
    cwd: string
    title?: string
    cols?: number
    rows?: number
  }): { terminalId: string; cwd: string; title: string; cols: number; rows: number }
  attach(terminalId: string): unknown
  readAfter(terminalId: string, afterSequence: string): unknown
  write(terminalId: string, data: string): void
  resize(terminalId: string, cols: number, rows: number): void
  kill(terminalId: string): void
}

/** Host-owned workspace filesystem (CLI: WorkspaceFsService). */
export interface WorkspaceFsPort {
  listDir(projectId: string, relativePath: string): WorkspaceEntry[]
  readFile(
    projectId: string,
    relativePath: string,
    opts?: { offset?: number; limit?: number },
  ): unknown
  writeFile(
    projectId: string,
    relativePath: string,
    content: string | Buffer,
    expectedHash?: string,
  ): unknown
  listFiles(
    projectId: string,
    opts?: { relativePath?: string; maxDepth?: number; maxFiles?: number },
  ): unknown
  listSkillsAndCommands(projectId: string): unknown
  search(projectId: string, query: string, relativePath?: string): unknown
  rename(projectId: string, relativePath: string, newName: string): unknown
  move(projectId: string, fromRel: string, destDir: string): unknown
  mkdir(projectId: string, relativePath: string): unknown
  delete(projectId: string, relativePath: string): unknown
}

/** Host-owned git/worktree ops (CLI: WorkspaceGitService). */
export interface WorkspaceGitPort {
  /**
   * The `git.*` methods a partial port serves; the rest answer unsupported.
   * Absent: the whole family.
   */
  readonly servedMethods?: ReadonlySet<string>
  status(projectId: string): unknown
  statusAt(projectId: string, absolutePath?: string | null): unknown
  diff(projectId: string, opts?: { staged?: boolean; path?: string }): unknown
  branches(projectId: string, absolutePath?: string | null): unknown
  switchBranch(
    projectId: string,
    branch: string,
    opts?: { create?: boolean; absolutePath?: string | null },
  ): unknown
  worktrees(projectId: string): unknown
  checkedOutBranches(projectId: string): string[]
  activateWorktree(
    projectId: string,
    input: {
      baseBranch: string
      mode: 'attach' | 'detach' | 'branch'
      branchName?: string
      carryLocalChanges?: boolean
    },
  ): { path: string } | Promise<{ path: string }>
  removeWorktree(projectId: string, worktreePath: string): void
  /** Update the project's remote-tracking refs of `remote` (and its `HEAD`). */
  fetch(projectId: string, remote: string): void | Promise<void>
  assignBranch(projectId: string, worktreePath: string, rawName: string): unknown
  handoffToMain(projectId: string, worktreePath: string): unknown
  handoffPreview(projectId: string, worktreePath: string): unknown
  mentionRefs(
    projectId: string,
    kind: GitMentionRefKind,
    query: string,
    absolutePath?: string | null,
  ): Promise<unknown>
  mentionCapabilities(projectId: string, absolutePath?: string | null): Promise<unknown>
  isAllowedSessionCwd(projectId: string, cwd: string | null | undefined): boolean
}

/** Recursive directory watch (CLI: WorkspaceWatchService). */
export interface WorkspaceWatchPort {
  subscribe(
    projectId: string,
    relativePath: string,
    onEvent: (ev: { path: string; type: string }) => void,
    ownerClientId?: string,
  ): { watchId: string; cancel: () => void }
  cancelForClient?(clientSessionId: string): void
}

/** File tail watch (CLI: WorkspaceTailWatchService). */
export interface WorkspaceTailWatchPort {
  start(
    projectId: string,
    relativePath: string,
    opts?: { offset?: number; ownerClientId?: string; absolutePath?: string },
  ): unknown
  poll(watchId: string, ownerClientId?: string): unknown
  stop(watchId: string, ownerClientId?: string): unknown
  isLive(watchId: string, ownerClientId?: string): boolean
  cancelForClient?(clientSessionId: string): void
}

/** Collaboration mailbox (CLI: CollaborationService). */
export interface CollaborationPort {
  listProfiles(): unknown
  request(input: {
    parentSessionId: string
    launches: Array<{
      launchId?: string
      agentId: string
      name: string
      role: string
      config?: Record<string, unknown>
    }>
    requireUserConfirm?: boolean
  }): Promise<unknown>
  start(input: {
    callerSessionId: string
    launchId: string
    task?: string
    formAnswers?: Record<string, unknown>
    controllerClientSessionId?: string | null
  }): Promise<unknown>
  send(input: { sessionId: string; to?: string; content: string; clientMessageId?: string }): unknown
  retrieve(input: { sessionId: string; from?: string[]; max?: number }): unknown
}

/** Durable + in-process idempotency (CLI: IdempotencyService). */
export interface IdempotencyPort {
  payloadHash(payload: unknown): string
  runExclusive<T>(
    clientIdentity: string,
    operation: string,
    idempotencyKey: string,
    payloadHash: string,
    execute: () => Promise<T>,
    options?: {
      durable?: boolean
      isReceiptLive?: (receipt: T) => boolean
    },
  ): Promise<T>
}

/** Node-local AI provider credentials (CLI: ProviderStore). */
export interface ProvidersPort {
  listCredentials(): unknown
  getCredentialDecrypted(id: string): unknown
  createCredential(input: unknown): unknown
  updateCredential(id: string, patch: unknown): unknown
  deleteCredential(id: string): boolean
  listBindings(): ConsumerBinding[]
  setBinding(binding: ConsumerBinding): void
  clearBinding(consumer: ConsumerId): void
  listCustomPlatforms(): Platform[]
  upsertCustomPlatform(def: Platform): Platform
  deleteCustomPlatform(id: string): boolean
  exportBundle(): unknown
  importBundle(bundle: unknown, opts?: { replaceAll?: boolean }): unknown
}

/** Control leases on sessions and terminals (runtime ControlLeaseService). */
export type ControlLeasePort = Pick<ControlLeaseService, 'acquire' | 'renew' | 'release' | 'assertValid'>

/** Session sync zone (`docs/architecture/session-sync-zone.md`; CLI: ArtifactZoneService). */
export interface ArtifactZonePort {
  /** Absolute `<nodeHome>/sync`, reported as `descriptor.syncRoot`. */
  readonly syncRoot: string
  /** Node path of a zone-relative path inside `sessionId`'s zone; throws when it escapes. */
  resolve(sessionId: string, relativePath: string): string
  stat(sessionId: string, relativePath: string): { exists: boolean }
  /** Drop the session's zone directory. */
  delete(sessionId: string): Promise<unknown>
}

type SessionRuntimeInput<K extends keyof SessionRuntime> = SessionRuntime[K] extends (
  input: infer I,
  ...rest: never[]
) => unknown
  ? I
  : never

/**
 * The `session.*` RPC family as a host port. The node runtime satisfies it with
 * {@link SessionRuntime}; a desktop host adapts its own session manager. Every
 * call that drives or answers a session checks the caller's control lease
 * itself (`leaseId`/`generation` + `client`) and throws `{ code }` errors that
 * the dispatcher maps to RPC errors.
 */
export interface SessionHostPort {
  create(input: SessionRuntimeInput<'create'>): NodeSessionRecord
  get(sessionId: string): NodeSessionRecord | null
  /** Newest first; `limit`/`offset` paginate after sorting. No projectId spans every project. */
  list(projectId?: string, options?: { limit?: number; offset?: number }): NodeSessionRecord[]
  setCwd(sessionId: string, cwd: string | null): NodeSessionRecord
  patchSettings(sessionId: string, patch: NodeSessionSettings): NodeSessionRecord
  fork(input: SessionRuntimeInput<'fork'>): NodeSessionRecord
  rename(sessionId: string, title: string, source?: 'user' | 'agent'): NodeSessionRecord
  setTags(sessionId: string, tags: string[]): NodeSessionRecord
  setUiFlags(sessionId: string, flags: { isPinned?: boolean; isHidden?: boolean }): NodeSessionRecord
  close(sessionId: string): void
  remove(sessionId: string): NodeSessionRecord | null

  send(input: SessionRuntimeInput<'send'>): Promise<unknown>
  interrupt(sessionId: string, client: { clientSessionId: string }, leaseId: string, generation: string): void
  respondPermission(input: SessionRuntimeInput<'respondPermission'>): void
  respondQuestion(input: SessionRuntimeInput<'respondQuestion'>): void
  respondPlan(input: SessionRuntimeInput<'respondPlan'>): void
  modUi(input: {
    sessionId: string
    op: ModUiOp
    request: ModUiRequest
    client: { clientSessionId: string }
    leaseId?: string
    generation?: string
  }): Promise<unknown>

  /** Durable event cursor (decimal string) for `session.snapshot`. */
  snapshotSequence(): string
  /** Events strictly after `afterSequence`, as `reader` sees them. */
  listEventsAfter(afterSequence: string, reader?: { clientSessionId: string }): EnvironmentEventEnvelope[]
  listMessages(input: SessionRuntimeInput<'listMessages'>): SessionMessagesListResult

  /** Re-point Host Action ownership after a new client acquires the session's lease. */
  rebindHostActionController(sessionId: string, controllerClientSessionId: string): unknown
  pollHostActions(input: SessionRuntimeInput<'pollHostActions'>): Promise<HostActionsPollResult>
  claimHostAction(input: SessionRuntimeInput<'claimHostAction'>): ClaimHostActionResult
  renewHostActionClaim(input: SessionRuntimeInput<'renewHostActionClaim'>): unknown
  respondHostAction(input: SessionRuntimeInput<'respondHostAction'>): RespondHostActionResult
  notifyArtifactsCompleted(input: SessionRuntimeInput<'notifyArtifactsCompleted'>): Promise<unknown>
}

/**
 * Host-specific harness / catalog hooks. CLI injects binary-override probes,
 * enable/disable and provider-side fork; desktop will inject its own later.
 */
export interface RpcHostHooks {
  isCodexBinaryOverrideRunnable(): boolean
  isClaudeBinaryOverrideRunnable(): boolean
  resolveReleaseVersion(): string
  listHarnessModels(
    store: ProvidersPort,
    harness: string,
    apiProviderId?: string | null,
    options?: { experimentalClaudeOpenAiChatEnabled?: boolean },
  ): unknown
  probeHarnessReadiness(
    harnesses: HarnessManager,
    id: NodeHarnessId,
    providers?: ProvidersPort | null,
  ): ProbeHarnessResult
  assertSessionHarnessRuntimeReady(
    sessionHarnessId: string,
    harnesses: HarnessManager,
  ): RuntimeReadyResult
  enableHarness(
    harnesses: HarnessManager,
    input: EnableHarnessInput,
    providers?: ProvidersPort | null,
  ): Promise<HarnessInstallationStatus>
  disableHarness(harnesses: HarnessManager, id: NodeHarnessId): HarnessInstallationStatus
  /**
   * Fork the provider-side conversation (Claude transcript / Codex thread) for
   * `session.fork`. Returns the new resume token, or null when there is none.
   */
  forkHarnessResume(input: {
    source: NodeSessionRecord
    targetCwd: string
    forkFromMessageId?: string
    resolveProjectPath: (projectId: string) => string | null
    harnesses?: HarnessManager
    providers?: ProvidersPort
    nodeHome: string
  }): Promise<string | null>
}

export interface RpcResult {
  result?: unknown
  error?: { code: RpcErrorCode; message: string; details?: Record<string, unknown> }
}

/**
 * Methods a host serves beyond the shared families (CLI: archive, MCP Apps,
 * resources, automations, drafts, artifacts, Codex admin, …). Runs before the
 * shared families; returns null for a method it does not own.
 */
export type RpcExtensionDispatch = (
  method: string,
  payload: unknown,
  ctx: RpcContext,
) => RpcResult | null | Promise<RpcResult | null>

/**
 * Capability flags that are host policy rather than a consequence of which
 * ports the host provides. The port-backed flags (sessions, terminal,
 * workspaceFs, git, worktrees, collaboration, syncZone) are derived from the
 * ports, so the descriptor never advertises a family the host cannot serve.
 */
export type HostCapabilityFlags = Omit<
  EnvironmentCapabilities,
  'harnessIds' | 'sessions' | 'terminal' | 'workspaceFs' | 'git' | 'worktrees' | 'collaboration' | 'syncZone'
>

/**
 * Context of one node RPC. Each port family is optional: a host serves the
 * families whose ports it provides, and the dispatcher answers the rest with
 * an explicit unsupported-method error.
 */
export interface RpcContext {
  client: AuthenticatedClient
  identity: NodeIdentity
  idempotency: IdempotencyPort
  leases: ControlLeasePort
  /**
   * Absolute path to the host's agent settings config.json.
   * Required for settings.get/patch and session default fallbacks.
   */
  settingsConfigPath: string
  hooks: RpcHostHooks
  capabilities: HostCapabilityFlags
  startedAt: number

  projects?: ProjectsPort
  terminals?: TerminalsPort
  workspaceFs?: WorkspaceFsPort
  workspaceGit?: WorkspaceGitPort
  workspaceWatch?: WorkspaceWatchPort
  workspaceTailWatch?: WorkspaceTailWatchPort
  sessions?: SessionHostPort
  harnesses?: HarnessManager
  collaboration?: CollaborationPort
  providers?: ProvidersPort
  /** Session-layer provider profiles (claude-base, custom multi-profile, …). */
  sessionProviders?: Pick<SessionProviderStore, 'get'>
  artifacts?: ArtifactZonePort
  extensions?: RpcExtensionDispatch
  /** Whether GUI tools can run now (`environment.status`); a host without one is headless. */
  guiState?: () => EnvironmentGuiState

  simulatedHarness?: boolean
  requestId?: string
  idempotencyKey?: string
}
