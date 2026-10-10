import {
  AuthService,
  IdempotencyService,
  loadOrCreateIdentity,
  unsupportedMethodError,
  type CollaborationPort,
  type HostCapabilityFlags,
  type NodeIdentity,
  type ProjectsPort,
  type RpcContext,
  type RpcHostHooks,
  type TerminalsPort,
  type DraftsPort,
} from '@superone/runtime/server'
import { openNodeDatabase, type NodeDatabase } from '@superone/runtime/db'
import { ControlLeaseService } from '@superone/runtime/lease'
import { EventLog, createSqliteHostActionStore } from '@superone/runtime/session'
import type { HarnessManager } from '@superone/runtime/harness'
import type { SessionAgentProfile } from '@superone/shared/agent-types'
import { loadDesktopEnvironmentIdentity } from '../environment/local-identity'
import { DesktopSessionHost, type NodeHostSessionManager, type NodeHostSessionStore } from './desktop-session-host'
import { createDesktopWorktreePort } from './desktop-worktree-port'
import { reconcileRunsAfterRestart } from './reconcile-runs'
import {
  WorkspaceFsService,
  WorkspaceGitService,
  WorkspaceTailWatchService,
  WorkspaceWatchService,
  type WorkspaceProjects,
} from '@superone/runtime/workspace'
import { SessionEventRecorder } from './session-event-recorder'
import { LocalSessionHost, LOCAL_SESSION_MUTATIONS } from './local-session-host'
import type { DesktopSessionRows } from './desktop-session-reads'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import { desktopNodeHostPaths } from './paths'
import { claudeUsageAccounts } from '../agent/subscription-usage'
import { usageLog } from '../agent/usage-log'

/** Policy flags of the desktop node; its methods follow from the ports this host passes. */
const DESKTOP_NODE_CAPABILITIES: HostCapabilityFlags = {
  coldSessionResume: true,
  turnReattach: false,
  hostActionV1: true,
}

/**
 * Shared methods with no desktop meaning yet: node settings belong to this
 * desktop's own settings, a fork would cut a worktree before learning sessions
 * cannot fork here, harness installs stay with this desktop's user, and a
 * controller's session keeps its cwd, tags and lifetime as this desktop has them.
 */
const DESKTOP_UNSERVED_METHODS: ReadonlySet<string> = new Set([
  'settings.patch', 'sandbox.probe', 'harness.enable', 'harness.disable',
  'session.fork', 'session.setCwd', 'session.setTags', 'session.setUiFlags', 'session.close', 'session.remove',
  'session.modUi', 'session.notifyArtifactCompleted',
])

/**
 * Terminal methods phones are refused until local terminals move onto control
 * leases: until then a terminal's ownership is the only authority for writing to it.
 */
const LOCAL_TERMINAL_MUTATIONS: ReadonlySet<string> = new Set([
  'terminal.create', 'terminal.write', 'terminal.resize', 'terminal.kill',
  'terminal.acquireControl', 'terminal.renewControl', 'terminal.releaseControl',
])

/**
 * Only the agent catalog of the collaboration family: a controller lists what
 * it can launch here (harnesses, models, key ids and labels; never key
 * material). The mailbox stays with the controller that launches the child.
 */
function desktopCollaborationPort(listProfiles: () => SessionAgentProfile[]): CollaborationPort {
  const unsupported = (method: string) => async () => {
    throw unsupportedMethodError(method)
  }
  return {
    servedMethods: new Set(['collaboration.listProfiles']),
    listProfiles,
    request: unsupported('collaboration.request'),
    start: unsupported('collaboration.start'),
    send: unsupported('collaboration.send'),
    retrieve: unsupported('collaboration.retrieve'),
  }
}

export interface DesktopDomainDeps {
  /** Every session row of this desktop, for the devices that see all of them. */
  rows: DesktopSessionRows<DesktopSessionRow>
  userDataDir: string
  /** Shown to controllers as this environment's name; the host name by default. */
  label?: string
  appVersion: string
  sessions: NodeHostSessionManager
  store: NodeHostSessionStore
  projects: ProjectsPort
  harnesses: HarnessManager
  /** The agent profiles this desktop can launch, as its own collaboration lists them. */
  listAgentProfiles: () => SessionAgentProfile[]
  /** Harness readiness probes and runtime checks (desktop resolver). */
  hooks: Pick<RpcHostHooks, 'probeHarnessReadiness' | 'assertSessionHarnessRuntimeReady'>
  /** This desktop's PTYs, which its phones see and controllers do not. */
  terminals?: TerminalsPort
  /** This desktop's composer drafts and their leases, shared with its window. */
  drafts?: DraftsPort
}

/** What one RPC needs besides who asks and how it is delivered. */
export type DesktopRpcContext = Omit<RpcContext, 'client' | 'streams' | 'requestId' | 'idempotencyKey'>

/**
 * This desktop's environment backend, open while the app runs: its identity,
 * the node database (auth, leases, idempotency, durable event log, Host
 * Actions) and the session host over desktop ports. Every connection — a
 * controller desktop through the node listener, and phones — is served from
 * it; turning node access off closes the listener, not this.
 */
export class DesktopDomain {
  private constructor(
    private readonly db: NodeDatabase,
    readonly identity: NodeIdentity,
    readonly auth: AuthService,
    readonly sessions: DesktopSessionHost,
    /** Every session of this desktop, read-only until local sessions move onto leases. */
    readonly localSessions: LocalSessionHost,
    private readonly recorder: SessionEventRecorder,
    /** The node home (identity, channel root, config). */
    readonly nodeHome: string,
    private readonly context: DesktopRpcContext,
    private readonly phonePorts: Pick<DesktopDomainDeps, 'terminals' | 'drafts'>,
  ) {}

  static open(deps: DesktopDomainDeps): DesktopDomain {
    const paths = desktopNodeHostPaths(deps.userDataDir)
    // The node identity is this desktop's one id; its earlier local id stays an alias.
    const { aliases } = loadDesktopEnvironmentIdentity(deps.userDataDir)
    const identity = { ...loadOrCreateIdentity(paths.nodeHome, deps.label), aliases }
    const db = openNodeDatabase(paths.db)
    try {
      const auth = new AuthService(db, identity)
      const leases = new ControlLeaseService(db)
      const events = new EventLog(db, identity.environmentId)
      reconcileRunsAfterRestart({ db, events, sessions: deps.sessions })
      const recorder = new SessionEventRecorder(deps.sessions, events)
      const sessions = new DesktopSessionHost({
        environmentId: identity.environmentId,
        sessions: deps.sessions,
        store: deps.store,
        leases,
        events,
        hostActions: createSqliteHostActionStore(db),
        projectPath: (projectId) => deps.projects.get(projectId)?.path ?? null,
        controllerLabel: (clientSessionId) =>
          auth.listClientSessions().find((c) => c.clientSessionId === clientSessionId)?.label ?? null,
      })
      const context: DesktopRpcContext = {
        identity,
        idempotency: new IdempotencyService(db),
        leases,
        settingsConfigPath: paths.configJson,
        hooks: desktopRpcHooks(deps),
        capabilities: DESKTOP_NODE_CAPABILITIES,
        startedAt: Date.now(),
        projects: deps.projects,
        workspaceGit: createDesktopWorktreePort(deps.projects),
        sessions,
        harnesses: deps.harnesses,
        collaboration: desktopCollaborationPort(deps.listAgentProfiles),
        unservedMethods: DESKTOP_UNSERVED_METHODS,
        subscriptionUsage: { claudeAccounts: claudeUsageAccounts, log: usageLog },
      }
      const localSessions = new LocalSessionHost({ sessions: deps.sessions, events, rows: deps.rows })
      return new DesktopDomain(db, identity, auth, sessions, localSessions, recorder, paths.nodeHome, context, { terminals: deps.terminals, drafts: deps.drafts })
    } catch (err) {
      db.close()
      throw err
    }
  }

  /** The context a controller's RPCs run in, before its client and delivery: the sessions it started. */
  rpcContext(): DesktopRpcContext {
    return this.context
  }

  /**
   * The context this desktop's phones run in. They are its user's devices:
   * every session and terminal (only read for now), the workspace files and
   * Git the window has, and its drafts, which controllers do not get.
   */
  phoneContext(): DesktopRpcContext {
    return this.phone ??= this.openPhoneContext()
  }

  private phone: DesktopRpcContext | null = null
  /** Watches phones hold, closed with the domain. */
  private readonly watches: Array<{ closeAll(): void }> = []

  private openPhoneContext(): DesktopRpcContext {
    // Recency stays with the window's own project opens.
    const projects: WorkspaceProjects = { get: (projectId) => this.context.projects!.get(projectId), touch: () => {} }
    const workspaceFs = new WorkspaceFsService(projects)
    const workspaceWatch = new WorkspaceWatchService(projects)
    const workspaceTailWatch = new WorkspaceTailWatchService(projects, workspaceFs)
    this.watches.push(workspaceWatch, workspaceTailWatch)
    return {
      ...this.context,
      sessions: this.localSessions,
      workspaceFs,
      workspaceGit: new WorkspaceGitService(projects),
      workspaceWatch,
      workspaceTailWatch,
      terminals: this.phonePorts.terminals,
      drafts: this.phonePorts.drafts,
      unservedMethods: new Set([...DESKTOP_UNSERVED_METHODS, ...LOCAL_SESSION_MUTATIONS, ...LOCAL_TERMINAL_MUTATIONS]),
    }
  }

  close(): void {
    for (const watch of this.watches) watch.closeAll()
    this.recorder.dispose()
    this.localSessions.dispose()
    this.sessions.dispose()
    this.db.close()
  }
}

function desktopRpcHooks(deps: DesktopDomainDeps): RpcHostHooks {
  const unsupported = (method: string) => () => {
    throw unsupportedMethodError(method)
  }
  return {
    // The desktop's harness catalog is the source of readiness; it has no
    // CLI-style binary overrides that bypass it.
    isCodexBinaryOverrideRunnable: () => false,
    isClaudeBinaryOverrideRunnable: () => false,
    resolveReleaseVersion: () => deps.appVersion,
    probeHarnessReadiness: deps.hooks.probeHarnessReadiness,
    assertSessionHarnessRuntimeReady: deps.hooks.assertSessionHarnessRuntimeReady,
    // Installing or switching harnesses stays with this desktop's user.
    enableHarness: async () => {
      throw unsupportedMethodError('harness.enable')
    },
    disableHarness: unsupported('harness.disable'),
    listHarnessModels: unsupported('provider.listModels'),
    forkHarnessResume: async () => {
      throw unsupportedMethodError('session.fork')
    },
  }
}
