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
import { CollaborationService } from './session/collaboration'
import { createNodeSecretCrypto } from './provider/secret-crypto'
import { WorkspaceWatchService } from './workspace/watch-service'
import { WorkspaceTailWatchService } from './workspace/tail-watch-service'
import { IdempotencyService } from './auth/idempotency'
import { ProviderStore } from './provider/provider-store'
import {
  startHostActionMcpServer,
  type HostActionMcpServerHandle,
} from './session/host-action-mcp-server'
import { loadNodeAgentSettings } from '@superone/runtime/settings'
import {
  AutomationService,
  createAutomationStore,
  type AutomationStore,
} from '@superone/runtime/automations'
import {
  createSessionProviderStore,
  type SessionProviderStore,
} from '@superone/runtime/session'

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
  workspaceTailWatch: WorkspaceTailWatchService
  sessions: SessionRuntime
  harnesses: HarnessManager
  events: EventLog
  leases: ControlLeaseService
  collaboration: CollaborationService
  idempotency: IdempotencyService
  providers: ProviderStore
  automations: AutomationStore
  automationService: AutomationService
  sessionProviders: SessionProviderStore
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
   * Enables simulated multi-harness turns (no real Codex binary) and pre-marks
   * the harness catalog ready. Collaboration RPC is always on (node policy).
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
  const workspaceTailWatch = new WorkspaceTailWatchService(projects, workspaceFs)
  const events = new EventLog(db, identity.environmentId)
  const leases = new ControlLeaseService(db)
  const harnesses = new HarnessManager(db)
  const simulatedHarness = partial.simulatedHarness === true
  // Contract/CI tests: in-memory readiness overlay only (never persisted).
  // Production leaves the durable catalog disabled until real enable/probe paths succeed.
  if (simulatedHarness) {
    harnesses.enableSimulatedOverlay()
  }

  const allowSimulatedTurnFallback =
    partial.allowSimulatedTurnFallback ?? simulatedHarness

  const providers = new ProviderStore(db, paths.providerSecretsKey)
  const collabSecrets = createNodeSecretCrypto(paths.providerSecretsKey)

  // Host Action MCP must call sessions.requestHostAction; collab tools call
  // CollaborationService in-process (late-bound — created after sessions).
  let sessionsRef: SessionRuntime | null = null
  let collaborationRef: CollaborationService | null = null
  const isCollabEnabled = () =>
    loadNodeAgentSettings(paths.configJson).experimentalAgentCollaborationEnabled

  const hostActionMcp = await startHostActionMcpServer({
    requestHostAction: (input) => {
      if (!sessionsRef) {
        return Promise.reject(
          Object.assign(new Error('session runtime not ready'), { code: 'failed_precondition' }),
        )
      }
      return sessionsRef.requestHostAction(input)
    },
    collab: {
      isEnabled: isCollabEnabled,
      listAgents: () => {
        if (!collaborationRef) throw Object.assign(new Error('collab not ready'), { code: 'failed_precondition' })
        return collaborationRef.listProfiles()
      },
      request: async (sessionId, args, signal) => {
        if (!collaborationRef) throw Object.assign(new Error('collab not ready'), { code: 'failed_precondition' })
        const a = (args && typeof args === 'object' ? args : {}) as {
          launches?: Array<{
            launchId?: string
            agentId: string
            task: string
            name: string
            role: string
            config?: Record<string, unknown>
          }>
        }
        return collaborationRef.request({
          parentSessionId: sessionId,
          launches: Array.isArray(a.launches) ? a.launches : [],
          requireUserConfirm: true,
          signal,
        })
      },
      start: async (sessionId, args) => {
        if (!collaborationRef) throw Object.assign(new Error('collab not ready'), { code: 'failed_precondition' })
        const a = (args && typeof args === 'object' ? args : {}) as { credential?: string }
        return collaborationRef.start({
          credential: typeof a.credential === 'string' ? a.credential : undefined,
          callerSessionId: sessionId,
        })
      },
      send: async (sessionId, args) => {
        if (!collaborationRef) throw Object.assign(new Error('collab not ready'), { code: 'failed_precondition' })
        const a = (args && typeof args === 'object' ? args : {}) as {
          credential?: string
          content?: string
          clientMessageId?: string
        }
        return collaborationRef.send({
          sessionId,
          credential: String(a.credential ?? ''),
          content: String(a.content ?? ''),
          clientMessageId: typeof a.clientMessageId === 'string' ? a.clientMessageId : undefined,
        })
      },
      retrieve: async (sessionId, args) => {
        if (!collaborationRef) throw Object.assign(new Error('collab not ready'), { code: 'failed_precondition' })
        const a = (args && typeof args === 'object' ? args : {}) as {
          credentials?: string[]
          credential?: string
        }
        return collaborationRef.retrieve({
          sessionId,
          credentials: Array.isArray(a.credentials) ? a.credentials : undefined,
          credential: typeof a.credential === 'string' ? a.credential : undefined,
        })
      },
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
  const sessionProviders = createSessionProviderStore(db)
  const collaboration = new CollaborationService({
    db,
    events,
    environmentId: identity.environmentId,
    sessions,
    harnesses,
    providers,
    projects,
    workspaceGit,
    secrets: collabSecrets,
    sessionProviders,
    isEnabled: isCollabEnabled,
  })
  collaborationRef = collaboration
  collaboration.rehydrateSystemPrompts()
  const idempotency = new IdempotencyService(db)
  const startedAt = Date.now()

  const automations = createAutomationStore(db, (projectId) => projects.get(projectId)?.path ?? null)
  const automationService = new AutomationService({
    store: automations,
    sessions,
    resolveProjectPath: (projectId) => projects.get(projectId)?.path ?? null,
    // Faster poll in simulated harness tests so due rows fire without long waits.
    pollIntervalMs: simulatedHarness ? 200 : undefined,
    turnTimeoutMs: simulatedHarness ? 15_000 : undefined,
  })
  automationService.start()

  const server = await startNodeServer({
    identity,
    auth,
    terminals,
    projects,
    workspaceFs,
    workspaceGit,
    workspaceWatch,
    workspaceTailWatch,
    sessions,
    harnesses,
    leases,
    events,
    collaboration,
    idempotency,
    providers,
    settingsConfigPath: paths.configJson,
    automations,
    automationService,
    sessionProviders,
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
    workspaceTailWatch,
    sessions,
    harnesses,
    events,
    leases,
    collaboration,
    idempotency,
    providers,
    automations,
    automationService,
    sessionProviders,
    hostActionMcp,
    server,
    startedAt,
    async stop() {
      // 1) Refuse new turns immediately (even while sockets still open).
      // 2) Stop accepting new RPC connections.
      // 3) Drain in-flight turns (Codex SIGTERM→SIGKILL) before closing DB.
      automationService.stop()
      const disposePromise = sessions.dispose()
      await server.close()
      await disposePromise
      await hostActionMcp.stop().catch(() => {})
      workspaceWatch.closeAll()
      workspaceTailWatch.closeAll()
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
