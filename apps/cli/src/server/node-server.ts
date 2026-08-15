import { verifyPayload } from '../crypto-util'
import { dispatchRpc, clearWatchBuffersForClient } from '../rpc/handlers'
import { createCliRpcHostHooks } from '../rpc/host-hooks'
import type { AuthService } from '../auth/auth-service'
import type { NodeIdentity } from '../identity'
import type { NodeTerminalManager } from '../terminal/manager'
import type { ProjectRegistry } from '../workspace/project-registry'
import type { WorkspaceFsService } from '../workspace/fs-service'
import type { WorkspaceGitService } from '../workspace/git-service'
import type { SessionRuntime } from '../session/session-runtime'
import type { HarnessManager } from '../session/harness-manager'
import type { ControlLeaseService } from '../session/control-lease'
import type { EventLog } from '../session/event-log'
import type { CollaborationService } from '../session/collaboration'
import type { WorkspaceWatchService } from '../workspace/watch-service'
import type { WorkspaceTailWatchService } from '../workspace/tail-watch-service'
import type { IdempotencyService } from '../auth/idempotency'
import type { ProviderStore } from '../provider/provider-store'
import type { AutomationService, AutomationStore } from '@superone/runtime/automations'
import type { DraftStore } from '@superone/runtime/drafts'
import type { SessionProviderStore } from '@superone/runtime/session'
import {
  startNodeServer as startRuntimeNodeServer,
  type NodeRpcDispatch,
  type NodeServerHandle,
} from '@superone/runtime/server'

export type { NodeServerHandle }

export interface NodeServerOptions {
  identity: NodeIdentity
  auth: AuthService
  terminals: NodeTerminalManager
  projects: ProjectRegistry
  workspaceFs: WorkspaceFsService
  workspaceGit: WorkspaceGitService
  workspaceWatch: WorkspaceWatchService
  workspaceTailWatch: WorkspaceTailWatchService
  sessions: SessionRuntime
  harnesses: HarnessManager
  leases: ControlLeaseService
  events: EventLog
  collaboration: CollaborationService
  idempotency: IdempotencyService
  providers: ProviderStore
  settingsConfigPath: string
  drafts: DraftStore
  automations: AutomationStore
  automationService: AutomationService
  sessionProviders: SessionProviderStore
  bindHost: string
  bindPort: number
  startedAt?: number
  simulatedHarness?: boolean
}

/** CLI host wrapper: injects RPC dispatch, watch cleanup, and harness hooks. */
export async function startNodeServer(opts: NodeServerOptions): Promise<NodeServerHandle> {
  const hooks = createCliRpcHostHooks()
  const startedAt = opts.startedAt ?? Date.now()

  return startRuntimeNodeServer({
    identity: opts.identity,
    auth: opts.auth,
    bindHost: opts.bindHost,
    bindPort: opts.bindPort,
    startedAt,
    verifyDeviceProof: verifyPayload,
    dispatchRpc: dispatchRpc as NodeRpcDispatch,
    onClientDisconnected: (clientSessionId) => {
      opts.workspaceWatch.cancelForClient?.(clientSessionId)
      opts.workspaceTailWatch.cancelForClient?.(clientSessionId)
      clearWatchBuffersForClient(clientSessionId)
    },
    createRpcContext: () => ({
      identity: opts.identity,
      terminals: opts.terminals,
      projects: opts.projects,
      workspaceFs: opts.workspaceFs,
      workspaceGit: opts.workspaceGit,
      workspaceWatch: opts.workspaceWatch,
      workspaceTailWatch: opts.workspaceTailWatch,
      sessions: opts.sessions,
      harnesses: opts.harnesses,
      leases: opts.leases,
      events: opts.events,
      collaboration: opts.collaboration,
      idempotency: opts.idempotency,
      providers: opts.providers,
      settingsConfigPath: opts.settingsConfigPath,
      drafts: opts.drafts,
      automations: opts.automations,
      automationService: opts.automationService,
      sessionProviders: opts.sessionProviders,
      hooks,
      startedAt,
      simulatedHarness: opts.simulatedHarness,
    }),
  })
}
