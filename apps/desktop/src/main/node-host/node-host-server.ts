import {
  AuthService,
  IdempotencyService,
  dispatchRpc,
  deriveIssuedChannelSecret,
  issueChannelCredential,
  loadOrCreateChannelRoot,
  loadOrCreateIdentity,
  nodeRelayRoomId,
  RelayNodeHost,
  startNodeServer,
  unsupportedMethodError,
  type CollaborationPort,
  type HostCapabilityFlags,
  type NodeIdentity,
  type NodeServerHandle,
  type ProjectsPort,
  type RpcContext,
  type RpcExtensionDispatch,
  type RpcHostHooks,
} from '@superone/runtime/server'
import { openNodeDatabase, type NodeDatabase } from '@superone/runtime/db'
import { ControlLeaseService } from '@superone/runtime/lease'
import { EventLog, createSqliteHostActionStore } from '@superone/runtime/session'
import type { HarnessManager } from '@superone/runtime/harness'
import { verifyPayload } from '@superone/runtime/crypto/crypto-util'
import type { NodeHostPairingToken, SessionAgentProfile } from '@superone/shared/agent-types'
import { DesktopSessionHost, type NodeHostSessionManager, type NodeHostSessionStore } from './desktop-session-host'
import { createDesktopWorktreePort } from './desktop-worktree-port'
import { reconcileRunsAfterRestart } from './reconcile-runs'
import { desktopNodeHostPaths, DESKTOP_NODE_LOOPBACK_HOST } from './paths'

/**
 * Policy flags of the desktop node. The port-backed families (sessions, git, …)
 * are derived by the dispatcher from the ports this host passes.
 */
const DESKTOP_NODE_CAPABILITIES: HostCapabilityFlags = {
  mcp: false,
  fileTransfer: false,
  nodeAdmin: false,
  coldSessionResume: true,
  turnReattach: false,
  hostActionV1: true,
  drafts: false,
  messageIdempotency: true,
}

/**
 * Methods the shared families would serve without a port but that have no
 * desktop meaning yet: node settings belong to this desktop's own settings,
 * and a fork would cut a worktree before learning sessions cannot fork here.
 */
const DESKTOP_UNSERVED_METHODS = new Set(['settings.patch', 'sandbox.probe', 'session.fork'])

const desktopExtensions: RpcExtensionDispatch = (method) => {
  if (!DESKTOP_UNSERVED_METHODS.has(method)) return null
  const { code, message, details } = unsupportedMethodError(method)
  return { error: { code, message, details } }
}

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

export interface DesktopNodeHostDeps {
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
  /** Whether GUI tools can run now (`environment.status`). */
  guiState?: RpcContext['guiState']
  /** Harness readiness probes and runtime checks (desktop resolver). */
  hooks: Pick<RpcHostHooks, 'probeHarnessReadiness' | 'assertSessionHarnessRuntimeReady'>
}

export interface DesktopNodeHostListen {
  bindPort: number
  /** Loopback by default; every request beyond `/health` runs inside the encrypted channel either way. */
  bindHost?: string
  /** The address other devices reach this host at, for the pairing code. */
  advertisedHost?: string
  /** This host's Tailscale address, offered in the pairing code. */
  tailscaleHost?: string
  /** Accept a TCP peer only when this returns true (private networks when listening beyond loopback). */
  allowRemoteAddress?: (address: string | undefined) => boolean
  /** Relay broker (`wss://…`) that carries the channel when devices are not on one network. */
  relayUrl?: string
  onRelayStatus?: (connected: boolean) => void
  log?: { info: (message: string) => void; warn: (message: string) => void }
}

/**
 * The node surface this desktop serves to other devices: the runtime node
 * server and RPC dispatcher over desktop ports (projects, sessions, harness
 * and agent catalogs), with the runtime's auth, leases, idempotency and durable event
 * log in a node database of its own under userData.
 */
export class DesktopNodeHost {
  private constructor(
    private readonly db: NodeDatabase,
    readonly identity: NodeIdentity,
    private readonly auth: AuthService,
    private readonly sessionHost: DesktopSessionHost,
    private readonly server: NodeServerHandle,
    private readonly channelRoot: string,
    private readonly listen: DesktopNodeHostListen,
    private readonly relay: RelayNodeHost | null,
  ) {}

  static async start(deps: DesktopNodeHostDeps, listen: DesktopNodeHostListen): Promise<DesktopNodeHost> {
    const paths = desktopNodeHostPaths(deps.userDataDir)
    const identity = loadOrCreateIdentity(paths.nodeHome, deps.label)
    const db = openNodeDatabase(paths.db)
    try {
      const auth = new AuthService(db, identity)
      const leases = new ControlLeaseService(db)
      const idempotency = new IdempotencyService(db)
      const events = new EventLog(db, identity.environmentId)
      reconcileRunsAfterRestart({ db, events, store: deps.store, sessions: deps.sessions })
      const sessionHost = new DesktopSessionHost({
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
      const hooks = desktopRpcHooks(deps)
      const workspaceGit = createDesktopWorktreePort(deps.projects)
      const collaboration = desktopCollaborationPort(deps.listAgentProfiles)
      const startedAt = Date.now()
      const bindHost = listen.bindHost ?? DESKTOP_NODE_LOOPBACK_HOST
      // Pairing, tokens and RPC run only inside the pairing-secret channel
      // (AES-256-GCM over ws), so the server may listen beyond loopback.
      const channelRoot = loadOrCreateChannelRoot(paths.nodeHome)
      try {
        const server = await startNodeServer<RpcContext>({
          identity,
          auth,
          bindHost,
          bindPort: listen.bindPort,
          startedAt,
          verifyDeviceProof: verifyPayload,
          dispatchRpc,
          secureChannel: { resolveSecret: (keyId) => deriveIssuedChannelSecret(channelRoot, keyId) },
          ...(listen.allowRemoteAddress ? { allowRemoteAddress: listen.allowRemoteAddress } : {}),
          onClientDisconnected: () => {},
          createRpcContext: () => ({
            identity,
            idempotency,
            leases,
            settingsConfigPath: paths.configJson,
            hooks,
            capabilities: DESKTOP_NODE_CAPABILITIES,
            startedAt,
            projects: deps.projects,
            workspaceGit,
            sessions: sessionHost,
            harnesses: deps.harnesses,
            collaboration,
            extensions: desktopExtensions,
            ...(deps.guiState ? { guiState: deps.guiState } : {}),
          }),
        })
        auth.onRevoke = (clientSessionId) => server.closeSocketsForClient(clientSessionId)
        // The relay carries the same channel frames for devices on other networks.
        const relay = listen.relayUrl
          ? new RelayNodeHost({
              relayUrl: listen.relayUrl,
              roomId: nodeRelayRoomId(channelRoot),
              onSocket: (socket) => server.acceptChannelSocket(socket),
              onStatus: listen.onRelayStatus,
              log: listen.log,
            })
          : null
        relay?.start()
        return new DesktopNodeHost(db, identity, auth, sessionHost, server, channelRoot, listen, relay)
      } catch (err) {
        sessionHost.dispose()
        throw err
      }
    } catch (err) {
      db.close()
      throw err
    }
  }

  /** The `session.*` surface, for tools of sessions served here. */
  get sessions(): DesktopSessionHost {
    return this.sessionHost
  }

  /** Port the node server listens on. */
  get port(): number {
    return Number(new URL(this.server.url).port)
  }

  /** Where other devices reach this host on its LAN (the advertised host, else the bind address). */
  get url(): string {
    return this.listen.advertisedHost ? `http://${this.listen.advertisedHost}:${this.port}` : this.server.url
  }

  get relayConnected(): boolean {
    return this.relay?.connected === true
  }

  /**
   * A single-use pairing token for another device, with the channel
   * credential it pairs through. Both travel out of band (code or QR).
   */
  mintPairingToken(): NodeHostPairingToken {
    const token = this.auth.createPairingToken()
    return {
      url: this.url,
      lan: { host: this.listen.advertisedHost ?? new URL(this.server.url).hostname, port: this.port },
      ...(this.listen.tailscaleHost ? { tailscaleHost: this.listen.tailscaleHost } : {}),
      ...(this.relay && this.listen.relayUrl
        ? { relay: { url: this.listen.relayUrl, room: nodeRelayRoomId(this.channelRoot) } }
        : {}),
      channel: issueChannelCredential(this.channelRoot, token.tokenId),
      environmentId: this.identity.environmentId,
      nodePublicKeyFingerprint: this.identity.publicKeyFingerprint,
      tokenId: token.tokenId,
      pairingToken: token.token,
      expiresAt: token.expiresAt,
    }
  }

  async stop(): Promise<void> {
    this.relay?.stop()
    this.sessionHost.dispose()
    try {
      await this.server.close()
    } finally {
      this.db.close()
    }
  }
}

function desktopRpcHooks(deps: DesktopNodeHostDeps): RpcHostHooks {
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
