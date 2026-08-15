import type {
  NodeHarnessId,
  ProjectSnapshot,
  RpcErrorCode,
  WorkspaceEntry,
} from '@superone/shared/environment'
import type { ConsumerBinding, ConsumerId, Platform } from '@superone/shared/platform-registry'
import type { AutomationService, AutomationStore } from '../automations/index'
import type { DraftStore } from '../drafts/index'
import type {
  EnableHarnessInput,
  HarnessManager,
  ProbeHarnessResult,
  RuntimeReadyResult,
} from '../harness/index'
import type { ControlLeaseService } from '../lease/index'
import type { EventLog, SessionProviderStore, SessionRuntime } from '../session/index'
import type { HarnessInstallationStatus } from '@superone/shared/environment'
import type { AuthenticatedClient } from './auth-service'
import type { NodeIdentity } from './identity'

/** Host-owned project catalog (CLI: ProjectRegistry). */
export interface ProjectsPort {
  list(): ProjectSnapshot[]
  get(projectId: string): ProjectSnapshot | null
  open(path: string, name?: string): ProjectSnapshot
  remove(input: { projectId?: string; path?: string }): ProjectSnapshot | null
  touch(projectId: string): void
}

/** Host-owned PTY terminals (CLI: NodeTerminalManager). */
export interface TerminalsPort {
  create(opts: {
    cwd: string
    title?: string
    cols?: number
    rows?: number
    shell?: string
  }): { terminalId: string; cwd: string; title: string; cols: number; rows: number }
  attach(terminalId: string): { snapshot: string; sequence: string }
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
  ): { content: string; hash: string; encoding: 'base64' }
  writeFile(
    projectId: string,
    relativePath: string,
    content: string | Uint8Array,
    expectedHash?: string,
  ): { hash: string }
  listFiles(
    projectId: string,
    opts?: { relativePath?: string; maxDepth?: number; maxFiles?: number },
  ): unknown[]
  listSkillsAndCommands(projectId: string): unknown
  search(
    projectId: string,
    query: string,
    relativePath?: string,
  ): Array<{ path: string; line?: number; preview?: string }>
  rename(projectId: string, relativePath: string, newName: string): { from: string; to: string }
  move(projectId: string, fromRel: string, destDir: string): { from: string; to: string }
  mkdir(projectId: string, relativePath: string): { path: string }
  delete(projectId: string, relativePath: string): { path: string }
}

/** Host-owned git/worktree ops (CLI: WorkspaceGitService). */
export interface WorkspaceGitPort {
  status(projectId: string): unknown
  statusAt(projectId: string, absolutePath?: string | null): unknown
  diff(projectId: string, opts?: { staged?: boolean; path?: string }): unknown
  branches(projectId: string, absolutePath?: string | null): unknown
  switchBranch(projectId: string, branch: string, opts?: unknown): unknown
  worktrees(projectId: string): unknown
  checkedOutBranches(projectId: string): string[]
  activateWorktree(
    projectId: string,
    input: { baseBranch: string; mode: string; branchName?: string; carryLocalChanges?: boolean },
  ): { path: string; recordedBranch?: string | null }
  removeWorktree(projectId: string, worktreePath: string): void
  assignBranch(projectId: string, worktreePath: string, rawName: string): unknown
  handoffToMain(projectId: string, worktreePath: string): unknown
  handoffPreview(projectId: string, worktreePath: string): unknown
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
  stop(watchId: string, ownerClientId?: string): { ok: boolean }
  isLive(watchId: string, ownerClientId?: string): boolean
  cancelForClient?(clientSessionId: string): void
}

/** Collaboration mailbox (CLI: CollaborationService). */
export interface CollaborationPort {
  listProfiles(): unknown
  request(input: {
    parentSessionId: string
    launches: unknown[]
    requireUserConfirm?: boolean
    signal?: AbortSignal
  }): Promise<unknown>
  start(input: {
    credential?: string
    grantId?: string
    formAnswers?: Record<string, unknown>
    callerSessionId?: string
    controllerClientSessionId?: string | null
  }): Promise<unknown>
  send(input: {
    credential: string
    content: string
    clientMessageId?: string
    sessionId: string
  }): unknown
  retrieve(input: {
    credential?: string
    credentials?: string[]
    sessionId: string
    max?: number
  }): unknown
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

/**
 * Host-specific harness / catalog hooks. CLI injects binary-override probes
 * and enable/disable; desktop will inject its own later.
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
}

export interface RpcContext {
  client: AuthenticatedClient
  identity: NodeIdentity
  terminals: TerminalsPort
  projects: ProjectsPort
  workspaceFs: WorkspaceFsPort
  workspaceGit: WorkspaceGitPort
  workspaceWatch: WorkspaceWatchPort
  workspaceTailWatch: WorkspaceTailWatchPort
  sessions: SessionRuntime
  harnesses: HarnessManager
  leases: ControlLeaseService
  events: EventLog
  collaboration: CollaborationPort
  idempotency: IdempotencyPort
  providers: ProvidersPort
  /**
   * Absolute path to SUPERONE_NODE_HOME/config.json for agent settings.
   * Required for settings.get/patch and session default fallbacks.
   */
  settingsConfigPath: string
  drafts: DraftStore
  automations: AutomationStore
  automationService: AutomationService
  sessionProviders: SessionProviderStore
  hooks: RpcHostHooks
  startedAt: number
  simulatedHarness?: boolean
  requestId?: string
  idempotencyKey?: string
}

export interface RpcResult {
  result?: unknown
  error?: { code: RpcErrorCode; message: string; details?: Record<string, unknown> }
}
