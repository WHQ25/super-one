import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { AuthService } from './auth/auth-service'
import { resolveRuntimeConfig, nodePaths, type NodeRuntimeConfig } from './config'
import { openNodeDatabase, type NodeDatabase } from './db/database'
import { loadOrCreateIdentity, type NodeIdentity } from './identity'
import { startNodeServer, type NodeServerHandle } from './server/node-server'
import { NodeTerminalManager } from './terminal/manager'
import { ProjectRegistry } from './workspace/project-registry'
import { WorkspaceFsService } from './workspace/fs-service'
import { WorkspaceGitService } from './workspace/git-service'
import { EventLog } from './session/event-log'
import { ControlLeaseService } from './session/control-lease'
import {
  SessionRuntime,
  createSimulatedCodexRunner,
  type TurnRunner,
} from './session/session-runtime'
import { createMultiHarnessRouter } from './session/harness-runners'
import { createProductionTurnRunner } from './session/codex-turn-runner'
import { HarnessManager } from './session/harness-manager'
import { CollaborationMailbox } from './session/collaboration'
import { WorkspaceWatchService } from './workspace/watch-service'
import { IdempotencyService } from './auth/idempotency'
import { ProviderStore } from './provider/provider-store'
import {
  startHostActionMcpServer,
  type HostActionMcpServerHandle,
} from './session/host-action-mcp-server'

export interface NodeRuntime {
  config: NodeRuntimeConfig
  identity: NodeIdentity
  db: NodeDatabase
  auth: AuthService
  terminals: NodeTerminalManager
  projects: ProjectRegistry
  workspaceFs: WorkspaceFsService
  workspaceGit: WorkspaceGitService
  workspaceWatch: WorkspaceWatchService
  sessions: SessionRuntime
  harnesses: HarnessManager
  events: EventLog
  leases: ControlLeaseService
  collaboration: CollaborationMailbox
  idempotency: IdempotencyService
  providers: ProviderStore
  /** Loopback Host Action MCP (browser_snapshot → desktop). Null when disabled. */
  hostActionMcp: HostActionMcpServerHandle | null
  server: NodeServerHandle
  startedAt: number
  stop(): Promise<void>
}

export interface StartNodeRuntimeOptions extends Partial<NodeRuntimeConfig> {
  /** Inject a turn runner (tests / real Codex adapter). Defaults to simulated Codex. */
  turnRunner?: TurnRunner
  /**
   * Opt-in for collaboration contracts / tests that need the collab mailbox
   * surface. Session list/create/send are always enabled (injectable turn runner).
   * Also enables simulated multi-harness turns (no real Codex binary).
   */
  simulatedHarness?: boolean
  /**
   * When true (default for tests via simulatedHarness), missing Codex/Claude
   * binaries fall back to the simulated runner. Production leaves this false
   * so turns fail closed without a real harness binary.
   */
  allowSimulatedTurnFallback?: boolean
}

export async function startNodeRuntime(partial: StartNodeRuntimeOptions = {}): Promise<NodeRuntime> {
  const config = resolveRuntimeConfig(partial)
  const paths = nodePaths(config.nodeHome)
  const identity = loadOrCreateIdentity(config.nodeHome, config.label)
  const db = openNodeDatabase(paths.stateDb)
  const auth = new AuthService(db, identity)
  const terminals = new NodeTerminalManager(db)
  const projects = new ProjectRegistry(db)
  const workspaceFs = new WorkspaceFsService(projects)
  const workspaceGit = new WorkspaceGitService(projects)
  const workspaceWatch = new WorkspaceWatchService(projects)
  const events = new EventLog(db, identity.environmentId)
  const leases = new ControlLeaseService(db)
  const harnesses = new HarnessManager(db)
  // Collaboration stays opt-in; session RPC is always available.
  const simulatedHarness = partial.simulatedHarness === true
  // Contract/CI tests: in-memory readiness overlay only (never persisted).
  // Production leaves the durable catalog disabled until real enable/probe paths succeed.
  if (simulatedHarness) {
    harnesses.enableSimulatedOverlay()
  }

  const allowSimulatedTurnFallback =
    partial.allowSimulatedTurnFallback ?? simulatedHarness

  const providers = new ProviderStore(db, paths.providerSecretsKey)

  // Host Action MCP must call sessions.requestHostAction; wire via late binding.
  let sessionsRef: SessionRuntime | null = null
  const hostActionMcp = await startHostActionMcpServer({
    requestHostAction: (input) => {
      if (!sessionsRef) {
        return Promise.reject(
          Object.assign(new Error('session runtime not ready'), { code: 'failed_precondition' }),
        )
      }
      return sessionsRef.requestHostAction(input)
    },
  })

  const turnRunner =
    partial.turnRunner ??
    (simulatedHarness
      ? createMultiHarnessRouter('codex')
      : createProductionTurnRunner({
          harnesses,
          resolveProjectPath: (projectId) => projects.get(projectId)?.path ?? null,
          allowSimulatedFallback: allowSimulatedTurnFallback,
          providers,
          // Claude: in-process SDK MCP (same core tools as HTTP).
          createHostActionClaudeMcp: (sessionId) => hostActionMcp.createClaudeSdkMcp(sessionId),
          // Codex / ACP / OpenCode: loopback HTTP with per-session HMAC.
          getCodexHostActionMcp: (sessionId) => hostActionMcp.getCodexMcpConfig(sessionId),
          getAcpHostActionMcpServers: (sessionId) => [
            hostActionMcp.getAcpMcpServer(sessionId),
          ],
          getOpenCodeHostActionMcp: (sessionId) => {
            const cfg = hostActionMcp.getHttpConfig(sessionId)
            return { url: cfg.url, headers: cfg.headers }
          },
        }))

  const sessions = new SessionRuntime(
    db,
    events,
    leases,
    identity.environmentId,
    turnRunner,
  )
  sessionsRef = sessions
  const collaboration = new CollaborationMailbox(db, events, identity.environmentId)
  const idempotency = new IdempotencyService(db)
  const startedAt = Date.now()

  const server = await startNodeServer({
    identity,
    auth,
    terminals,
    projects,
    workspaceFs,
    workspaceGit,
    workspaceWatch,
    sessions,
    harnesses,
    leases,
    events,
    collaboration,
    idempotency,
    providers,
    bindHost: config.bindHost,
    bindPort: config.bindPort,
    startedAt,
    simulatedHarness,
  })

  writeFileSync(
    paths.runtimeJson,
    JSON.stringify(
      {
        environmentId: identity.environmentId,
        nodePublicKeyFingerprint: identity.publicKeyFingerprint,
        bindHost: config.bindHost,
        bindPort: config.bindPort,
        url: server.url,
        pid: process.pid,
        startedAt,
      },
      null,
      2,
    ),
    'utf8',
  )

  return {
    config,
    identity,
    db,
    auth,
    terminals,
    projects,
    workspaceFs,
    workspaceGit,
    workspaceWatch,
    sessions,
    harnesses,
    events,
    leases,
    collaboration,
    idempotency,
    providers,
    hostActionMcp,
    server,
    startedAt,
    async stop() {
      // 1) Refuse new turns immediately (even while sockets still open).
      // 2) Stop accepting new RPC connections.
      // 3) Drain in-flight turns (Codex SIGTERM→SIGKILL) before closing DB.
      const disposePromise = sessions.dispose()
      await server.close()
      await disposePromise
      await hostActionMcp.stop().catch(() => {})
      workspaceWatch.closeAll()
      terminals.killAll()
      db.close()
    },
  }
}

export function createLocalPairingToken(nodeHome?: string): {
  token: string
  expiresAt: number
  environmentId: string
} {
  const config = resolveRuntimeConfig({ nodeHome })
  const paths = nodePaths(config.nodeHome)
  const identity = loadOrCreateIdentity(config.nodeHome)
  const db = openNodeDatabase(paths.stateDb)
  try {
    const auth = new AuthService(db, identity)
    const pair = auth.createPairingToken()
    return {
      token: pair.token,
      expiresAt: pair.expiresAt,
      environmentId: identity.environmentId,
    }
  } finally {
    db.close()
  }
}

export function readRuntimeStatus(nodeHome?: string): Record<string, unknown> | null {
  const paths = nodePaths(resolveRuntimeConfig({ nodeHome }).nodeHome)
  if (!existsSync(paths.runtimeJson)) return null
  try {
    return JSON.parse(readFileSync(paths.runtimeJson, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}
