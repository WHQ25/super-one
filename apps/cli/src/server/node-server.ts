import { verifyPayload } from '../crypto-util'
import { dispatchRpc, clearWatchBuffersForClient, type RpcContext } from '../rpc/handlers'
import { cancelMcpAppsInvocationsForClient } from '../rpc/mcp-apps-handlers'
import { createCliRpcHostHooks } from '../rpc/host-hooks'
import type { AuthService } from '../auth/auth-service'
import type { NodeIdentity } from '../identity'
import type { NodeTerminalManager } from '../terminal/manager'
import type { ProjectRegistry } from '../workspace/project-registry'
import type { WorkspaceFsService } from '@superone/runtime/workspace/fs-service'
import type { WorkspaceGitService } from '@superone/runtime/workspace/git-service'
import type { SessionRuntime } from '../session/session-runtime'
import type { HarnessManager } from '../session/harness-manager'
import type { ControlLeaseService } from '../session/control-lease'
import type { EventLog } from '../session/event-log'
import type { CollaborationService } from '../session/collaboration'
import type { WorkspaceWatchService } from '@superone/runtime/workspace/watch-service'
import type { WorkspaceTailWatchService } from '@superone/runtime/workspace/tail-watch-service'
import type { IdempotencyService } from '../auth/idempotency'
import type { ProviderStore } from '../provider/provider-store'
import type { AutomationService, AutomationStore } from '@superone/runtime/automations'
import type { DraftControl } from '@superone/runtime/drafts'
import type { ArtifactZoneService } from '../workspace/artifact-zone'
import type { SessionProviderStore } from '@superone/runtime/session'
import {
  startNodeServer as startRuntimeNodeServer,
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
  drafts: DraftControl
  artifacts: ArtifactZoneService
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

  return startRuntimeNodeServer<RpcContext>({
    identity: opts.identity,
    auth: opts.auth,
    bindHost: opts.bindHost,
    bindPort: opts.bindPort,
    startedAt,
    verifyDeviceProof: verifyPayload,
    dispatchRpc,
    control: opts.leases,
    onClientDisconnected: (clientSessionId) => {
      opts.workspaceWatch.cancelForClient?.(clientSessionId)
      opts.workspaceTailWatch.cancelForClient?.(clientSessionId)
      clearWatchBuffersForClient(clientSessionId)
      cancelMcpAppsInvocationsForClient(clientSessionId)
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
      artifacts: opts.artifacts,
      automations: opts.automations,
      automationService: opts.automationService,
      sessionProviders: opts.sessionProviders,
      hooks,
      startedAt,
      simulatedHarness: opts.simulatedHarness,
    }),
  })
}
