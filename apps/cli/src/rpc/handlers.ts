import { dirname as configDirname } from 'node:path'
import {
  dispatchRpc as dispatchNodeRpc,
  type HostCapabilityFlags,
  type RpcContext as NodeRpcContext,
  type RpcResult,
} from '@superone/runtime/server'
import { loadNodeAgentSettings } from '@superone/runtime/settings'
import type { AutomationService, AutomationStore } from '@superone/runtime/automations'
import type { DraftControl } from '@superone/runtime/drafts'
import type { SessionProviderStore } from '@superone/runtime/session'
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
import type { ArtifactZoneService } from '../workspace/artifact-zone'
import { dispatchSessionArchiveRpc, SESSION_ARCHIVE_RPC_METHODS } from './session-archive-handlers'
import { dispatchMcpAppsRpc, MCP_APPS_RPC_METHODS } from './mcp-apps-handlers'
import { dispatchResourceRpc, RESOURCE_RPC_METHODS } from './resource-handlers'
import { AUTOMATION_RPC_METHODS, dispatchAutomationRpc } from './automation-handlers'
import { ARTIFACT_RPC_METHOD_SET, dispatchArtifactRpc } from './artifact-handlers'
import { CODEX_RPC_METHODS, dispatchCodexRpc } from './codex-handlers'
import { dispatchSessionProviderRpc, SESSION_PROVIDER_RPC_METHODS } from './session-provider-handlers'
import { dispatchHarnessResourcesRpc, HARNESS_RESOURCES_RPC_METHODS } from './harness-resources-handlers'

export type { RpcResult }
export { clearWatchBuffersForClient } from '@superone/runtime/server'

/**
 * The CLI node's RPC context: every shared port bound to the CLI's concrete
 * service, plus the stores only the CLI's own method families use.
 */
export interface RpcContext
  extends Omit<NodeRpcContext, 'capabilities' | 'extensions' | 'sessionProviders' | 'artifacts'> {
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
  /** Project-scoped automations store (CRUD). */
  automations: AutomationStore
  /**
   * Unsent composer drafts stored on this node (shared `draft.*`). Deliberately
   * absent from the node's mutating set: writes key off a client-minted draft
   * id, so they are idempotent by construction and the controller outbox can
   * retry a queued write freely without replay receipts.
   */
  drafts: DraftControl
  /**
   * Session sync zone under `<nodeHome>/sync` (`artifact.*`). Like drafts,
   * absent from the mutating set: `put` is idempotent by its offset contract.
   */
  artifacts: ArtifactZoneService
  /** Process-lifecycle scheduler + runNow executor. */
  automationService: AutomationService
  /** Session-layer provider profiles (claude-base, custom multi-profile, …). */
  sessionProviders: SessionProviderStore
}

/** Capability flags the CLI node sets as policy; its methods follow from its ports and extensions. */
const CLI_CAPABILITY_FLAGS: HostCapabilityFlags = {
  // provider_resume is durable in SQLite; Claude/Codex reopen after node restart
  // and continue from claude-session:<id> / thread:<id> on the next turn.
  coldSessionResume: true,
  // Mid-turn reattach across process restart is not implemented for any harness
  // yet — streaming rows are reconciled to interrupted (see SessionRuntime).
  turnReattach: false,
  hostActionV1: true,
}

/** Every method only the CLI node serves (`dispatchCliRpc`). */
const CLI_EXTENSION_METHODS: ReadonlySet<string> = new Set([
  ...SESSION_ARCHIVE_RPC_METHODS,
  ...RESOURCE_RPC_METHODS,
  ...AUTOMATION_RPC_METHODS,
  ...ARTIFACT_RPC_METHOD_SET,
  ...SESSION_PROVIDER_RPC_METHODS,
  ...HARNESS_RESOURCES_RPC_METHODS,
  ...MCP_APPS_RPC_METHODS,
  ...CODEX_RPC_METHODS,
])

/** Serve one node RPC with the shared families plus the CLI's own. */
export function dispatchRpc(method: string, payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  return dispatchNodeRpc(method, payload, {
    ...ctx,
    capabilities: CLI_CAPABILITY_FLAGS,
    extensions: (extMethod, extPayload) => dispatchCliRpc(extMethod, extPayload, ctx),
    extensionMethods: CLI_EXTENSION_METHODS,
  })
}

const PLUGIN_RELOAD_METHODS = new Set(['plugins.setEnabled', 'plugins.install', 'plugins.update', 'plugins.delete'])

/** Method families only the CLI node serves; null hands the method to the shared families. */
async function dispatchCliRpc(method: string, payload: unknown, ctx: RpcContext): Promise<RpcResult | null> {
  const archive = dispatchSessionArchiveRpc(method, payload, ctx)
  if (archive) return archive
  const resource = dispatchResourceRpc(method, payload, {
    client: ctx.client,
    projects: ctx.projects,
    harnesses: ctx.harnesses,
    providers: ctx.providers,
  })
  if (resource) {
    const result = await resource
    // A live Claude process loads plugins once; a change on disk reaches it by reload.
    if (!result.error && PLUGIN_RELOAD_METHODS.has(method)) void ctx.sessions.reloadPlugins()
    return result
  }

  const automation = dispatchAutomationRpc(method, payload, {
    client: ctx.client,
    projects: ctx.projects,
    automations: ctx.automations,
    automationService: ctx.automationService,
  })
  if (automation) return await automation

  const artifact = dispatchArtifactRpc(method, payload, {
    client: ctx.client,
    environmentId: ctx.identity.environmentId,
    sessions: ctx.sessions,
    leases: ctx.leases,
    artifacts: ctx.artifacts,
  })
  if (artifact) return await artifact

  const sessionProviders = dispatchSessionProviderRpc(method, payload, {
    client: ctx.client,
    sessionProviders: ctx.sessionProviders,
  })
  if (sessionProviders) return sessionProviders

  const harnessResources = await dispatchHarnessResourcesRpc(method, payload, {
    client: ctx.client,
    projects: ctx.projects,
    providers: ctx.providers,
    harnesses: ctx.harnesses,
    experimentalClaudeOpenAiChatEnabled:
      loadNodeAgentSettings(ctx.settingsConfigPath).experimentalClaudeOpenAiChatEnabled,
  })
  if (harnessResources) return harnessResources

  const mcpApps = await dispatchMcpAppsRpc(method, payload, ctx)
  if (mcpApps) return mcpApps

  const codex = await dispatchCodexRpc(method, payload, {
    nodeHome: configDirname(ctx.settingsConfigPath),
    client: ctx.client,
    projects: ctx.projects,
    harnesses: ctx.harnesses,
    providers: ctx.providers,
  })
  if (codex) return codex

  return null
}
