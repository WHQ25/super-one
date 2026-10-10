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
  type RpcExtensionDispatch,
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
import { runRpcControl } from '../session/control-context'
import { dispatchRpc } from '@superone/runtime/server'
import { LocalSessionHost, type LocalSessionEdits } from './local-session-host'
import type { DesktopSessionRows } from './desktop-session-reads'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import { desktopNodeHostPaths } from './paths'
import { claudeUsageAccounts } from '../agent/subscription-usage'
import { usageLog } from '../agent/usage-log'
import type { TerminalLeaseAuthority } from '../terminal/terminal-lease'
import type { PhoneRpcRouter } from './routed-phone-rpc'

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
  restore?: import('../session/session-restore-facts').DesktopRestorePorts
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
  beforeDraftOpen?(draftId: string): Promise<void>
  topicNotices?: RpcContext['topicNotices']
  rpcRouter?: PhoneRpcRouter
  /** What a phone's project changes do beyond the registry; controllers cannot edit projects. */
  projectEdits?: DesktopProjectEdits
  /** Desktop methods for phones beyond the shared families (`remote/phone-methods.ts`). */
  phoneMethods?: { dispatch: RpcExtensionDispatch; methods: ReadonlySet<string> }
  sessionEdits?: LocalSessionEdits
  /** Bind local terminal reads and IPC mutations to this domain's one lease authority. */
  bindLocalControl?: (authority: TerminalLeaseAuthority) => void
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
    readonly leases: ControlLeaseService,
    readonly sessions: DesktopSessionHost,
    /** Every session of this desktop, fenced by the same domain leases. */
    readonly localSessions: LocalSessionHost,
    private readonly recorder: SessionEventRecorder,
    private readonly unbindSessions: () => void,
    /** The node home (identity, channel root, config). */
    readonly nodeHome: string,
    private readonly context: DesktopRpcContext,
    private readonly phonePorts: Pick<DesktopDomainDeps, 'terminals' | 'drafts' | 'beforeDraftOpen' | 'phoneMethods' | 'projectEdits' | 'topicNotices' | 'rpcRouter'>,
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
      const unbindSessions = deps.sessions.onSession((session) => session.lease.bind({ environmentId: identity.environmentId, leases }))
      const recorder = new SessionEventRecorder(deps.sessions, events)
      const sessions = new DesktopSessionHost({
        environmentId: identity.environmentId,
        restore: deps.restore,
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
      const localSessions = new LocalSessionHost({ sessions: deps.sessions, events, rows: deps.rows, edits: deps.sessionEdits, drafts: deps.drafts, projectPath: (id) => deps.projects.get(id)?.path ?? null, environmentId: identity.environmentId, restore: deps.restore })
      deps.bindLocalControl?.({ environmentId: identity.environmentId, leases })
      return new DesktopDomain(db, identity, auth, leases, sessions, localSessions, recorder, unbindSessions, paths.nodeHome, context, { terminals: deps.terminals, drafts: deps.drafts, beforeDraftOpen: deps.beforeDraftOpen, phoneMethods: deps.phoneMethods, projectEdits: deps.projectEdits, topicNotices: deps.topicNotices, rpcRouter: deps.rpcRouter })
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
   * every session and terminal, the workspace files and
   * Git the window has, and its drafts, which controllers do not get.
   */
  phoneContext(): DesktopRpcContext {
    return this.phone ??= this.openPhoneContext()
  }

  openPhoneRoute(client: import('@superone/runtime/server').AuthenticatedClient) { return this.phonePorts.rpcRouter?.open(client) }

  private phone: DesktopRpcContext | null = null
  /** Watches phones hold, closed with the domain. */
  private readonly watches: Array<{ closeAll(): void }> = []
  private readonly closeListeners = new Set<() => void>()

  onClose(listener: () => void): void { this.closeListeners.add(listener) }

  private openPhoneContext(): DesktopRpcContext {
    // Recency stays with the window's own project opens.
    const projects: WorkspaceProjects = { get: (projectId) => this.context.projects!.get(projectId), touch: () => {} }
    const workspaceFs = new WorkspaceFsService(projects)
    const workspaceWatch = new WorkspaceWatchService(projects)
    const workspaceTailWatch = new WorkspaceTailWatchService(projects, workspaceFs)
    this.watches.push(workspaceWatch, workspaceTailWatch)
    const edits = this.phonePorts.projectEdits
    return {
      ...this.context,
      ...(edits ? { projects: withProjectEdits(this.context.projects!, edits) } : {}),
      sessions: this.localSessions,
      workspaceFs,
      workspaceGit: new WorkspaceGitService(projects),
      workspaceWatch,
      workspaceTailWatch,
      terminals: this.phonePorts.terminals,
      topicNotices: this.phonePorts.topicNotices,
      drafts: this.phonePorts.drafts,
      beforeDraftOpen: this.phonePorts.beforeDraftOpen,
      extensions: this.phonePorts.phoneMethods?.dispatch,
      extensionMethods: this.phonePorts.phoneMethods?.methods,
      unservedMethods: new Set([...DESKTOP_UNSERVED_METHODS].filter((method) => !method.startsWith('session.')).concat([...this.localSessions.unservedMethods])),
    }
  }

  dispatchRpc: typeof dispatchRpc = (method, payload, ctx) =>
    runRpcControl(ctx.client.clientSessionId, payload, () => dispatchRpc(method, payload, ctx))

  close(): void {
    this.phonePorts.rpcRouter?.close()
    for (const listener of this.closeListeners) {
      try { listener() } catch (error) { console.warn('[desktop-domain] close listener failed', error) }
    }
    this.closeListeners.clear()
    this.unbindSessions()
    for (const watch of this.watches) watch.closeAll()
    this.recorder.dispose()
    this.localSessions.dispose()
    this.sessions.dispose()
    this.leases.dispose()
    this.db.close()
  }
}

export interface DesktopProjectEdits {
  /** Apply a project edit (its extra folders) the way the window does. */
  update(projectPath: string, input: Parameters<ProjectsPort['update']>[0]): void
  /** A project the phone added or cloned opens in the window too. */
  opened(projectPath: string): void
}

/** The desktop's projects with the changes its phones may make; answers are the project after the change. */
function withProjectEdits(projects: ProjectsPort, edits: DesktopProjectEdits): ProjectsPort {
  return {
    ...projects,
    open(path, name) {
      const opened = projects.open(path, name)
      edits.opened(opened.path)
      return opened
    },
    update(input) {
      const project = input.projectId ? projects.get(input.projectId) : projects.list().find((p) => p.path === input.path) ?? null
      if (!project) return null
      edits.update(project.path, input)
      return projects.get(project.projectId)
    },
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
