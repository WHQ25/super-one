import {
  AuthService,
  IdempotencyService,
  loadOrCreateIdentity,
  unsupportedMethodError,
  type CollaborationPort,
  type HostCapabilityFlags,
  type NodeIdentity,
  type ProjectsPort,
  type ProvidersPort,
  type RpcContext,
  type RpcHostHooks,
  type TerminalsPort,
  type DraftsPort,
  type RpcExtensionDispatch,
} from '@superone/runtime/server'
import { openNodeDatabase, type NodeDatabase } from '@superone/runtime/db'
import { ControlLeaseService } from '@superone/runtime/lease'
import type { DraftControl } from '@superone/runtime/drafts'
import { EventLog, createSqliteHostActionStore } from '@superone/runtime/session'
import type { HarnessManager } from '@superone/runtime/harness'
import type { SessionAgentProfile } from '@superone/shared/agent-types'
import type { NodeAgentSettings } from '@superone/shared/environment'
import { loadDesktopEnvironmentIdentity } from '../environment/local-identity'
import { DesktopSessionHost, type DesktopSessionEdits, type DesktopSessionHostDeps, type NodeHostSessionManager } from './desktop-session-host'
import { createDesktopGitPort } from './desktop-git-port'
import { createDesktopCatalogMethods, type DesktopCatalog } from './desktop-catalog-methods'
import { createDesktopConfigMethods, type DesktopConfig } from './desktop-config-methods'
import { createDesktopResourceMethods } from './desktop-resource-methods'
import type { ResourceHost } from '@superone/runtime/server/rpc-resources'
import { createDesktopCodexMethods, type DesktopCodexServices } from './desktop-codex-methods'
import { reconcileRunsAfterRestart } from './reconcile-runs'
import {
  WorkspaceFsService,
  WorkspaceTailWatchService,
  WorkspaceWatchService,
  type WorkspaceProjects,
} from '@superone/runtime/workspace'
import { SessionEventRecorder } from './session-event-recorder'
import { runRpcControl } from '../session/control-context'
import { dispatchRpc } from '@superone/runtime/server'
import type { DesktopSessionRows } from './desktop-session-reads'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import { desktopNodeHostPaths } from './paths'
import { claudeUsageAccounts } from '../agent/subscription-usage'
import { usageLog } from '../agent/usage-log'
import type { TerminalLeaseAuthority } from '../terminal/terminal-lease'
import { controlHolderOf, type ControlHolderNames } from '../session/session-lease'
import type { PhoneRpcRouter } from './routed-phone-rpc'

/** Policy flags of the desktop node; its methods follow from the ports this host passes. */
const DESKTOP_NODE_CAPABILITIES: HostCapabilityFlags = {
  coldSessionResume: true,
  turnReattach: false,
  hostActionV1: true,
}

/**
 * Shared methods with no desktop meaning yet: node settings are this desktop's
 * app settings, which only its window edits.
 */
const DESKTOP_UNSERVED_METHODS: ReadonlySet<string> = new Set([
  'settings.patch',
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
  /** Every session row of this desktop. */
  rows: DesktopSessionRows<DesktopSessionRow>
  userDataDir: string
  /** Shown to controllers as this environment's name; the host name by default. */
  label?: string
  appVersion: string
  sessions: NodeHostSessionManager
  projects: ProjectsPort
  harnesses: HarnessManager
  /** The agent profiles this desktop can launch, as its own collaboration lists them. */
  listAgentProfiles: () => SessionAgentProfile[]
  /**
   * Harness readiness probes, runtime checks and installs, as the window's
   * Settings → Harnesses runs them; `pathReady` is the window's login-shell PATH.
   */
  hooks: Pick<RpcHostHooks, 'probeHarnessReadiness' | 'assertSessionHarnessRuntimeReady' | 'enableHarness' | 'disableHarness' | 'pathReady'>
  /** This desktop's PTYs. */
  terminals?: TerminalsPort
  /** This desktop's composer drafts and their leases, shared with its window. */
  drafts?: DraftsPort & Pick<DraftControl, 'releaseDevice'>
  beforeDraftOpen?(draftId: string): Promise<void>
  topicNotices?: RpcContext['topicNotices']
  rpcRouter?: PhoneRpcRouter
  /** What a client's project changes do beyond the registry, as the window applies them. */
  projectEdits?: DesktopProjectEdits
  /** Desktop methods beyond the shared families (`remote/phone-methods.ts`). */
  phoneMethods?: DesktopExtension
  /** The window's harness catalogs, served as the node catalog contract. */
  catalog?: DesktopCatalog
  /** What the window adds to the resource families' files: its shell PATH, Codex and live sessions. */
  resources?: ResourceHost
  /** The window's Codex services, served as the node `codex.*` contract. */
  codex?: DesktopCodexServices
  /** This desktop's credential store, keys withheld (`desktop-providers-port.ts`). */
  providers?: ProvidersPort
  sessionEdits: DesktopSessionEdits
  sideChats?: DesktopSessionHostDeps['sideChats']
  scheduledSends?: DesktopSessionHostDeps['scheduledSends']
  /** Bind local terminal reads and IPC mutations to this domain's one lease authority. */
  bindLocalControl?: (authority: TerminalLeaseAuthority) => void
  /** The name a phone paired with this desktop under, for who holds a session. */
  phoneLabel?(deviceId: string): string | null
  /** This desktop's agent defaults (`desktop-agent-settings.ts`), what `settings.get` reports. */
  agentSettings?: () => NodeAgentSettings
  /** The session provider and automation stores the window edits (`desktop-config-methods.ts`). */
  config?: DesktopConfig
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
    /** Every session of this desktop, for every client. */
    readonly sessions: DesktopSessionHost,
    private readonly recorder: SessionEventRecorder,
    private readonly unbindSessions: () => void,
    /** The node home (identity, channel root, config). */
    readonly nodeHome: string,
    private readonly context: DesktopRpcContext,
    private readonly phonePorts: Pick<DesktopDomainDeps, 'terminals' | 'drafts' | 'beforeDraftOpen' | 'phoneMethods' | 'catalog' | 'config' | 'resources' | 'codex' | 'projectEdits' | 'topicNotices' | 'rpcRouter'>,
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
      const names: ControlHolderNames = {
        controller: (clientSessionId) => controllerLabel(auth, clientSessionId),
        phone: (deviceId) => deps.phoneLabel?.(deviceId) ?? null,
      }
      const unbindSessions = deps.sessions.onSession((session) => session.lease.bind({ environmentId: identity.environmentId, leases, names }))
      const recorder = new SessionEventRecorder(deps.sessions, events)
      const sessions = new DesktopSessionHost({
        environmentId: identity.environmentId,
        restore: deps.restore,
        sessions: deps.sessions,
        rows: deps.rows,
        edits: deps.sessionEdits,
        drafts: deps.drafts,
        sideChats: deps.sideChats,
        scheduledSends: deps.scheduledSends,
        leases,
        events,
        hostActions: createSqliteHostActionStore(db),
        projectPath: (projectId) => deps.projects.get(projectId)?.path ?? null,
        projectId: (path) => deps.projects.list().find((project) => project.path === path)?.projectId ?? null,
        controllerLabel: names.controller,
        controlHolder: (lease) => controlHolderOf(lease, identity.environmentId, names),
        controllerActive: (clientSessionId) =>
          auth.listClientSessions().some((c) => c.clientSessionId === clientSessionId && c.revokedAt === null && c.suspendedAt === null),
      })
      const context: DesktopRpcContext = {
        identity,
        idempotency: new IdempotencyService(db),
        leases,
        settingsConfigPath: paths.configJson,
        ...(deps.agentSettings ? { agentSettings: deps.agentSettings } : {}),
        hooks: desktopRpcHooks(deps),
        capabilities: DESKTOP_NODE_CAPABILITIES,
        startedAt: Date.now(),
        projects: deps.projects,
        ...(deps.providers ? { providers: deps.providers } : {}),
        sessions,
        harnesses: deps.harnesses,
        collaboration: desktopCollaborationPort(deps.listAgentProfiles),
        subscriptionUsage: { claudeAccounts: claudeUsageAccounts, log: usageLog },
      }
      leases.onChange((resource, lease) => {
        if ('sessionId' in resource && resource.environmentId === identity.environmentId) sessions.publishControlHolder(resource.sessionId, lease)
      })
      deps.bindLocalControl?.({ environmentId: identity.environmentId, leases })
      return new DesktopDomain(db, identity, auth, leases, sessions, recorder, unbindSessions, paths.nodeHome, context, { terminals: deps.terminals, drafts: deps.drafts, beforeDraftOpen: deps.beforeDraftOpen, phoneMethods: deps.phoneMethods, catalog: deps.catalog, config: deps.config, resources: deps.resources, codex: deps.codex, projectEdits: deps.projectEdits, topicNotices: deps.topicNotices, rpcRouter: deps.rpcRouter })
    } catch (err) {
      db.close()
      throw err
    }
  }

  /**
   * The one context this desktop serves its clients from — its window, its
   * phones and controller desktops: every session and terminal, the workspace
   * files and Git the window has, its drafts and desktop methods. Clients
   * differ only by who they are (lease actor, client-scoped methods).
   */
  clientContext(): DesktopRpcContext {
    return this.client ??= this.openClientContext()
  }

  openPhoneRoute(client: import('@superone/runtime/server').AuthenticatedClient) { return this.phonePorts.rpcRouter?.open(client) }

  /** A controller lost access (revoked, suspended, paused): its leases and draft grants end with it. */
  revokeClient(clientSessionId: string): void {
    this.leases.revokeHolder(clientSessionId)
    this.releaseClientDrafts(clientSessionId)
  }

  /**
   * A controller went away (its last connection closed, or the listener
   * stopped): its draft grants, which never expire, end as a phone's do.
   */
  releaseClientDrafts(clientSessionId: string): void {
    this.phonePorts.drafts?.releaseDevice(clientSessionId)
  }

  private client: DesktopRpcContext | null = null
  /** Watches clients hold, closed with the domain. */
  private readonly watches: Array<{ closeAll(): void }> = []
  private readonly closeListeners = new Set<() => void>()

  onClose(listener: () => void): void { this.closeListeners.add(listener) }

  private openClientContext(): DesktopRpcContext {
    // Recency stays with the window's own project opens.
    const projects: WorkspaceProjects = { get: (projectId) => this.context.projects!.get(projectId), touch: () => {} }
    const workspaceFs = new WorkspaceFsService(projects)
    const workspaceWatch = new WorkspaceWatchService(projects)
    const workspaceTailWatch = new WorkspaceTailWatchService(projects, workspaceFs)
    this.watches.push(workspaceWatch, workspaceTailWatch)
    const edits = this.phonePorts.projectEdits
    const extension = composeExtensions([
      this.phonePorts.phoneMethods,
      this.phonePorts.catalog && createDesktopCatalogMethods(this.phonePorts.catalog),
      this.phonePorts.config && createDesktopConfigMethods(this.phonePorts.config, this.context.projects!),
      this.phonePorts.resources && createDesktopResourceMethods(this.phonePorts.resources),
      this.phonePorts.codex && createDesktopCodexMethods(this.phonePorts.codex),
    ])
    return {
      ...this.context,
      ...(edits ? { projects: withProjectEdits(this.context.projects!, edits) } : {}),
      workspaceFs,
      workspaceGit: createDesktopGitPort(projects),
      workspaceWatch,
      workspaceTailWatch,
      terminals: this.phonePorts.terminals,
      topicNotices: this.phonePorts.topicNotices,
      drafts: this.phonePorts.drafts,
      beforeDraftOpen: this.phonePorts.beforeDraftOpen,
      extensions: extension.dispatch,
      extensionMethods: extension.methods,
      unservedMethods: new Set([...DESKTOP_UNSERVED_METHODS, ...this.sessions.unservedMethods]),
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
    this.sessions.dispose()
    this.leases.dispose()
    this.db.close()
  }
}

function controllerLabel(auth: AuthService, clientSessionId: string): string | null {
  return auth.listClientSessions().find((c) => c.clientSessionId === clientSessionId)?.label ?? null
}

/** Methods this desktop serves beyond the shared families. */
export interface DesktopExtension { dispatch: RpcExtensionDispatch; methods: ReadonlySet<string> }

/** One extension over several; each method has exactly one owner. */
function composeExtensions(parts: Array<DesktopExtension | null | undefined | false>): DesktopExtension {
  const present = parts.filter((part): part is DesktopExtension => !!part)
  const methods = present.flatMap((part) => [...part.methods])
  const twice = methods.find((method, index) => methods.indexOf(method) !== index)
  if (twice) throw new Error(`desktop extensions both serve ${twice}`)
  return {
    dispatch: async (method, payload, ctx) => {
      const owner = present.find((part) => part.methods.has(method))
      return owner ? owner.dispatch(method, payload, ctx) : null
    },
    methods: new Set(methods),
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
    enableHarness: deps.hooks.enableHarness,
    disableHarness: deps.hooks.disableHarness,
    ...(deps.hooks.pathReady ? { pathReady: deps.hooks.pathReady } : {}),
    listHarnessModels: unsupported('provider.listModels'),
  }
}
