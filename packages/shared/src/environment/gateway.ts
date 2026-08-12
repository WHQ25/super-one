import type { ExecutionEnvironmentDescriptor } from './descriptor'
import type {
  EnvironmentEventEnvelope,
  EnvironmentSnapshot,
  PendingInteractionSnapshot,
  ProjectSnapshot,
  SubscribeEventsInput,
} from './events'
import type { ControlLease, LeaseAcquireInput, LeaseReleaseInput, LeaseRenewInput, MutatingControlContext } from './lease'
import type { DraftListRequest, DraftRecord, DraftUpsertRequest } from './draft-rpc'
import type { ProjectRef, SessionRef, TerminalRef } from './refs'
import type { SessionMessagesListRequest, SessionMessagesListResult } from './session-messages'

/**
 * Environment-scoped gateway — the only boundary desktop features should use
 * for project, Session, terminal, and workspace operations.
 *
 * Local is one ExecutionEnvironment (in-process LocalEnvironmentGateway).
 * RemoteEnvironmentGateway delegates to an authenticated node RPC session.
 *
 * Migration: new and refactored product code should call EnvironmentHost /
 * window.environment — not environment-specific raw app IPC. Session list is
 * the reference path; create/send/rename/delete/pin and friends follow.
 */

export interface EnvironmentGateway {
  getDescriptor(): Promise<ExecutionEnvironmentDescriptor>
  listProjects(): Promise<ProjectSnapshot[]>
  getProject(projectId: string): Promise<ProjectSnapshot | null>
  /**
   * Consistent snapshot for reconnect hydration. Remote gateways always
   * implement this; local may return a lightweight in-memory projection.
   */
  getSnapshot?(): Promise<EnvironmentSnapshot>
  subscribeEvents(input: SubscribeEventsInput): AsyncIterable<EnvironmentEventEnvelope>
  readonly sessions: SessionGateway
  readonly interactions: InteractionGateway
  readonly terminals: TerminalGateway
  readonly workspace: WorkspaceGateway
  /** Present when the environment reports `capabilities.drafts`. */
  readonly drafts?: DraftGateway
}

export interface CreateSessionInput {
  project: ProjectRef
  providerId: string
  title?: string
  cwd?: string
  model?: string
  /** Opaque harness-specific options. */
  options?: Record<string, unknown>
}

export interface SendMessageInput extends MutatingControlContext {
  session: SessionRef
  text: string
  /** Client-generated message id for idempotent display. */
  clientMessageId?: string
  attachments?: unknown[]
  options?: Record<string, unknown>
}

/**
 * Durable per-session turn defaults. Omitted keys are left unchanged; null clears.
 * Applied as session.send fallbacks when the turn omits the corresponding option.
 */
export interface PatchSessionSettingsInput extends Partial<MutatingControlContext> {
  session: SessionRef
  permissionMode?: string | null
  sandboxMode?: string | null
  model?: string | null
  effort?: string | null
  apiProviderId?: string | null
}

export interface ListSessionsOptions {
  /** Max rows to return (newest first). Required — no unpaginated product list. */
  limit: number
  /** Rows to skip after sort. Required (use 0 for the first page). */
  offset: number
}

export interface SessionGateway {
  create(input: CreateSessionInput): Promise<{ sessionId: string }>
  get(ref: SessionRef): Promise<unknown | null>
  /** Product session list is always paginated (limit + offset required). */
  list(project: ProjectRef, options: ListSessionsOptions): Promise<unknown[]>
  send(input: SendMessageInput): Promise<void>
  /**
   * Persist turn defaults so subsequent send() calls need not re-send full options.
   * Optional for older gateways; remote node implements session.patchSettings RPC.
   */
  patchSettings?(input: PatchSessionSettingsInput): Promise<unknown>
  /**
   * Paged denser message catalog for UI hydrate (tool summaries, metadata).
   * Optional for older gateways; remote node implements session.messages.list.
   * Live catch-up still uses session.events afterSequence.
   */
  listMessages?(input: SessionMessagesListRequest & { session: SessionRef }): Promise<SessionMessagesListResult>
  interrupt(ref: SessionRef, control: MutatingControlContext): Promise<void>
  close(ref: SessionRef, control?: MutatingControlContext): Promise<void>
  acquireControl(input: LeaseAcquireInput & { resource: SessionRef }): Promise<ControlLease>
  renewControl(input: LeaseRenewInput): Promise<ControlLease>
  releaseControl(input: LeaseReleaseInput): Promise<void>
}

export interface PermissionResponseInput extends MutatingControlContext {
  session: SessionRef
  interactionId: string
  decision: 'allow' | 'deny' | 'allow_always'
  options?: Record<string, unknown>
}

export interface QuestionResponseInput extends MutatingControlContext {
  session: SessionRef
  interactionId: string
  answers: unknown
}

export interface PlanResponseInput extends MutatingControlContext {
  session: SessionRef
  interactionId: string
  decision: 'approve' | 'reject'
  options?: Record<string, unknown>
}

export interface InteractionGateway {
  listPending(session: SessionRef): Promise<PendingInteractionSnapshot[]>
  respondPermission(input: PermissionResponseInput): Promise<void>
  respondQuestion(input: QuestionResponseInput): Promise<void>
  respondPlan(input: PlanResponseInput): Promise<void>
}

export interface CreateTerminalInput {
  project?: ProjectRef
  cwd?: string
  cols?: number
  rows?: number
  title?: string
}

export interface TerminalWriteInput extends MutatingControlContext {
  terminal: TerminalRef
  data: string
}

export interface TerminalResizeInput extends MutatingControlContext {
  terminal: TerminalRef
  cols: number
  rows: number
}

export interface TerminalReadResult {
  data: string
  fromSequence: string
  sequence: string
  reset: boolean
  snapshot?: string
  status: 'running' | 'exited'
  exitCode: number | null
}

export interface TerminalGateway {
  create(input: CreateTerminalInput): Promise<{ terminalId: string }>
  attach(ref: TerminalRef): Promise<{ snapshot: string; sequence: string }>
  read(ref: TerminalRef, afterSequence: string): Promise<TerminalReadResult>
  write(input: TerminalWriteInput): Promise<void>
  resize(input: TerminalResizeInput): Promise<void>
  kill(ref: TerminalRef, control: MutatingControlContext): Promise<void>
  acquireControl(input: LeaseAcquireInput & { resource: TerminalRef }): Promise<ControlLease>
  renewControl(input: LeaseRenewInput): Promise<ControlLease>
  releaseControl(input: LeaseReleaseInput): Promise<void>
}

export interface WorkspaceListInput {
  project: ProjectRef
  relativePath: string
}

export interface WorkspaceReadInput {
  project: ProjectRef
  relativePath: string
  /** Optional byte range for large files. */
  offset?: number
  limit?: number
}

export interface WorkspaceWriteInput {
  project: ProjectRef
  relativePath: string
  content: string | Uint8Array
  /** Expected content hash for optimistic concurrency; optional. */
  expectedHash?: string
}

export interface WorkspaceSearchInput {
  project: ProjectRef
  query: string
  relativePath?: string
}

export interface WorkspaceWatchInput {
  project: ProjectRef
  relativePath?: string
}

/**
 * Byte-offset tail of:
 * - tool-output files under project `temp/` (`relativePath`), or
 * - host agent transcripts under ~/.grok/sessions or ~/.claude/projects (`absolutePath`).
 * Provide exactly one of relativePath (temp/) or absolutePath (agent roots).
 */
export interface WorkspaceTailWatchStartInput {
  project: ProjectRef
  /** Project-relative path under `temp/` (omit when absolutePath is set). */
  relativePath: string
  /** Allowlisted host absolute path for Grok/Claude agent transcripts. */
  absolutePath?: string
  /** Starting byte offset (default 0). Clamped to file size when larger. */
  offset?: number
}

export interface WorkspaceTailWatchPollResult {
  content: string
  encoding: 'base64'
  offset: number
  size: number
  missing?: boolean
}

export interface WorkspaceEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size?: number
  mtimeMs?: number
}

export interface WorkspaceRenameInput {
  project: ProjectRef
  relativePath: string
  /** Single path segment (no separators). */
  newName: string
}

export interface WorkspaceMoveInput {
  project: ProjectRef
  /** Source path relative to project root. */
  fromPath: string
  /** Destination directory relative to project root (`.` = root). */
  destDirPath: string
}

export interface WorkspaceDeleteInput {
  project: ProjectRef
  relativePath: string
}

export interface WorkspaceMkdirInput {
  project: ProjectRef
  relativePath: string
}

/**
 * Unsent composer drafts stored inside this environment. Optional: gateways
 * predating the feature (and older nodes, which report `capabilities.drafts:
 * false`) simply omit it, and the UI hides the drafts group for that host.
 */
export interface DraftGateway {
  list(input?: DraftListRequest): Promise<DraftRecord[]>
  upsert(input: DraftUpsertRequest): Promise<DraftRecord>
  delete(draftId: string): Promise<void>
}

export interface WorkspaceGateway {
  listDir(input: WorkspaceListInput): Promise<WorkspaceEntry[]>
  readFile(input: WorkspaceReadInput): Promise<{ content: string | Uint8Array; hash?: string }>
  writeFile(input: WorkspaceWriteInput): Promise<{ hash?: string }>
  search(input: WorkspaceSearchInput): Promise<Array<{ path: string; line?: number; preview?: string }>>
  /** Rename within the same directory. */
  rename(input: WorkspaceRenameInput): Promise<{ from: string; to: string }>
  /** Move into a destination directory (keeps basename). */
  move(input: WorkspaceMoveInput): Promise<{ from: string; to: string }>
  /** Hard-delete a file or directory tree. */
  delete(input: WorkspaceDeleteInput): Promise<{ path: string }>
  /** Create a directory (and parents). */
  mkdir(input: WorkspaceMkdirInput): Promise<{ path: string }>
  /** Cancel by returning / aborting the async iterable consumer. */
  watch(input: WorkspaceWatchInput): AsyncIterable<{ path: string; type: string }>
  /**
   * Byte-offset tail watch for project `temp/` outputs or host agent transcripts.
   * Poll returns only appended bytes (base64); stop releases the watch id.
   */
  tailWatchStart(
    input: WorkspaceTailWatchStartInput,
  ): Promise<{ watchId: string; offset: number; relativePath: string; absolutePath?: string }>
  tailWatchPoll(input: { watchId: string }): Promise<WorkspaceTailWatchPollResult>
  tailWatchStop(input: { watchId: string }): Promise<{ ok: boolean }>
}

/**
 * Registry of environment gateways available to Electron Main.
 * Renderer never holds sockets or credentials — only scoped refs and IPC.
 */
export interface EnvironmentRegistry {
  getLocal(): EnvironmentGateway
  get(environmentId: string): EnvironmentGateway | null
  list(): Promise<ExecutionEnvironmentDescriptor[]>
}
