import {
  AuthService,
  IdempotencyService,
  dispatchRpc,
  deriveIssuedChannelSecret,
  issueChannelCredential,
  loadOrCreateChannelRoot,
  loadOrCreateIdentity,
  startNodeServer,
  unsupportedMethodError,
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
import type { NodeHostPairingToken } from '@superone/shared/agent-types'
import { DesktopSessionHost, type NodeHostSessionManager, type NodeHostSessionStore } from './desktop-session-host'
import { createDesktopWorktreePort } from './desktop-worktree-port'
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

export interface DesktopNodeHostDeps {
  userDataDir: string
  /** Shown to controllers as this environment's name; the host name by default. */
  label?: string
  appVersion: string
  sessions: NodeHostSessionManager
  store: NodeHostSessionStore
  projects: ProjectsPort
  harnesses: HarnessManager
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
}

/**
 * The node surface this desktop serves to other devices: the runtime node
 * server and RPC dispatcher over desktop ports (projects, sessions, harness
 * catalog), with the runtime's auth, leases, idempotency and durable event
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
    private readonly advertisedUrl: string,
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
            extensions: desktopExtensions,
            ...(deps.guiState ? { guiState: deps.guiState } : {}),
          }),
        })
        auth.onRevoke = (clientSessionId) => server.closeSocketsForClient(clientSessionId)
        const port = new URL(server.url).port
        const advertisedUrl = listen.advertisedHost ? `http://${listen.advertisedHost}:${port}` : server.url
        return new DesktopNodeHost(db, identity, auth, sessionHost, server, channelRoot, advertisedUrl)
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

  /** Where other devices reach this host (the advertised host, else the bind address). */
  get url(): string {
    return this.advertisedUrl
  }

  /**
   * A single-use pairing token for another device, with the channel
   * credential it pairs through. Both travel out of band (code or QR).
   */
  mintPairingToken(): NodeHostPairingToken {
    const token = this.auth.createPairingToken()
    return {
      url: this.advertisedUrl,
      channel: issueChannelCredential(this.channelRoot, token.tokenId),
      environmentId: this.identity.environmentId,
      nodePublicKeyFingerprint: this.identity.publicKeyFingerprint,
      tokenId: token.tokenId,
      pairingToken: token.token,
      expiresAt: token.expiresAt,
    }
  }

  async stop(): Promise<void> {
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
