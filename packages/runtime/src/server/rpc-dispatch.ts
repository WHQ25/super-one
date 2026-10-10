import { dirname as configDirname, isAbsolute, join as pathJoin, resolve as pathResolve, sep } from 'node:path'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { arch, cpus, freemem, homedir, hostname, platform, totalmem, uptime } from 'node:os'
import { parseMessageDisplay } from '@superone/shared/message-display'
import { MOD_UI_MUTATING_OPS, MOD_UI_UNAVAILABLE, type ModUiOp, type ModUiRequest } from '@superone/shared/mod-ui'
import {
  DATABASE_SCHEMA_GENERATION,
  PROTOCOL_GENERATION,
  hasAllScopes,
  isNodeHarnessId,
  nodeProjectsDir,
  normalizeSessionHarnessId,
  OPERATION_SCOPES,
  providerSessionIdFromResume,
  type AuthScope,
  type EnvironmentAggregateType,
  type EnvironmentUsageReport,
  type ExecutionEnvironmentDescriptor,
  type NodeAgentSettingsPatch,
  type RpcErrorCode,
} from '@superone/shared/environment'
import { applySessionTagOp, parseSessionTagOp } from '@superone/shared/session-tags'
import { cloneRepository, resolveCloneDestination, type CloneRepositoryInput } from '@superone/shared/git-clone'
import { normalizeGitRemoteUrl, repoIdentityRemote } from '@superone/shared/git-remote-url'
import { isGitRemoteName } from '../git/index'
import { detectRepoIdentity } from '../workspace/index'
import { isGitMentionRefKind } from '@superone/shared/git-mention-query'
import type { ConsumerBinding, ConsumerId, Platform } from '@superone/shared/platform-registry'
import { loadNodeAgentSettings, patchNodeAgentSettings, resolveAgentTurnDefaults } from '../settings/index'
import { probeSandboxRpc } from '../sandbox/index'
import { getMachineInfo, readLiveStatus } from '../machine/index'
import { readSubscriptionUsage } from '../usage/index'
import { settingsFromSessionProviderConfig, type NodeSessionRecord } from '../session/index'
import type { AuthenticatedClient } from './auth-service'
import { isNodeMutatingCall } from './rpc-mutating-methods'
import { unsupportedMethodError } from './unsupported'
import { openEventStream, streamFilterMatcher, type EventStreamFilter } from './event-stream'
import { readTopicRef, type TopicRef } from '@superone/shared/environment/topics'
import type {
  ArtifactZonePort,
  RpcContext as HostRpcContext,
  RpcResult,
  WorkspaceGitPort,
} from './rpc-context'

/** Ports that gate a whole method family; see {@link requiredPorts}. */
type FamilyPort =
  | 'projects'
  | 'terminals'
  | 'workspaceFs'
  | 'workspaceGit'
  | 'workspaceWatch'
  | 'workspaceTailWatch'
  | 'sessions'
  | 'harnesses'
  | 'collaboration'
  | 'providers'

/**
 * The context a handler sees once {@link requiredPorts} admitted its method.
 * Ports a handler only uses opportunistically outside its own family
 * (`workspaceGit` from session.*, `artifacts`) are read through
 * {@link optionalGit} / `ctx.artifacts` instead.
 */
type RpcContext = HostRpcContext & Required<Pick<HostRpcContext, FamilyPort>>

/**
 * Ports a method needs. A host that lacks one does not serve the family, and
 * the method answers with {@link unsupported} rather than failing deep inside.
 */
function requiredPorts(method: string): readonly FamilyPort[] {
  const family = method.slice(0, method.indexOf('.') + 1)
  switch (family) {
    case 'harness.':
      return ['harnesses']
    case 'provider.':
      return ['providers']
    case 'terminal.':
      return ['terminals']
    case 'project.':
      return ['projects']
    case 'fs.':
      return ['workspaceFs']
    case 'workspace.':
      if (method.startsWith('workspace.watch')) return ['workspaceWatch']
      if (method.startsWith('workspace.tailWatch')) return ['workspaceTailWatch']
      return ['workspaceFs']
    case 'git.':
      return method === 'git.clone' ? ['projects'] : ['workspaceGit']
    case 'session.':
      return method === 'session.create' ? ['sessions', 'projects', 'harnesses'] : ['sessions', 'projects']
    case 'collaboration.':
      return ['collaboration']
    default:
      return []
  }
}

function serves(ctx: HostRpcContext, method: string): boolean {
  // A partial port (`servedMethods`) serves only the methods it names.
  return requiredPorts(method).every((port) => {
    const served = ctx[port] as { readonly servedMethods?: ReadonlySet<string> } | undefined
    return served != null && (!served.servedMethods || served.servedMethods.has(method))
  })
}

/** The explicit answer for a method family this host does not serve. */
function unsupported(method: string): RpcResult {
  return mapThrown(unsupportedMethodError(method))
}

/** The git port when a non-git handler can use it; absent on hosts without git. */
function optionalGit(ctx: HostRpcContext): WorkspaceGitPort | undefined {
  return ctx.workspaceGit
}

/**
 * Whether `cwd` may be a session's working directory. With a git port the
 * project root and its worktrees qualify; without one only the project root.
 */
function isAllowedSessionCwd(ctx: RpcContext, projectId: string, cwd: string): boolean {
  const git = optionalGit(ctx)
  if (git) return git.isAllowedSessionCwd(projectId, cwd)
  const root = ctx.projects.get(projectId)?.path
  return !!root && pathResolve(cwd) === pathResolve(root)
}

function requireScopes(client: AuthenticatedClient, scopes: readonly AuthScope[]): RpcResult | null {
  if (!hasAllScopes(client.scopes, scopes)) {
    return { error: { code: 'forbidden', message: `missing scopes: ${scopes.join(', ')}` } }
  }
  return null
}

function mapOs(): ExecutionEnvironmentDescriptor['platform']['os'] {
  const p = platform()
  if (p === 'darwin' || p === 'linux') return p
  if (p === 'win32') return 'windows'
  return 'linux'
}

/** In-memory watch buffers keyed by watchId (per-process), owned by clientSessionId. */
const watchBuffers = new Map<
  string,
  { events: Array<{ path: string; type: string }>; cancel: () => void; owner: string }
>()

/** Clear handler-side buffers when client disconnects/revokes. */
export function clearWatchBuffersForClient(clientSessionId: string): void {
  for (const [watchId, buf] of [...watchBuffers]) {
    if (buf.owner !== clientSessionId) continue
    buf.cancel()
    watchBuffers.delete(watchId)
  }
}

/**
 * Transport bound on a turn's directory set — the union of the project's
 * workspace folders and the session scope. Well above the 16-folder project cap
 * so the bound is about payload size, never policy.
 */
const MAX_TURN_ADDITIONAL_DIRS = 64

/**
 * Dispatch one node RPC: mutating calls go through the idempotency receipts,
 * host extensions run first, then the shared families the host serves.
 */
export async function dispatchRpc(method: string, payload: unknown, ctx: HostRpcContext): Promise<RpcResult> {
  if (isNodeMutatingCall(method, payload)) {
    if (!ctx.idempotencyKey) {
      return {
        error: {
          code: 'invalid_argument',
          message: `idempotencyKey required for mutating method ${method}`,
        },
      }
    }
    const hash = ctx.idempotency.payloadHash(payload)
    try {
      // watchStart keeps durable receipts so lost-response retries replay the same
      // watchId, but isReceiptLive discards dead ids after stop/disconnect/restart.
      const result = await ctx.idempotency.runExclusive(
        ctx.client.clientSessionId,
        method,
        ctx.idempotencyKey,
        hash,
        async () => {
          const inner = await dispatchRpcInner(method, payload, ctx)
          if (inner.error) {
            throw Object.assign(new Error(inner.error.message), {
              code: inner.error.code,
              details: inner.error.details,
              __rpcError: true,
            })
          }
          return inner.result
        },
        {
          durable: true,
          isReceiptLive:
            method === 'workspace.watchStart'
              ? (receipt: unknown) => {
                  const watchId = (receipt as { watchId?: string } | null)?.watchId
                  if (!watchId) return false
                  const buf = watchBuffers.get(watchId)
                  return !!buf && buf.owner === ctx.client.clientSessionId
                }
              : method === 'workspace.tailWatchStart'
                ? (receipt: unknown) => {
                    const watchId = (receipt as { watchId?: string } | null)?.watchId
                    if (!watchId) return false
                    return !!ctx.workspaceTailWatch?.isLive(watchId, ctx.client.clientSessionId)
                  }
                : undefined,
        },
      )
      return { result }
    } catch (err) {
      const e = err as { __rpcError?: boolean; code?: string; message?: string; details?: Record<string, unknown> }
      if (e.__rpcError) {
        return {
          error: {
            code: (e.code as RpcErrorCode) || 'internal',
            message: e.message || 'error',
            details: e.details,
          },
        }
      }
      return mapThrown(err)
    }
  }

  return dispatchRpcInner(method, payload, ctx)
}

async function dispatchRpcInner(method: string, payload: unknown, hostCtx: HostRpcContext): Promise<RpcResult> {
  const extension = await hostCtx.extensions?.(method, payload, hostCtx)
  if (extension) return extension
  if (!serves(hostCtx, method)) return unsupported(method)
  const ctx = hostCtx as RpcContext

  switch (method) {
    case 'environment.descriptor':
      return handleDescriptor(ctx)
    case 'environment.health':
      return handleHealth(ctx)
    case 'environment.systemInfo':
      return handleSystemInfo(ctx)
    case 'environment.status':
      return handleStatus(ctx)
    case 'environment.usage':
      return handleUsage(payload, ctx)
    case 'settings.get':
      return handleSettingsGet(ctx)
    case 'settings.patch':
      return handleSettingsPatch(payload, ctx)
    case 'sandbox.probe':
      return handleSandboxProbe(ctx)
    case 'harness.list':
      return handleHarnessList(ctx)
    case 'harness.show':
      return handleHarnessShow(payload, ctx)
    case 'harness.probe':
      return handleHarnessProbe(payload, ctx)
    case 'harness.enable':
      return handleHarnessEnable(payload, ctx)
    case 'harness.disable':
      return handleHarnessDisable(payload, ctx)
    case 'terminal.create':
      return handleTerminalCreate(payload, ctx)
    case 'terminal.attach':
      return handleTerminalAttach(payload, ctx)
    case 'terminal.read':
      return handleTerminalRead(payload, ctx)
    case 'terminal.write':
      return handleTerminalWrite(payload, ctx)
    case 'terminal.resize':
      return handleTerminalResize(payload, ctx)
    case 'terminal.kill':
      return handleTerminalKill(payload, ctx)
    case 'project.list':
      return handleProjectList(ctx)
    case 'project.get':
      return handleProjectGet(payload, ctx)
    case 'project.open':
      return handleProjectOpen(payload, ctx)
    case 'project.update':
      return handleProjectUpdate(payload, ctx)
    case 'project.remove':
      return handleProjectRemove(payload, ctx)
    case 'fs.listDir':
      return handleFsListDir(payload, ctx)
    case 'workspace.listDir':
      return handleWorkspaceListDir(payload, ctx)
    case 'workspace.listFiles':
      return handleWorkspaceListFiles(payload, ctx)
    case 'workspace.listSkills':
      return handleWorkspaceListSkills(payload, ctx)
    case 'workspace.readFile':
      return handleWorkspaceReadFile(payload, ctx)
    case 'workspace.writeFile':
      return handleWorkspaceWriteFile(payload, ctx)
    case 'workspace.rename':
      return handleWorkspaceRename(payload, ctx)
    case 'workspace.move':
      return handleWorkspaceMove(payload, ctx)
    case 'workspace.delete':
      return handleWorkspaceDelete(payload, ctx)
    case 'workspace.mkdir':
      return handleWorkspaceMkdir(payload, ctx)
    case 'workspace.search':
      return handleWorkspaceSearch(payload, ctx)
    case 'workspace.watchStart':
      return handleWorkspaceWatchStart(payload, ctx)
    case 'workspace.watchPoll':
      return handleWorkspaceWatchPoll(payload, ctx)
    case 'workspace.watchStop':
      return handleWorkspaceWatchStop(payload, ctx)
    case 'workspace.tailWatchStart':
      return handleWorkspaceTailWatchStart(payload, ctx)
    case 'workspace.tailWatchPoll':
      return handleWorkspaceTailWatchPoll(payload, ctx)
    case 'workspace.tailWatchStop':
      return handleWorkspaceTailWatchStop(payload, ctx)
    case 'git.status':
      return handleGitStatus(payload, ctx)
    case 'git.diff':
      return handleGitDiff(payload, ctx)
    case 'git.branches':
      return handleGitBranches(payload, ctx)
    case 'git.switchBranch':
      return handleGitSwitchBranch(payload, ctx)
    case 'git.createBranch':
      return handleGitCreateBranch(payload, ctx)
    case 'git.worktrees':
      return handleGitWorktrees(payload, ctx)
    case 'git.mentionRefs':
      return handleGitMentionRefs(payload, ctx)
    case 'git.mentionCapabilities':
      return handleGitMentionCapabilities(payload, ctx)
    case 'git.worktreeActivate':
      return handleGitWorktreeActivate(payload, ctx)
    case 'git.fetch':
      return handleGitFetch(payload, ctx)
    case 'git.worktreeCheckedOutBranches':
      return handleGitWorktreeCheckedOutBranches(payload, ctx)
    case 'git.worktreeAssignBranch':
      return handleGitWorktreeAssignBranch(payload, ctx)
    case 'git.worktreeHandoff':
      return handleGitWorktreeHandoff(payload, ctx)
    case 'git.worktreeHandoffPreview':
      return handleGitWorktreeHandoffPreview(payload, ctx)
    case 'git.clone':
      return handleGitClone(payload, ctx)
    case 'session.create':
      return handleSessionCreate(payload, ctx)
    case 'session.setCwd':
      return handleSessionSetCwd(payload, ctx)
    case 'session.patchSettings':
      return handleSessionPatchSettings(payload, ctx)
    case 'session.fork':
      return handleSessionFork(payload, ctx)
    case 'session.get':
      return handleSessionGet(payload, ctx)
    case 'session.list':
      return handleSessionList(payload, ctx)
    case 'session.listPinned':
      return handleSessionListPinned(payload, ctx)
    case 'session.acquireControl':
      return handleSessionAcquireControl(payload, ctx)
    case 'session.renewControl':
      return handleSessionRenewControl(payload, ctx)
    case 'session.releaseControl':
      return handleSessionReleaseControl(payload, ctx)
    case 'terminal.acquireControl':
      return handleTerminalAcquireControl(payload, ctx)
    case 'terminal.renewControl':
      return handleTerminalRenewControl(payload, ctx)
    case 'terminal.releaseControl':
      return handleTerminalReleaseControl(payload, ctx)
    case 'session.send':
      return handleSessionSend(payload, ctx)
    case 'session.modUi':
      return handleSessionModUi(payload, ctx)
    case 'session.interrupt':
      return handleSessionInterrupt(payload, ctx)
    case 'session.respondPermission':
      return handleSessionRespondPermission(payload, ctx)
    case 'session.respondQuestion':
      return handleSessionRespondQuestion(payload, ctx)
    case 'session.respondPlan':
      return handleSessionRespondPlan(payload, ctx)
    case 'session.hostActionsPoll':
      return handleSessionHostActionsPoll(payload, ctx)
    case 'session.claimHostAction':
      return handleSessionClaimHostAction(payload, ctx)
    case 'session.respondHostAction':
      return handleSessionRespondHostAction(payload, ctx)
    case 'session.renewHostActionClaim':
      return handleSessionRenewHostActionClaim(payload, ctx)
    case 'session.notifyArtifactCompleted':
      return handleSessionNotifyArtifactCompleted(payload, ctx)
    case 'session.events':
      return handleSessionEvents(payload, ctx)
    case 'session.subscribe':
      return handleSessionSubscribe(payload, ctx)
    case 'session.unsubscribe':
      return handleSessionUnsubscribe(payload, ctx)
    case 'session.messages.list':
      return handleSessionMessagesList(payload, ctx)
    case 'session.load':
      return handleSessionLoad(payload, ctx)
    case 'session.snapshot':
      return handleSessionSnapshot(ctx)
    case 'session.close':
      return handleSessionClose(payload, ctx)
    case 'session.remove':
      return handleSessionRemove(payload, ctx)
    case 'session.rename':
      return handleSessionRename(payload, ctx)
    case 'session.setTags':
      return handleSessionSetTags(payload, ctx)
    case 'session.setUiFlags':
      return handleSessionSetUiFlags(payload, ctx)
    case 'collaboration.listProfiles':
      return handleCollaborationListProfiles(ctx)
    case 'collaboration.request':
      return handleCollaborationRequest(payload, ctx)
    case 'collaboration.start':
      return handleCollaborationStart(payload, ctx)
    case 'collaboration.send':
      return handleCollaborationSend(payload, ctx)
    case 'collaboration.retrieve':
      return handleCollaborationRetrieve(payload, ctx)
    case 'provider.listCredentials':
      return handleProviderListCredentials(ctx)
    case 'provider.getCredentialDecrypted':
      return handleProviderGetCredentialDecrypted(payload, ctx)
    case 'provider.createCredential':
      return handleProviderCreateCredential(payload, ctx)
    case 'provider.updateCredential':
      return handleProviderUpdateCredential(payload, ctx)
    case 'provider.deleteCredential':
      return handleProviderDeleteCredential(payload, ctx)
    case 'provider.listBindings':
      return handleProviderListBindings(ctx)
    case 'provider.setBinding':
      return handleProviderSetBinding(payload, ctx)
    case 'provider.clearBinding':
      return handleProviderClearBinding(payload, ctx)
    case 'provider.listCustomPlatforms':
      return handleProviderListCustomPlatforms(ctx)
    case 'provider.upsertCustomPlatform':
      return handleProviderUpsertCustomPlatform(payload, ctx)
    case 'provider.deleteCustomPlatform':
      return handleProviderDeleteCustomPlatform(payload, ctx)
    case 'provider.exportBundle':
      return handleProviderExportBundle(ctx)
    case 'provider.importBundle':
      return handleProviderImportBundle(payload, ctx)
    case 'provider.listModels':
      return handleProviderListModels(payload, ctx)
    default:
      return { error: { code: 'not_found', message: `unknown method: ${method}` } }
  }
}

function handleProviderListCredentials(ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  return { result: ctx.providers.listCredentials() }
}

function handleProviderGetCredentialDecrypted(payload: unknown, ctx: RpcContext): RpcResult {
  // Secrets leave the node only for authenticated admin (desktop model list / turn env).
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const cred = ctx.providers.getCredentialDecrypted(String(p.id ?? ''))
  if (!cred) return { error: { code: 'not_found', message: 'credential not found' } }
  return { result: cred }
}

function handleProviderCreateCredential(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.providers.createCredential({
        id: typeof p.id === 'string' ? p.id : undefined,
        platformId: String(p.platformId ?? ''),
        planId: String(p.planId ?? ''),
        name: String(p.name ?? ''),
        secret: typeof p.secret === 'string' ? p.secret : undefined,
        secretEnv: typeof p.secretEnv === 'string' ? p.secretEnv : undefined,
        baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : undefined,
        overrides: p.overrides && typeof p.overrides === 'object' ? (p.overrides as never) : undefined,
        endpoints: Array.isArray(p.endpoints) ? (p.endpoints as never) : undefined,
        notes: typeof p.notes === 'string' ? p.notes : undefined,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleProviderUpdateCredential(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const id = String(p.id ?? '')
  const updated = ctx.providers.updateCredential(id, {
    name: typeof p.name === 'string' ? p.name : undefined,
    secret: typeof p.secret === 'string' ? p.secret : undefined,
    secretEnv: typeof p.secretEnv === 'string' ? p.secretEnv : undefined,
    baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : undefined,
    overrides: p.overrides && typeof p.overrides === 'object' ? (p.overrides as never) : undefined,
    endpoints: p.endpoints === null ? null : Array.isArray(p.endpoints) ? (p.endpoints as never) : undefined,
    notes: typeof p.notes === 'string' ? p.notes : undefined,
    sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : undefined,
  })
  if (!updated) return { error: { code: 'not_found', message: 'credential not found' } }
  return { result: updated }
}

function handleProviderDeleteCredential(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const ok = ctx.providers.deleteCredential(String(p.id ?? ''))
  if (!ok) return { error: { code: 'not_found', message: 'credential not found' } }
  return { result: { ok: true } }
}

function handleProviderListBindings(ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  return { result: ctx.providers.listBindings() }
}

function handleProviderSetBinding(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const binding = p as unknown as ConsumerBinding
  if (!binding.consumer || !binding.credentialId) {
    return { error: { code: 'invalid_argument', message: 'consumer and credentialId required' } }
  }
  ctx.providers.setBinding(binding)
  return { result: { ok: true } }
}

function handleProviderClearBinding(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  ctx.providers.clearBinding(String(p.consumer ?? '') as ConsumerId)
  return { result: { ok: true } }
}

function handleProviderListCustomPlatforms(ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  return { result: ctx.providers.listCustomPlatforms() }
}

function handleProviderUpsertCustomPlatform(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const def = asRecord(payload) as unknown as Platform
  if (!def?.id) return { error: { code: 'invalid_argument', message: 'platform id required' } }
  return { result: ctx.providers.upsertCustomPlatform(def) }
}

function handleProviderDeleteCustomPlatform(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const ok = ctx.providers.deleteCustomPlatform(String(p.id ?? ''))
  if (!ok) return { error: { code: 'not_found', message: 'custom platform not found' } }
  return { result: { ok: true } }
}

function handleProviderExportBundle(ctx: RpcContext): RpcResult {
  // Secrets leave the node only for authenticated admin (desktop pull).
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  return { result: ctx.providers.exportBundle() }
}

function handleProviderListModels(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const p = asRecord(payload)
  const harness = String(p.harness ?? p.harnessId ?? 'claude')
  const apiProviderId =
    typeof p.apiProviderId === 'string' && p.apiProviderId.trim() ? p.apiProviderId.trim() : null
  return {
    result: ctx.hooks.listHarnessModels(ctx.providers, harness, apiProviderId, {
      experimentalClaudeOpenAiChatEnabled:
        loadNodeAgentSettings(ctx.settingsConfigPath).experimentalClaudeOpenAiChatEnabled,
    }),
  }
}

function handleProviderImportBundle(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const bundle = p.bundle && typeof p.bundle === 'object' ? (p.bundle as never) : (p as never)
  const replaceAll = p.replaceAll === true
  try {
    return { result: ctx.providers.importBundle(bundle, { replaceAll }) }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleDescriptor(ctx: HostRpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  // Advertise enabled + ready catalog entries plus directly runnable bundled/
  // binary overrides. Simulated test mode pre-marks the catalog ready.
  const harnessIds = ctx.harnesses ? [...ctx.harnesses.readySessionHarnessIds()] : []
  if (ctx.harnesses && ctx.hooks.isCodexBinaryOverrideRunnable() && !harnessIds.includes('codex')) {
    harnessIds.push('codex')
  }
  if (ctx.harnesses && ctx.hooks.isClaudeBinaryOverrideRunnable() && !harnessIds.includes('claude')) {
    harnessIds.push('claude')
  }
  let cliVersion: string | undefined
  try {
    cliVersion = ctx.hooks.resolveReleaseVersion()
  } catch {
    cliVersion = process.env.SUPERONE_CLI_VERSION?.trim() || undefined
  }

  const descriptor: ExecutionEnvironmentDescriptor = {
    environmentId: ctx.identity.environmentId,
    label: ctx.identity.label,
    platform: { os: mapOs(), arch: arch() },
    nodeVersion: process.version,
    cliVersion,
    protocolVersion: PROTOCOL_GENERATION.current,
    // Host policy flags plus the families whose ports this host provides.
    capabilities: {
      ...ctx.capabilities,
      harnessIds,
      sessions: serves(ctx, 'session.get'),
      terminal: serves(ctx, 'terminal.create'),
      workspaceFs: serves(ctx, 'workspace.readFile'),
      git: serves(ctx, 'git.status'),
      worktrees: serves(ctx, 'git.worktrees'),
      collaboration: serves(ctx, 'collaboration.send'),
      syncZone: !!ctx.artifacts,
    },
    generations: {
      protocol: { ...PROTOCOL_GENERATION },
      databaseSchema: { ...DATABASE_SCHEMA_GENERATION },
    },
    nodePublicKeyFingerprint: ctx.identity.publicKeyFingerprint,
    ...(ctx.artifacts ? { syncRoot: ctx.artifacts.syncRoot } : {}),
    machine: await getMachineInfo(),
  }
  return { result: descriptor }
}

function handleHarnessList(ctx: RpcContext): RpcResult {
  // Administrative catalog (§13.6). Until a dedicated harness:read scope exists,
  // require node:admin — not ordinary environment:read.
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  // Secrets never appear on HarnessInstallationStatus (redacted at manager boundary).
  return { result: ctx.harnesses.list() }
}

function handleHarnessShow(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const id = typeof p.harnessId === 'string' ? p.harnessId : typeof p.id === 'string' ? p.id : ''
  if (!isNodeHarnessId(id)) {
    return { error: { code: 'invalid_argument', message: `unknown harnessId: ${id}` } }
  }
  // Stage 1: same contract as list entry; show details (last probe, install path)
  // land with the CLI surface in the next slice.
  return { result: ctx.harnesses.get(id) }
}

/** Probe harness runtime/auth and promote needs_auth → ready when satisfied. */
function handleHarnessProbe(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const id = typeof p.harnessId === 'string' ? p.harnessId : typeof p.id === 'string' ? p.id : ''
  if (!isNodeHarnessId(id)) {
    return { error: { code: 'invalid_argument', message: `unknown harnessId: ${id}` } }
  }
  try {
    const result = ctx.hooks.probeHarnessReadiness(ctx.harnesses, id, ctx.providers ?? null)
    return { result: { ...result, status: ctx.harnesses.get(id) } }
  } catch (err) {
    return mapThrown(err)
  }
}

/** Enable a harness (desktop product path — auto SDK/host binary or offline artifact). */
async function handleHarnessEnable(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const id = typeof p.harnessId === 'string' ? p.harnessId : typeof p.id === 'string' ? p.id : ''
  if (!isNodeHarnessId(id)) {
    return { error: { code: 'invalid_argument', message: `unknown harnessId: ${id}` } }
  }
  try {
    const args = Array.isArray(p.args)
      ? p.args.filter((a): a is string => typeof a === 'string')
      : undefined
    const status = await ctx.hooks.enableHarness(
      ctx.harnesses,
      {
        harnessId: id,
        artifactPath: typeof p.artifactPath === 'string' ? p.artifactPath : undefined,
        command: typeof p.command === 'string' ? p.command : undefined,
        serverUrl: typeof p.serverUrl === 'string' ? p.serverUrl : undefined,
        args,
      },
      ctx.providers ?? null,
    )
    return { result: status }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleHarnessDisable(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const id = typeof p.harnessId === 'string' ? p.harnessId : typeof p.id === 'string' ? p.id : ''
  if (!isNodeHarnessId(id)) {
    return { error: { code: 'invalid_argument', message: `unknown harnessId: ${id}` } }
  }
  try {
    return { result: ctx.hooks.disableHarness(ctx.harnesses, id) }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleHealth(ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  return {
    result: {
      ok: true,
      environmentId: ctx.identity.environmentId,
      uptimeMs: Date.now() - ctx.startedAt,
      processUptimeSec: uptime(),
    },
  }
}

/** Free memory for scheduling (`environment_get_info`). */
function handleStatus(ctx: HostRpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  return { result: readLiveStatus() }
}

async function handleUsage(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const accounts = await readSubscriptionUsage({
    claudeAccounts: await ctx.subscriptionUsage?.claudeAccounts?.(),
    force: (payload as { force?: unknown } | null)?.force === true,
    log: ctx.subscriptionUsage?.log,
  })
  return { result: { accounts } satisfies EnvironmentUsageReport }
}

async function handleSystemInfo(ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const sandbox = await probeSandboxRpc()
  return {
    result: {
      environmentId: ctx.identity.environmentId,
      hostname: hostname(),
      platform: mapOs(),
      arch: arch(),
      nodeVersion: process.version,
      cpus: cpus().length,
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      bindingHash: ctx.identity.bindingHash,
      sandbox: {
        ok: sandbox.ok,
        supportLevel: sandbox.supportLevel,
        platform: sandbox.platform,
        defaultMode: sandbox.defaultMode,
        bwrap: sandbox.bwrap,
        socat: sandbox.socat,
        missing: sandbox.missing,
        ...(sandbox.installHint ? { installHint: sandbox.installHint } : {}),
        ...(sandbox.unsupportedReason
          ? { unsupportedReason: sandbox.unsupportedReason }
          : {}),
      },
    },
  }
}

function handleSettingsGet(ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  try {
    const settings = loadNodeAgentSettings(ctx.settingsConfigPath)
    return { result: { settings } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSettingsPatch(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const rawPatch = p.patch && typeof p.patch === 'object' ? p.patch : p
  try {
    const settings = patchNodeAgentSettings(
      ctx.settingsConfigPath,
      rawPatch as NodeAgentSettingsPatch,
    )
    return { result: { settings } }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleSandboxProbe(ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  try {
    return { result: await probeSandboxRpc() }
  } catch (err) {
    return mapThrown(err)
  }
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

function handleTerminalCreate(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  const cwd = typeof p.cwd === 'string' ? p.cwd : process.cwd()
  try {
    const info = ctx.terminals.create({
      cwd,
      title: typeof p.title === 'string' ? p.title : undefined,
      cols: typeof p.cols === 'number' ? p.cols : undefined,
      rows: typeof p.rows === 'number' ? p.rows : undefined,
    })
    return {
      result: {
        terminalId: info.terminalId,
        cwd: info.cwd,
        title: info.title,
        cols: info.cols,
        rows: info.rows,
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalAttach(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  const terminalId = String(p.terminalId ?? '')
  try {
    const attached = ctx.terminals.attach(terminalId)
    return { result: attached }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalRead(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.terminals.readAfter(
        String(p.terminalId ?? ''),
        typeof p.afterSequence === 'string' ? p.afterSequence : '0',
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function requireTerminalLease(payload: Record<string, unknown>, ctx: RpcContext, terminalId: string): RpcResult | null {
  try {
    ctx.leases.assertValid({
      resource: { environmentId: ctx.identity.environmentId, terminalId },
      leaseId: String(payload.leaseId ?? ''),
      generation: String(payload.generation ?? ''),
      holderClientId: ctx.client.clientSessionId,
    })
    return null
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalWrite(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  const terminalId = String(p.terminalId ?? '')
  const leaseErr = requireTerminalLease(p, ctx, terminalId)
  if (leaseErr) return leaseErr
  const data = String(p.data ?? '')
  if (data.length > 64 * 1024) {
    return { error: { code: 'invalid_argument', message: 'terminal write payload too large' } }
  }
  try {
    ctx.terminals.write(terminalId, data)
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalResize(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  const terminalId = String(p.terminalId ?? '')
  const leaseErr = requireTerminalLease(p, ctx, terminalId)
  if (leaseErr) return leaseErr
  const cols = Number(p.cols ?? 80)
  const rows = Number(p.rows ?? 24)
  try {
    ctx.terminals.resize(terminalId, cols, rows)
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalKill(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  const terminalId = String(p.terminalId ?? '')
  const leaseErr = requireTerminalLease(p, ctx, terminalId)
  if (leaseErr) return leaseErr
  try {
    ctx.terminals.kill(terminalId)
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalAcquireControl(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  const terminalId = String(p.terminalId ?? '')
  try {
    return {
      result: ctx.leases.acquire({
        resource: { environmentId: ctx.identity.environmentId, terminalId },
        holderClientId: ctx.client.clientSessionId,
        ttlMs: typeof p.ttlMs === 'number' ? p.ttlMs : undefined,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalRenewControl(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.leases.renew({
        leaseId: String(p.leaseId ?? ''),
        generation: String(p.generation ?? ''),
        holderClientId: ctx.client.clientSessionId,
        ttlMs: typeof p.ttlMs === 'number' ? p.ttlMs : undefined,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalReleaseControl(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    ctx.leases.release(
      String(p.leaseId ?? ''),
      String(p.generation ?? ''),
      ctx.client.clientSessionId,
    )
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

function mapThrown(err: unknown): RpcResult {
  const e = err as { code?: string; message?: string; details?: Record<string, unknown> }
  const code = (e.code as RpcErrorCode | undefined) ?? 'internal'
  return {
    error: { code, message: e.message || 'internal error', ...(e.details ? { details: e.details } : {}) },
  }
}

function handleProjectList(ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readProject)
  if (denied) return denied
  return { result: ctx.projects.list() }
}

function handleProjectGet(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readProject)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = String(p.projectId ?? '')
  return { result: ctx.projects.get(projectId) }
}

/**
 * Normalize a host path on **this node**:
 * - `~` / `~/…` → this principal's home (desktop must not expand remote `~`)
 * - relative (`./…`, `../…`, bare segment) → absolute via `path.resolve` against
 *   the node process cwd (shell-style)
 * - absolute paths stay absolute
 */
function expandHostPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return trimmed
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return pathResolve(pathJoin(homedir(), trimmed.slice(2)))
  }
  // Relative and absolute both become a single absolute form the FS can use.
  return pathResolve(trimmed)
}

function handleProjectOpen(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.manageProject)
  if (denied) return denied
  const p = asRecord(payload)
  const path = expandHostPath(String(p.path ?? ''))
  if (!path) {
    return { error: { code: 'invalid_argument', message: 'path is required' } }
  }
  const name = typeof p.name === 'string' ? p.name : undefined
  try {
    // "Create & Add" in the desktop dialog: the user picked a path that does
    // not exist yet and asked for it to be created on this host.
    if (p.createIfMissing === true && !existsSync(path)) {
      mkdirSync(path, { recursive: true })
    }
    return { result: ctx.projects.open(path, name) }
  } catch (err) {
    return mapThrown(err)
  }
}

/** Edit Project: rename and/or set the project's workspace folders. */
function handleProjectUpdate(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.manageProject)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = typeof p.projectId === 'string' && p.projectId ? p.projectId : undefined
  const pathRaw = typeof p.path === 'string' && p.path ? expandHostPath(p.path) : undefined
  if (!projectId && !pathRaw) {
    return { error: { code: 'invalid_argument', message: 'projectId or path is required' } }
  }
  const name = typeof p.name === 'string' ? p.name : undefined
  const hostDirs = (raw: unknown): string[] | undefined =>
    Array.isArray(raw)
      ? raw
          .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
          .map((d) => expandHostPath(d.trim()))
      : undefined
  try {
    const updated = ctx.projects.update({
      projectId,
      path: pathRaw,
      name,
      extraDirs: hostDirs(p.extraDirs),
      addExtraDirs: hostDirs(p.addExtraDirs),
      removeExtraDirs: hostDirs(p.removeExtraDirs),
    })
    if (!updated) {
      return { error: { code: 'not_found', message: 'project not found' } }
    }
    return { result: updated }
  } catch (err) {
    return mapThrown(err)
  }
}

/** Unregister a project on this node (sidebar remove — does not delete disk). */
function handleProjectRemove(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.manageProject)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = typeof p.projectId === 'string' && p.projectId ? p.projectId : undefined
  const pathRaw = typeof p.path === 'string' && p.path ? expandHostPath(p.path) : undefined
  if (!projectId && !pathRaw) {
    return { error: { code: 'invalid_argument', message: 'projectId or path is required' } }
  }
  try {
    const removed = ctx.projects.remove({ projectId, path: pathRaw })
    if (!removed) {
      return { error: { code: 'not_found', message: 'project not found' } }
    }
    return { result: removed }
  } catch (err) {
    return mapThrown(err)
  }
}

/** List a host directory for the add-project browser (`/…`, `~/…`, `./…`, …). */
function handleFsListDir(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  const raw = String(p.path ?? '')
  if (!raw || raw.includes('\0')) {
    return { error: { code: 'invalid_argument', message: 'path is required' } }
  }
  try {
    const resolved = expandHostPath(raw)
    if (!existsSync(resolved)) {
      return { error: { code: 'not_found', message: 'path not found' } }
    }
    if (!statSync(resolved).isDirectory()) {
      return { error: { code: 'invalid_argument', message: 'not a directory' } }
    }
    const entries = readdirSync(resolved, { withFileTypes: true })
      .filter((ent) => ent.isDirectory() && !ent.name.startsWith('.'))
      .map((ent) => ({
        name: ent.name,
        path: pathJoin(resolved, ent.name),
        type: 'directory' as const,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { result: { path: resolved, entries } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceListDir(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceFs.listDir(String(p.projectId ?? ''), String(p.relativePath ?? '.')),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceListFiles(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: {
        files: ctx.workspaceFs.listFiles(String(p.projectId ?? ''), {
          relativePath: typeof p.relativePath === 'string' ? p.relativePath : undefined,
          maxDepth: typeof p.maxDepth === 'number' ? p.maxDepth : undefined,
          maxFiles: typeof p.maxFiles === 'number' ? p.maxFiles : undefined,
        }),
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceListSkills(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceFs.listSkillsAndCommands(String(p.projectId ?? '')),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceReadFile(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceFs.readFile(String(p.projectId ?? ''), String(p.relativePath ?? ''), {
        offset: typeof p.offset === 'number' ? p.offset : undefined,
        limit: typeof p.limit === 'number' ? p.limit : undefined,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceWriteFile(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  const raw = typeof p.content === 'string' ? p.content : String(p.content ?? '')
  const encoding = p.encoding === 'base64' ? 'base64' : 'utf8'
  let content: string | Buffer = raw
  if (encoding === 'base64') {
    // Buffer.from is permissive; reject non-alphabet / bad padding first.
    if (raw.length > 0 && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) {
      return { error: { code: 'invalid_argument', message: 'invalid base64 content' } }
    }
    content = Buffer.from(raw, 'base64')
  }
  const bytes = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, 'utf8')
  if (bytes > 10 * 1024 * 1024) {
    return { error: { code: 'invalid_argument', message: 'write payload exceeds 10 MiB' } }
  }
  try {
    return {
      result: ctx.workspaceFs.writeFile(
        String(p.projectId ?? ''),
        String(p.relativePath ?? ''),
        content,
        typeof p.expectedHash === 'string' ? p.expectedHash : undefined,
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceSearch(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceFs.search(
        String(p.projectId ?? ''),
        String(p.query ?? ''),
        typeof p.relativePath === 'string' ? p.relativePath : undefined,
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceRename(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceFs.rename(
        String(p.projectId ?? ''),
        String(p.relativePath ?? ''),
        String(p.newName ?? ''),
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceMove(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceFs.move(
        String(p.projectId ?? ''),
        String(p.fromPath ?? p.srcRelativePath ?? ''),
        String(p.destDirPath ?? p.destDirRelativePath ?? '.'),
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceDelete(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceFs.delete(
        String(p.projectId ?? ''),
        String(p.relativePath ?? ''),
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceMkdir(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceFs.mkdir(
        String(p.projectId ?? ''),
        String(p.relativePath ?? ''),
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceWatchStart(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const events: Array<{ path: string; type: string }> = []
    const { watchId, cancel } = ctx.workspaceWatch.subscribe(
      String(p.projectId ?? ''),
      String(p.relativePath ?? '.'),
      (ev) => {
        events.push(ev)
        if (events.length > 500) events.shift()
      },
      ctx.client.clientSessionId,
    )
    watchBuffers.set(watchId, { events, cancel, owner: ctx.client.clientSessionId })
    return { result: { watchId } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceWatchPoll(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  const watchId = String(p.watchId ?? '')
  const buf = watchBuffers.get(watchId)
  if (!buf || buf.owner !== ctx.client.clientSessionId) {
    return { error: { code: 'not_found', message: 'watch not found' } }
  }
  const events = buf.events.splice(0, buf.events.length)
  return { result: { events } }
}

function handleWorkspaceWatchStop(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  const watchId = String(p.watchId ?? '')
  const buf = watchBuffers.get(watchId)
  if (buf && buf.owner === ctx.client.clientSessionId) {
    buf.cancel()
    watchBuffers.delete(watchId)
  }
  return { result: { ok: true } }
}

function handleWorkspaceTailWatchStart(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const offset = typeof p.offset === 'number' ? p.offset : undefined
    const absolutePath = typeof p.absolutePath === 'string' ? p.absolutePath : undefined
    return {
      result: ctx.workspaceTailWatch.start(String(p.projectId ?? ''), String(p.relativePath ?? ''), {
        offset,
        ownerClientId: ctx.client.clientSessionId,
        ...(absolutePath ? { absolutePath } : {}),
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceTailWatchPoll(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceTailWatch.poll(String(p.watchId ?? ''), ctx.client.clientSessionId),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleWorkspaceTailWatchStop(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceTailWatch.stop(String(p.watchId ?? ''), ctx.client.clientSessionId),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGitStatus(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = typeof p.cwd === 'string' ? p.cwd : null
    return {
      result: cwd
        ? ctx.workspaceGit.statusAt(projectId, cwd)
        : ctx.workspaceGit.status(projectId),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGitDiff(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceGit.diff(String(p.projectId ?? ''), {
        staged: p.staged === true,
        path: typeof p.path === 'string' ? p.path : undefined,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGitBranches(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceGit.branches(
        String(p.projectId ?? ''),
        typeof p.cwd === 'string' ? p.cwd : null,
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGitSwitchBranch(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceGit.switchBranch(String(p.projectId ?? ''), String(p.branch ?? ''), {
        create: false,
        absolutePath: typeof p.cwd === 'string' ? p.cwd : null,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGitCreateBranch(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceGit.switchBranch(String(p.projectId ?? ''), String(p.branch ?? ''), {
        create: true,
        absolutePath: typeof p.cwd === 'string' ? p.cwd : null,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleGitMentionCapabilities(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: await ctx.workspaceGit.mentionCapabilities(
        String(p.projectId ?? ''),
        typeof p.cwd === 'string' ? p.cwd : null,
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleGitMentionRefs(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  if (!isGitMentionRefKind(p.kind)) {
    return { error: { code: 'invalid_argument', message: 'kind must be branch | commit | worktree | tag | issue | pr' } }
  }
  try {
    return {
      result: await ctx.workspaceGit.mentionRefs(
        String(p.projectId ?? ''),
        p.kind,
        typeof p.query === 'string' ? p.query : '',
        typeof p.cwd === 'string' ? p.cwd : null,
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGitWorktrees(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return { result: ctx.workspaceGit.worktrees(String(p.projectId ?? '')) }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleGitFetch(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  const remote = typeof p.remote === 'string' && p.remote.trim() ? p.remote.trim() : 'origin'
  if (!isGitRemoteName(remote)) return { error: { code: 'invalid_argument', message: 'invalid remote name' } }
  try {
    await ctx.workspaceGit.fetch(String(p.projectId ?? ''), remote)
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleGitWorktreeActivate(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  const mode = p.mode === 'attach' || p.mode === 'detach' || p.mode === 'branch' ? p.mode : null
  if (!mode) {
    return { error: { code: 'invalid_argument', message: 'mode must be branch|attach|detach' } }
  }
  try {
    return {
      result: await ctx.workspaceGit.activateWorktree(String(p.projectId ?? ''), {
        baseBranch: String(p.baseBranch ?? ''),
        mode,
        branchName: typeof p.branchName === 'string' ? p.branchName : undefined,
        carryLocalChanges: p.carryLocalChanges === true,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGitWorktreeCheckedOutBranches(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return { result: { branches: ctx.workspaceGit.checkedOutBranches(String(p.projectId ?? '')) } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGitWorktreeAssignBranch(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceGit.assignBranch(
        String(p.projectId ?? ''),
        String(p.worktreePath ?? ''),
        String(p.name ?? ''),
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGitWorktreeHandoff(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceGit.handoffToMain(
        String(p.projectId ?? ''),
        String(p.worktreePath ?? ''),
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleGitWorktreeHandoffPreview(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.workspaceGit.handoffPreview(
        String(p.projectId ?? ''),
        String(p.worktreePath ?? ''),
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionSetCwd(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  const cwdRaw = p.cwd
  const cwd =
    cwdRaw === null || cwdRaw === undefined || cwdRaw === ''
      ? null
      : String(cwdRaw)
  if (!sessionId) {
    return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  }
  try {
    ctx.leases.assertValid({
      resource: { environmentId: ctx.identity.environmentId, sessionId },
      leaseId: String(p.leaseId ?? ''),
      generation: String(p.generation ?? ''),
      holderClientId: ctx.client.clientSessionId,
    })
    const session = ctx.sessions.get(sessionId)
    if (!session) {
      return { error: { code: 'not_found', message: 'session not found' } }
    }
    if (cwd !== null && !isAllowedSessionCwd(ctx, session.projectId, cwd)) {
      return { error: { code: 'invalid_argument', message: 'cwd not allowed for this project' } }
    }
    return { result: ctx.sessions.setCwd(sessionId, cwd) }
  } catch (err) {
    return mapThrown(err)
  }
}

/**
 * Patch durable per-session turn defaults (model, effort, permissionMode,
 * sandboxMode, apiProviderId). Only keys present on the payload are updated;
 * null clears a stored default. Applied as session.send fallbacks when the
 * turn omits the corresponding option — so remote chat need not re-send full
 * options every turn.
 */
function handleSessionPatchSettings(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '').trim()
  if (!sessionId) {
    return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  }
  try {
    // Always require control lease — permission/sandbox/model changes must not
    // be applied by a second client without holding the session.
    const leaseId = String(p.leaseId ?? '').trim()
    if (!leaseId) {
      return { error: { code: 'invalid_argument', message: 'leaseId required' } }
    }
    ctx.leases.assertValid({
      resource: { environmentId: ctx.identity.environmentId, sessionId },
      leaseId,
      generation: String(p.generation ?? ''),
      holderClientId: ctx.client.clientSessionId,
    })
    const settingsSrc = asRecord(p.settings ?? p)
    const patch: {
      permissionMode?: string | null
      sandboxMode?: string | null
      model?: string | null
      effort?: string | null
      apiProviderId?: string | null
    } = {}
    const take = (key: keyof typeof patch): void => {
      if (!(key in settingsSrc)) return
      const v = settingsSrc[key]
      if (v === null) {
        patch[key] = null
        return
      }
      if (typeof v === 'string') {
        patch[key] = v
      }
    }
    take('permissionMode')
    take('sandboxMode')
    take('model')
    take('effort')
    take('apiProviderId')
    return { result: ctx.sessions.patchSettings(sessionId, patch) }
  } catch (err) {
    return mapThrown(err)
  }
}

/**
 * Fork a session on this node: clone transcript into a new session, optionally
 * on a freshly activated detached worktree (mode=worktree) or same cwd (local),
 * plus harness SDK/thread fork when providerResume is present.
 */
async function handleSessionFork(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '').trim()
  if (!sessionId) {
    return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  }
  const mode = p.mode === 'local' ? 'local' : 'worktree'
  const forkFromMessageId =
    typeof p.forkFromMessageId === 'string' && p.forkFromMessageId.trim()
      ? p.forkFromMessageId.trim()
      : undefined

  const source = ctx.sessions.get(sessionId)
  if (!source) {
    return { error: { code: 'not_found', message: 'Source session not found' } }
  }

  const projectRoot = ctx.projects.get(source.projectId)?.path ?? null
  const git = optionalGit(ctx)
  let worktreePath: string | undefined
  let targetCwd: string | null = source.cwd

  try {
    if (mode === 'worktree') {
      // writeWorkspace for git worktree create
      const writeDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
      if (writeDenied) return writeDenied
      if (!git) return unsupported('session.fork (worktree)')
      const wt = await git.activateWorktree(source.projectId, {
        baseBranch: 'HEAD',
        mode: 'detach',
        carryLocalChanges: true,
      })
      worktreePath = wt.path
      targetCwd = wt.path
    }

    const effectiveCwd =
      (targetCwd && targetCwd.trim()) ||
      projectRoot ||
      process.env.SUPERONE_DEFAULT_CWD ||
      process.cwd()

    let providerResume: string | null = null
    try {
      providerResume = await ctx.hooks.forkHarnessResume({
        source,
        targetCwd: effectiveCwd,
        forkFromMessageId,
        resolveProjectPath: (projectId) => ctx.projects.get(projectId)?.path ?? null,
        harnesses: ctx.harnesses,
        providers: ctx.providers,
        nodeHome: configDirname(ctx.settingsConfigPath),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (worktreePath) {
        try {
          git?.removeWorktree(source.projectId, worktreePath)
        } catch {
          /* best-effort */
        }
      }
      return {
        result: {
          ok: false as const,
          error: `Fork transcript failed: ${message}`,
        },
      }
    }

    const forked = ctx.sessions.fork({
      sourceSessionId: sessionId,
      cwd: targetCwd,
      forkFromMessageId,
      providerResume,
    })
    return {
      result: {
        ok: true as const,
        sessionId: forked.sessionId,
        worktreePath,
        session: forked,
      },
    }
  } catch (err) {
    if (worktreePath) {
      try {
        git?.removeWorktree(source.projectId, worktreePath)
      } catch {
        /* best-effort cleanup */
      }
    }
    // Map known failed_precondition messages to ok:false for desktop toast parity
    const message = err instanceof Error ? err.message : String(err)
    const code = (err as { code?: string })?.code
    if (code === 'failed_precondition' || code === 'not_found') {
      return { result: { ok: false as const, error: message } }
    }
    return mapThrown(err)
  }
}

/**
 * Clone a remote repository onto this host and register it as a project, so
 * the desktop add-project dialog gets back a ready-to-open ProjectSnapshot.
 */
/**
 * A clone whose folder already exists: reuse it when it is a checkout of the
 * same origin (a clone that was never registered or was removed from the
 * list), otherwise clone beside it under the first free `<name>-<n>`.
 */
function existingCloneTarget(input: CloneRepositoryInput): {
  reuse?: { path: string; name: string }
  directoryName?: string
} {
  const destination = resolveCloneDestination(input)
  if (!existsSync(destination.path)) return { directoryName: input.directoryName }
  const wanted = normalizeGitRemoteUrl(input.remoteUrl)
  if (wanted && repoIdentityRemote(detectRepoIdentity(destination.path)) === wanted) return { reuse: destination }
  for (let n = 2; ; n++) {
    const directoryName = `${destination.name}-${n}`
    if (!existsSync(pathJoin(configDirname(destination.path), directoryName))) return { directoryName }
  }
}

async function handleGitClone(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.manageProject)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    // Without a parent the clone goes to this node's projects directory.
    const parentPath = typeof p.parentPath === 'string' && p.parentPath.trim()
      ? p.parentPath
      : nodeProjectsDir(loadNodeAgentSettings(ctx.settingsConfigPath))
    const input = {
      remoteUrl: String(p.remoteUrl ?? ''),
      parentPath: expandHostPath(parentPath),
      directoryName: typeof p.directoryName === 'string' ? p.directoryName : undefined,
      shallow: p.shallow === true,
    }
    if (p.ifExists === 'reuse-or-rename') {
      const existing = existingCloneTarget(input)
      // `reused`: the checkout predates this call, so it may lack recent commits.
      if (existing.reuse) return { result: { ...ctx.projects.open(existing.reuse.path, existing.reuse.name), reused: true } }
      input.directoryName = existing.directoryName
    }
    const cloned = await cloneRepository(input)
    return { result: ctx.projects.open(cloned.path, cloned.name) }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionCreate(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const rawHarnessId = typeof p.harnessId === 'string' ? p.harnessId : 'claude'
  // Stage 1 wire contract: normalize catalog id acp-grok → session wire acp
  // before persistence so the turn runner never sees an unknown harness id.
  const harnessId = normalizeSessionHarnessId(rawHarnessId)
  if (!harnessId) {
    return {
      error: {
        code: 'invalid_argument',
        message: `unknown harnessId: ${rawHarnessId}`,
      },
    }
  }
  // Catalog ready OR a bundled/binary runtime that can launch without catalog install.
  const catalogReady = ctx.harnesses.isSessionHarnessRunnable(harnessId)
  const codexOverride =
    harnessId === 'codex' && ctx.hooks.isCodexBinaryOverrideRunnable()
  const claudeOverride =
    harnessId === 'claude' && ctx.hooks.isClaudeBinaryOverrideRunnable()
  if (!catalogReady && !codexOverride && !claudeOverride) {
    return {
      error: {
        code: 'failed_precondition',
        message: `harness not ready: ${harnessId}`,
        details: {
          harnessId,
          requestedHarnessId: rawHarnessId,
          readyHarnessIds: ctx.harnesses.readySessionHarnessIds(),
        },
      },
    }
  }
  // Fail-closed: catalog ready must still have a real binary/runtime (no silent sim).
  // Lab overrides (claude SDK / SUPERONE_CODEX_BINARY) satisfy assertSessionHarnessRuntimeReady.
  if (!ctx.simulatedHarness) {
    const runtime = ctx.hooks.assertSessionHarnessRuntimeReady(harnessId, ctx.harnesses)
    if (!runtime.ok) {
      return {
        error: {
          code: 'failed_precondition',
          message: runtime.reason,
          details: {
            harnessId,
            requestedHarnessId: rawHarnessId,
            readyHarnessIds: ctx.harnesses.readySessionHarnessIds(),
          },
        },
      }
    }
  }
  const projectId = String(p.projectId ?? '').trim()
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId is required' } }
  }
  if (!ctx.projects.get(projectId)) {
    return { error: { code: 'not_found', message: `unknown projectId: ${projectId}` } }
  }
  // Optional working directory: the project root or one of its worktrees.
  if (p.cwd != null && typeof p.cwd !== 'string') {
    return { error: { code: 'invalid_argument', message: 'cwd must be a string' } }
  }
  const cwd = typeof p.cwd === 'string' && p.cwd.trim() ? p.cwd.trim() : null
  if (cwd !== null && (!isAbsolute(cwd) || !isAllowedSessionCwd(ctx, projectId, cwd))) {
    return { error: { code: 'invalid_argument', message: 'cwd not allowed for this project' } }
  }
  // Optional system-prompt append (e.g. a collaboration prompt for a launched child).
  if (p.systemPromptAppend != null && typeof p.systemPromptAppend !== 'string') {
    return { error: { code: 'invalid_argument', message: 'systemPromptAppend must be a string' } }
  }
  const systemPromptAppend = typeof p.systemPromptAppend === 'string' ? p.systemPromptAppend : null
  // A collaboration child launched by a session on another machine: its mailbox
  // tools go to that machine through Host Actions instead of this node's own.
  const externalParent = asRecord(p.externalParent)
  const externalParentSessionId =
    typeof externalParent.sessionId === 'string' ? externalParent.sessionId.trim() : ''
  if (p.externalParent != null && !externalParentSessionId) {
    return { error: { code: 'invalid_argument', message: 'externalParent.sessionId is required' } }
  }
  try {
    // Resolve agent defaults at create so the client can seed UI without a second round-trip.
    // Precedence: explicit create options → session_providers.config → node agent defaults.
    const agentSettings = loadNodeAgentSettings(ctx.settingsConfigPath)
    const defaults = resolveAgentTurnDefaults(agentSettings, harnessId)
    const options = asRecord(p.options)
    const providerId =
      typeof p.providerId === 'string' && p.providerId.trim() ? p.providerId.trim() : undefined
    const profile = providerId ? ctx.sessionProviders?.get(providerId) ?? null : null
    const profileSettings = profile
      ? settingsFromSessionProviderConfig(profile.config)
      : {}
    const pick = (
      fromOptions: unknown,
      fromPayload: unknown,
      fromProfile: string | undefined,
      fromDefaults: string | null | undefined,
    ): string | null => {
      if (typeof fromOptions === 'string' && fromOptions.trim()) return fromOptions.trim()
      if (typeof fromPayload === 'string' && fromPayload.trim()) return fromPayload.trim()
      if (fromProfile) return fromProfile
      return fromDefaults ?? null
    }
    const model = pick(options.model, p.model, profileSettings.model, defaults.model)
    const effort = pick(options.effort, p.effort, profileSettings.effort, defaults.effort)
    const permissionMode = pick(
      options.permissionMode,
      p.permissionMode,
      profileSettings.permissionMode,
      defaults.permissionMode,
    )
    const sandboxMode = pick(
      options.sandboxMode,
      p.sandboxMode,
      profileSettings.sandboxMode,
      defaults.sandboxMode,
    )
    // A credential id on this node; null follows the node's provider binding.
    const apiProviderId = pick(options.apiProviderId, p.apiProviderId, undefined, null)
    let session = ctx.sessions.create({
      projectId,
      harnessId,
      providerId,
      ...(apiProviderId ? { apiProviderId } : {}),
      title: typeof p.title === 'string' ? p.title : undefined,
      cwd,
      systemPromptAppend,
      ...(externalParentSessionId ? { externalParent: { sessionId: externalParentSessionId } } : {}),
      // Initial HA controller = creating client. Token refresh keeps the same
      // clientSessionId; re-pair does not — acquireControl rebinds (see above).
      controllerClientSessionId: ctx.client.clientSessionId,
    })
    // Seed durable settings from create-time options / profile / agent defaults so later
    // session.send without options reuses the same model/effort/etc.
    if (model || effort || permissionMode || sandboxMode) {
      session = ctx.sessions.patchSettings(session.sessionId, {
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(sandboxMode ? { sandboxMode } : {}),
      })
    }
    return {
      result: {
        ...session,
        defaults: {
          model,
          effort,
          permissionMode,
          sandboxMode,
          permissionPreset: defaults.permissionPreset ?? null,
          disabledSkills: defaults.disabledSkills ?? [],
        },
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionGet(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const sessionId = String(asRecord(payload).sessionId ?? '')
  const session = ctx.sessions.get(sessionId)
  const config = session?.harnessId === 'acp' ? ctx.sessionProviders?.get(session.providerId)?.config as { agentId?: string } | undefined : undefined
  return { result: session ? { ...session, ...(session.harnessId === 'acp' ? { acpAgentId: config?.agentId ?? null } : {}) } : null }
}

/**
 * Metadata-only session row. Transcript body is NOT returned — count via
 * messageCount; full messages via session.get / session.messages.list.
 * providerResume + bare providerSessionId let desktop "Copy Session ID" match
 * local (harness SDK/thread id, not the SuperOne session UUID).
 */
function mapSessionRow(s: NodeSessionRecord) {
  const providerResume = s.providerResume ?? null
  const providerSessionId = providerSessionIdFromResume(providerResume)
  return {
    sessionId: s.sessionId,
    projectId: s.projectId,
    harnessId: s.harnessId,
    providerId: s.providerId,
    title: s.title,
    status: s.status,
    messageCount: Array.isArray(s.transcript) ? s.transcript.length : 0,
    cwd: s.cwd,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    isPinned: s.isPinned,
    isHidden: s.isHidden,
    isAutomation: s.isAutomation === true,
    automationId: s.automationId ?? null,
    providerResume,
    ...(providerSessionId ? { providerSessionId } : {}),
    tags: Array.isArray(s.tags) ? s.tags : [],
  }
}

function handleSessionList(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = typeof p.projectId === 'string' ? p.projectId : undefined
  if (typeof p.limit !== 'number' || !Number.isFinite(p.limit)) {
    return { error: { code: 'invalid_argument', message: 'session.list requires finite limit' } }
  }
  if (typeof p.offset !== 'number' || !Number.isFinite(p.offset)) {
    return { error: { code: 'invalid_argument', message: 'session.list requires finite offset' } }
  }
  const limit = Math.min(Math.max(Math.floor(p.limit), 0), 500)
  const offset = Math.max(Math.floor(p.offset), 0)
  const rows = ctx.sessions.list(projectId, { limit, offset })
  return { result: rows.map(mapSessionRow) }
}

/**
 * Cross-project pinned sessions for this node — the sidebar's Pinned section.
 * Cross-project by nature, so it cannot be scoped by the per-project access
 * check `session.list` relies on; `readSession` gates the whole node instead.
 *
 * Each row carries projectPath/projectName because the client keys pinned rows
 * by project path (`remote:<connectionId>:<path>`) and has no reason to hold a
 * full project list just to resolve them.
 */
function handleSessionListPinned(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  const limit =
    typeof p.limit === 'number' && Number.isFinite(p.limit)
      ? Math.min(Math.max(Math.floor(p.limit), 0), 500)
      : 200
  // Pass no projectId so SessionRuntime spans every project; it already sorts
  // newest-first, so slicing after the filter keeps the freshest pins.
  const rows = ctx.sessions
    .list(undefined)
    .filter((s) => s.isPinned === true && s.isHidden !== true)
    .slice(0, limit)
  return {
    result: rows.map((s) => {
      const project = s.projectId ? ctx.projects.get(s.projectId) : null
      return {
        ...mapSessionRow(s),
        projectPath: project?.path ?? s.cwd ?? '',
        projectName: project?.name ?? '',
      }
    }),
  }
}

function handleSessionAcquireControl(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  if (!sessionId) {
    return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  }
  try {
    const resource = { environmentId: ctx.identity.environmentId, sessionId }
    const lease = ctx.leases.acquire({
      resource,
      holderClientId: ctx.client.clientSessionId,
      ...(typeof p.delegate === 'string' && p.delegate ? { delegate: p.delegate } : {}),
      ...(p.yields === true ? { yields: true } : {}),
      ttlMs: typeof p.ttlMs === 'number' ? p.ttlMs : undefined,
    })
    try {
      ctx.sessions.admitControl?.(sessionId, ctx.client.clientSessionId, { reclaim: p.reclaim === true })
    } catch (err) {
      // Expire rather than delete, so the next grant still bumps the generation.
      ctx.leases.revoke(resource)
      throw err
    }
    // Re-pair / client-session rotation: lease can move to a new clientSessionId while
    // sessions.controller_client_session_id stays on the revoked controller. Host Action
    // mint/poll are keyed by that field — rebind so SuperOne MCP tools work again.
    try {
      ctx.sessions.rebindHostActionController(sessionId, ctx.client.clientSessionId)
    } catch (err) {
      // Lease is valid even if the session row is missing (stale id). Do not fail acquire.
      if ((err as { code?: string }).code !== 'not_found') throw err
    }
    return { result: lease }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionRenewControl(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.leases.renew({
        leaseId: String(p.leaseId ?? ''),
        generation: String(p.generation ?? ''),
        holderClientId: ctx.client.clientSessionId,
        ttlMs: typeof p.ttlMs === 'number' ? p.ttlMs : undefined,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionReleaseControl(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    ctx.leases.release(
      String(p.leaseId ?? ''),
      String(p.generation ?? ''),
      ctx.client.clientSessionId,
    )
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionClose(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  try {
    ctx.leases.assertValid({
      resource: { environmentId: ctx.identity.environmentId, sessionId },
      leaseId: String(p.leaseId ?? ''),
      generation: String(p.generation ?? ''),
      holderClientId: ctx.client.clientSessionId,
    })
    ctx.sessions.close(sessionId)
    try {
      ctx.leases.release(
        String(p.leaseId ?? ''),
        String(p.generation ?? ''),
        ctx.client.clientSessionId,
      )
    } catch {
      /* lease may already be released */
    }
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

/** Unregister session from node registry (sidebar delete). Lease optional if already closed. */
function handleSessionRemove(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  if (!sessionId) {
    return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  }
  try {
    const existing = ctx.sessions.get(sessionId)
    if (!existing) {
      return { error: { code: 'not_found', message: 'session not found' } }
    }
    // Prefer lease when still open; allow force remove of ended sessions without lease.
    if (!existing.closed && existing.status !== 'ended') {
      ctx.leases.assertValid({
        resource: { environmentId: ctx.identity.environmentId, sessionId },
        leaseId: String(p.leaseId ?? ''),
        generation: String(p.generation ?? ''),
        holderClientId: ctx.client.clientSessionId,
      })
    }
    const removed = ctx.sessions.remove(sessionId)
    // The zone directory goes with the session (session-sync-zone.md §7); the
    // controller cannot call artifact.delete afterwards because the binding is gone.
    void ctx.artifacts?.delete(sessionId).catch(() => undefined)
    return { result: removed }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionRename(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  const title = String(p.title ?? '')
  // Default 'user' keeps sidebar / older clients locking the title; agent path passes 'agent'.
  const source = p.source === 'agent' ? 'agent' : 'user'
  if (!sessionId) {
    return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  }
  try {
    return { result: ctx.sessions.rename(sessionId, title, source) }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionSetTags(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  if (!sessionId) {
    return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  }
  const op = parseSessionTagOp({ add: p.add, remove: p.remove, set: p.set })
  if ('error' in op) {
    return { error: { code: 'invalid_argument', message: op.error } }
  }
  try {
    const session = ctx.sessions.get(sessionId)
    if (!session) {
      return { error: { code: 'not_found', message: 'session not found' } }
    }
    const next = applySessionTagOp(session.tags ?? [], op)
    if ('error' in next) {
      return { error: { code: 'failed_precondition', message: next.error } }
    }
    return { result: ctx.sessions.setTags(sessionId, next) }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionSetUiFlags(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  if (!sessionId) {
    return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  }
  try {
    return {
      result: ctx.sessions.setUiFlags(sessionId, {
        isPinned: typeof p.isPinned === 'boolean' ? p.isPinned : undefined,
        isHidden: typeof p.isHidden === 'boolean' ? p.isHidden : undefined,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

/** The resolved node path of an attachment original inside `sessionId`'s zone, or null. */
function attachmentOriginal(zone: ArtifactZonePort | undefined, sessionId: string, path: unknown): string | null {
  if (!zone) return null
  const prefix = pathJoin(zone.syncRoot, sessionId) + sep
  if (typeof path !== 'string' || !path.startsWith(prefix)) return null
  try {
    const resolved = zone.resolve(sessionId, path.slice(prefix.length).split(sep).join('/'))
    return statSync(resolved).isFile() ? resolved : null
  } catch {
    return null
  }
}

async function handleSessionSend(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const options = asRecord(p.options)
    const modelFromOptions =
      typeof options.model === 'string' && options.model.trim() ? options.model.trim() : null
    const modelTopLevel =
      typeof p.model === 'string' && p.model.trim() ? p.model.trim() : null
    const apiProviderId =
      typeof options.apiProviderId === 'string' && options.apiProviderId.trim()
        ? options.apiProviderId.trim()
        : typeof p.apiProviderId === 'string' && p.apiProviderId.trim()
          ? p.apiProviderId.trim()
          : null
    const effortFromClient =
      typeof options.effort === 'string' && options.effort.trim()
        ? options.effort.trim()
        : typeof p.effort === 'string' && p.effort.trim()
          ? p.effort.trim()
          : null
    const permissionModeFromClient =
      typeof options.permissionMode === 'string' && options.permissionMode.trim()
        ? options.permissionMode.trim()
        : typeof p.permissionMode === 'string' && p.permissionMode.trim()
          ? p.permissionMode.trim()
          : null
    const sandboxModeFromClient =
      typeof options.sandboxMode === 'string' && options.sandboxMode.trim()
        ? options.sandboxMode.trim()
        : typeof p.sandboxMode === 'string' && p.sandboxMode.trim()
          ? p.sandboxMode.trim()
          : null
    const rawAdditionalDirs = Array.isArray(options.additionalDirectories)
      ? options.additionalDirectories
      : Array.isArray(p.additionalDirectories)
        ? p.additionalDirectories
        : []
    const clientAdditionalDirectories = rawAdditionalDirs
      .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
      .map((d) => d.trim())
    const rawEnabledSkills = Array.isArray(options.enabledSkills)
      ? options.enabledSkills
      : Array.isArray(p.enabledSkills)
        ? p.enabledSkills
        : []
    const enabledSkills = rawEnabledSkills
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, 200)
    const rawDisabledSkills = Array.isArray(options.disabledSkills)
      ? options.disabledSkills
      : Array.isArray(p.disabledSkills)
        ? p.disabledSkills
        : null
    const disabledSkillsFromClient =
      rawDisabledSkills == null
        ? null
        : rawDisabledSkills
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .map((s) => s.trim())
            .slice(0, 200)
    const rawImages = Array.isArray(options.images)
      ? options.images
      : Array.isArray(p.images)
        ? p.images
        : []
    const images = rawImages
      .map((img) => {
        if (!img || typeof img !== 'object') return null
        const row = img as Record<string, unknown>
        const mimeType = typeof row.mimeType === 'string' ? row.mimeType : ''
        const base64 = typeof row.base64 === 'string' ? row.base64 : ''
        if (!mimeType || !base64) return null
        // Bound payload: ~4MB base64 per image (desktop also bounds uploads).
        if (base64.length > 5_500_000) return null
        return {
          mimeType,
          base64,
          ...(typeof row.name === 'string' ? { name: row.name } : {}),
          ...(typeof row.id === 'string' ? { id: row.id } : {}),
          ...(row.originalPath !== undefined ? { originalPath: row.originalPath as string } : {}),
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .slice(0, 8)
    // A full-size original arrives ahead of its message through this session's sync zone.
    for (const image of images) {
      if (image.originalPath === undefined) continue
      const original = attachmentOriginal(ctx.artifacts, String(p.sessionId ?? ''), image.originalPath)
      if (!original) return { error: { code: 'invalid_argument', message: "attachment original must be a file in this session's sync zone" } }
      image.originalPath = original
    }

    const rawTurnKind =
      typeof options.turnKind === 'string'
        ? options.turnKind.trim()
        : typeof p.turnKind === 'string'
          ? p.turnKind.trim()
          : ''
    const turnKind =
      rawTurnKind === 'run' ||
      rawTurnKind === 'steer' ||
      rawTurnKind === 'review' ||
      rawTurnKind === 'compact'
        ? rawTurnKind
        : null
    const collaborationMode =
      options.collaborationMode !== undefined
        ? options.collaborationMode
        : p.collaborationMode !== undefined
          ? p.collaborationMode
          : null
    const reviewTarget =
      options.reviewTarget !== undefined
        ? options.reviewTarget
        : p.reviewTarget !== undefined
          ? p.reviewTarget
          : undefined
    // Claude Ultracode is the client's session toggle, sent with every turn
    // like model and effort; the node keeps no durable copy.
    const ultracode = typeof options.ultracode === 'boolean' ? options.ultracode : undefined

    // Precedence: client turn options → durable session settings (patchSettings)
    // → node agent defaults. SessionRuntime also re-applies session fallbacks.
    const existing = ctx.sessions.get(String(p.sessionId ?? ''))
    const harnessId = existing?.harnessId || 'claude'
    // The node is the only place that can enforce a project's workspace folders
    // for turns the desktop never composed — mobile, CLI and node automations
    // all reach SessionRuntime.send with whatever the caller happened to pass.
    const projectExtraDirs = existing
      ? (ctx.projects.get(existing.projectId)?.extraDirs ?? [])
      : []
    const additionalDirectories = [
      ...new Set([...projectExtraDirs, ...clientAdditionalDirectories]),
    ].slice(0, MAX_TURN_ADDITIONAL_DIRS)
    const agentDefaults = resolveAgentTurnDefaults(
      loadNodeAgentSettings(ctx.settingsConfigPath),
      harnessId,
    )
    const pick = (
      client: string | null,
      sessionVal: string | null | undefined,
      agentVal: string | null | undefined,
    ): string | null => {
      if (client && client.trim()) return client.trim()
      if (typeof sessionVal === 'string' && sessionVal.trim()) return sessionVal.trim()
      if (typeof agentVal === 'string' && agentVal.trim()) return agentVal.trim()
      return null
    }
    const model = pick(
      modelFromOptions ?? modelTopLevel,
      existing?.model,
      agentDefaults.model,
    )
    const effort = pick(effortFromClient, existing?.effort, agentDefaults.effort)
    const permissionMode = pick(
      permissionModeFromClient,
      existing?.permissionMode,
      agentDefaults.permissionMode,
    )
    const sandboxMode = pick(
      sandboxModeFromClient,
      existing?.sandboxMode,
      agentDefaults.sandboxMode,
    )
    const apiProviderIdResolved = pick(
      apiProviderId,
      existing?.apiProviderId,
      null,
    )
    const disabledSkills =
      disabledSkillsFromClient ??
      (agentDefaults.disabledSkills && agentDefaults.disabledSkills.length > 0
        ? agentDefaults.disabledSkills
        : [])

    const result = await ctx.sessions.send({
      sessionId: String(p.sessionId ?? ''),
      text: String(p.text ?? ''),
      clientMessageId: typeof p.clientMessageId === 'string' ? p.clientMessageId : undefined,
      ...parseMessageDisplay(options),
      echoUserMessage: options.echoUserMessage === true,
      client: { clientSessionId: ctx.client.clientSessionId },
      leaseId: String(p.leaseId ?? ''),
      generation: String(p.generation ?? ''),
      requestId: typeof p.requestId === 'string' ? p.requestId : undefined,
      model,
      effort,
      permissionMode,
      sandboxMode,
      additionalDirectories:
        additionalDirectories.length > 0 ? additionalDirectories : undefined,
      enabledSkills: enabledSkills.length > 0 ? enabledSkills : undefined,
      disabledSkills: disabledSkills.length > 0 ? disabledSkills : undefined,
      images: images.length > 0 ? images : undefined,
      apiProviderId: apiProviderIdResolved,
      turnKind,
      collaborationMode:
        collaborationMode === null
          ? null
          : typeof collaborationMode === 'string' ||
              (collaborationMode && typeof collaborationMode === 'object')
            ? (collaborationMode as string | Record<string, unknown>)
            : undefined,
      reviewTarget,
      ultracode,
    })
    return { result }
  } catch (err) {
    return mapThrown(err)
  }
}

/**
 * A desktop or phone view's op on a session's mod surface. Drawing needs read
 * access; ops that change what a plugin sees or does need operate access and
 * the control lease (checked by the runtime).
 */
async function handleSessionModUi(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const p = asRecord(payload)
  const op = String(p.op ?? '') as ModUiOp
  const denied = requireScopes(ctx.client, MOD_UI_MUTATING_OPS.has(op) ? OPERATION_SCOPES.operateSession : OPERATION_SCOPES.readSession)
  if (denied) return denied
  try {
    const result = await ctx.sessions.modUi({
      sessionId: String(p.sessionId ?? ''),
      op,
      request: asRecord(p.request) as ModUiRequest,
      client: { clientSessionId: ctx.client.clientSessionId },
      leaseId: typeof p.leaseId === 'string' ? p.leaseId : undefined,
      generation: typeof p.generation === 'string' ? p.generation : undefined,
    })
    return { result }
  } catch (err) {
    // The name crosses the wire in the message, which is what views test for.
    if ((err as { name?: string }).name === MOD_UI_UNAVAILABLE) {
      return { error: { code: 'unavailable', message: `${MOD_UI_UNAVAILABLE}: ${(err as Error).message}` } }
    }
    return mapThrown(err)
  }
}

function handleSessionInterrupt(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    ctx.sessions.interrupt(
      String(p.sessionId ?? ''),
      { clientSessionId: ctx.client.clientSessionId },
      String(p.leaseId ?? ''),
      String(p.generation ?? ''),
    )
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionRespondPermission(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const formAnswers =
      p.formAnswers && typeof p.formAnswers === 'object' && !Array.isArray(p.formAnswers)
        ? (p.formAnswers as Record<string, unknown>)
        : p.options && typeof p.options === 'object' && !Array.isArray(p.options)
          ? ((p.options as { formAnswers?: Record<string, unknown> }).formAnswers
            ?? (p.options as Record<string, unknown>))
          : undefined
    ctx.sessions.respondPermission({
      sessionId: String(p.sessionId ?? ''),
      interactionId: String(p.interactionId ?? ''),
      decision: (p.decision as 'allow' | 'deny' | 'allow_always') || 'deny',
      client: { clientSessionId: ctx.client.clientSessionId },
      leaseId: String(p.leaseId ?? ''),
      generation: String(p.generation ?? ''),
      formAnswers,
      cancel: p.cancel === true || (p.options as { cancel?: boolean } | undefined)?.cancel === true,
    })
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionRespondQuestion(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    ctx.sessions.respondQuestion({
      sessionId: String(p.sessionId ?? ''),
      interactionId: String(p.interactionId ?? ''),
      answers: p.answers,
      client: { clientSessionId: ctx.client.clientSessionId },
      leaseId: String(p.leaseId ?? ''),
      generation: String(p.generation ?? ''),
    })
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionRespondPlan(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const decision = p.decision === 'approve' || p.decision === 'reject' ? p.decision : null
  if (!decision) {
    return { error: { code: 'invalid_argument', message: 'decision must be approve|reject' } }
  }
  try {
    ctx.sessions.respondPlan({
      sessionId: String(p.sessionId ?? ''),
      interactionId: String(p.interactionId ?? ''),
      decision,
      options:
        p.options && typeof p.options === 'object' && !Array.isArray(p.options)
          ? (p.options as Record<string, unknown>)
          : undefined,
      client: { clientSessionId: ctx.client.clientSessionId },
      leaseId: String(p.leaseId ?? ''),
      generation: String(p.generation ?? ''),
    })
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

/**
 * Controller-scoped long-poll for Host Actions (separate from session.events).
 * Never returns args — only IDs, state, version, replayPolicy.
 */
async function handleSessionHostActionsPoll(
  payload: unknown,
  ctx: RpcContext,
): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const result = await ctx.sessions.pollHostActions({
      controllerClientSessionId: ctx.client.clientSessionId,
      afterSequence:
        p.afterSequence === null || p.afterSequence === undefined
          ? null
          : String(p.afterSequence),
      waitMs: typeof p.waitMs === 'number' ? p.waitMs : undefined,
      limit: typeof p.limit === 'number' ? p.limit : undefined,
    })
    return { result }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionClaimHostAction(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const result = ctx.sessions.claimHostAction({
      actionId: String(p.actionId ?? ''),
      expectedVersion: Number(p.expectedVersion ?? -1),
      controllerClientSessionId: ctx.client.clientSessionId,
      claimTtlMs: typeof p.claimTtlMs === 'number' ? p.claimTtlMs : undefined,
    })
    return { result }
  } catch (err) {
    return mapThrown(err)
  }
}

/** Extend a live claim rather than deferring the work it is still doing (§4.1). */
function handleSessionRenewHostActionClaim(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const result = ctx.sessions.renewHostActionClaim({
      actionId: String(p.actionId ?? ''),
      claimToken: String(p.claimToken ?? ''),
      controllerClientSessionId: ctx.client.clientSessionId,
      ttlMs: typeof p.ttlMs === 'number' ? p.ttlMs : undefined,
    })
    return { result }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionRespondHostAction(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const outcome = p.outcome === 'failed' ? 'failed' : p.outcome === 'succeeded' ? 'succeeded' : null
  if (!outcome) {
    return { error: { code: 'invalid_argument', message: 'outcome must be succeeded|failed' } }
  }
  try {
    const result = ctx.sessions.respondHostAction({
      actionId: String(p.actionId ?? ''),
      claimToken: String(p.claimToken ?? ''),
      controllerClientSessionId: ctx.client.clientSessionId,
      outcome,
      result: p.result,
      error: p.error,
    })
    return { result }
  } catch (err) {
    return mapThrown(err)
  }
}

/**
 * A deferred artifact transfer landed (`docs/architecture/session-sync-zone.md` §5.3).
 *
 * The desktop names the session and the zone-relative paths; the node checks
 * each one itself and builds the wording, so this cannot become a channel for
 * injecting arbitrary text as a user turn. Controller-bound, no lease — it
 * reports work the controller already did — and idempotent by
 * `notificationId`, because the desktop retries when an ACK is lost.
 */
/** One wake names at most this many files; the rest are covered by their own jobs. */
const MAX_NOTIFIED_PATHS = 32

async function handleSessionNotifyArtifactCompleted(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  const notificationId = String(p.notificationId ?? '')
  const relativePaths = Array.isArray(p.relativePaths)
    ? p.relativePaths.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
  if (!sessionId || !notificationId || relativePaths.length === 0) {
    return { error: { code: 'invalid_argument', message: 'sessionId, notificationId and relativePaths are required' } }
  }
  const artifacts = ctx.artifacts
  if (!artifacts) return unsupported('session.notifyArtifactCompleted')
  // Authorisation first, and before touching the filesystem: otherwise
  // "delivered: false" versus "forbidden" tells a client that is not the
  // controller whether a given path exists in someone else's zone.
  const session = ctx.sessions.get(sessionId)
  if (!session) return { error: { code: 'not_found', message: 'session not found' } }
  if (session.controllerClientSessionId !== ctx.client.clientSessionId) {
    return { error: { code: 'forbidden', message: 'not the session controller' } }
  }
  // Only paths the node actually holds, named the way the node resolved them:
  // the caller's spelling never reaches the wording, so a path that normalises
  // onto a real file cannot smuggle text into the agent's turn.
  const ready: string[] = []
  for (const relativePath of relativePaths.slice(0, MAX_NOTIFIED_PATHS)) {
    try {
      const absolute = artifacts.resolve(sessionId, relativePath)
      if (artifacts.stat(sessionId, relativePath).exists) ready.push(absolute)
    } catch {
      /* an unusable path is not a file that landed */
    }
  }
  if (ready.length === 0) return { result: { delivered: false } }
  const text = [
    `<task_notification source="artifact_sync" status="completed">`,
    ready.length === 1
      ? 'A file SuperOne was transferring to this machine has finished and can now be read:'
      : 'Files SuperOne was transferring to this machine have finished and can now be read:',
    // JSON-quoted: a file name may contain anything a filesystem allows, and
    // the wording around it has to stay the node's.
    ...ready.map((path) => `- ${JSON.stringify(path)}`),
    `</task_notification>`,
  ].join('\n')
  try {
    const result = await ctx.sessions.notifyArtifactsCompleted({
      sessionId,
      controllerClientSessionId: ctx.client.clientSessionId,
      notificationId,
      text,
    })
    return { result }
  } catch (err) {
    return mapThrown(err)
  }
}

function streamFilter(p: Record<string, unknown>): EventStreamFilter {
  const strings = (value: unknown): string[] | null =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : null
  const ids = strings(p.aggregateIds)
  const types = strings(p.aggregateTypes) as EnvironmentAggregateType[] | null
  const topics = Array.isArray(p.topics) ? p.topics.map(readTopicRef).filter((topic): topic is TopicRef => topic !== null) : null
  return {
    ...(ids ? { aggregateIds: new Set(ids) } : {}),
    ...(types ? { aggregateTypes: new Set(types) } : {}),
    ...(topics ? { topics } : {}),
  }
}

function handleSessionEvents(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  const after = String(p.afterSequence ?? '0')
  const events = ctx.sessions.listEventsAfter(after, ctx.client).filter(streamFilterMatcher(streamFilter(p)))
  return { result: { events } }
}

/**
 * Push the events after `afterSequence` on this connection, then every new
 * one as it commits (`openEventStream`). Frames can precede this result, so
 * the client picks `subscriptionId`.
 */
function handleSessionSubscribe(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const streams = ctx.streams
  if (!streams) return { error: { code: 'failed_precondition', message: 'session.subscribe needs a socket connection' } }
  const p = asRecord(payload)
  const subscriptionId = String(p.subscriptionId ?? '').trim()
  const afterSequence = String(p.afterSequence ?? '').trim()
  if (!subscriptionId) return { error: { code: 'invalid_argument', message: 'subscriptionId required' } }
  if (!/^\d+$/.test(afterSequence)) return { error: { code: 'invalid_argument', message: 'afterSequence must be a decimal sequence' } }
  const versions = streamVersions(p.versions)
  if (versions === null) return { error: { code: 'invalid_argument', message: 'versions must map session ids to versions' } }
  const close = openEventStream({
    source: ctx.sessions,
    environmentId: ctx.identity.environmentId,
    reader: ctx.client,
    cursor: { afterSequence, epoch: typeof p.epoch === 'string' ? p.epoch : undefined, versions },
    filter: streamFilter(p),
    push: (frame) => streams.push({ type: 'stream', subscriptionId, frame }),
    flow: streams.flow,
  })
  streams.open(subscriptionId, close)
  return { result: { subscriptionId } }
}

/** A subscribe cursor's per-session versions, or null when malformed. */
function streamVersions(value: unknown): Record<string, number> | null {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.some(([, version]) => !Number.isSafeInteger(version) || (version as number) < 0)) return null
  return Object.fromEntries(entries) as Record<string, number>
}

/** A session's reduced state and newest messages, with the version they reflect. */
function handleSessionLoad(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '').trim()
  if (!sessionId) return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  try {
    return {
      result: ctx.sessions.load({
        sessionId,
        before: typeof p.before === 'number' ? p.before : null,
        limit: typeof p.limit === 'number' ? p.limit : undefined,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionUnsubscribe(payload: unknown, ctx: RpcContext): RpcResult {
  const subscriptionId = String(asRecord(payload).subscriptionId ?? '').trim()
  ctx.streams?.close(subscriptionId)
  return { result: { ok: true } }
}

/**
 * Paged denser message catalog (tool summaries, optional checkpoint/resume).
 * Read-only; hydrate path for remote clients that use session.events for live
 * catch-up and messages.list for historical UI.
 */
function handleSessionMessagesList(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '').trim()
  if (!sessionId) {
    return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  }
  try {
    const cursor =
      p.cursor === null || p.cursor === undefined
        ? null
        : typeof p.cursor === 'number' || typeof p.cursor === 'string'
          ? p.cursor
          : null
    const limit = typeof p.limit === 'number' ? p.limit : undefined
    return {
      result: ctx.sessions.listMessages({ sessionId, cursor, limit }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionSnapshot(ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  return {
    result: {
      environmentId: ctx.identity.environmentId,
      snapshotSequence: ctx.sessions.snapshotSequence(),
      sessions: ctx.sessions.list(),
      capturedAt: Date.now(),
    },
  }
}

function handleCollaborationListProfiles(ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  try {
    return { result: ctx.collaboration.listProfiles() }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleCollaborationRequest(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const parentSessionId = String(p.parentSessionId ?? '')
  if (!parentSessionId) {
    return { error: { code: 'invalid_argument', message: 'parentSessionId required' } }
  }
  if (!Array.isArray(p.launches)) {
    return { error: { code: 'invalid_argument', message: 'launches required' } }
  }
  const leaseId = String(p.leaseId ?? '').trim()
  if (!leaseId) {
    return { error: { code: 'invalid_argument', message: 'leaseId required' } }
  }
  try {
    ctx.leases.assertValid({
      resource: { environmentId: ctx.identity.environmentId, sessionId: parentSessionId },
      leaseId,
      generation: String(p.generation ?? ''),
      holderClientId: ctx.client.clientSessionId,
    })
    return {
      result: await ctx.collaboration.request({
        parentSessionId,
        launches: p.launches as Array<{
          launchId?: string
          agentId: string
          name: string
          role: string
          config?: Record<string, unknown>
        }>,
        // RPC path is controller-trusted; MCP tools set requireUserConfirm.
        requireUserConfirm: p.requireUserConfirm === true,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleCollaborationStart(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const launchId = typeof p.launchId === 'string' ? p.launchId.trim() : ''
  if (!launchId) {
    return { error: { code: 'invalid_argument', message: 'launchId required' } }
  }
  // The requesting session: lease fence + launchId scope.
  const callerSessionId =
    typeof p.callerSessionId === 'string' && p.callerSessionId.trim()
      ? p.callerSessionId.trim()
      : typeof p.parentSessionId === 'string' && p.parentSessionId.trim()
        ? p.parentSessionId.trim()
        : ''
  if (!callerSessionId) {
    return {
      error: {
        code: 'invalid_argument',
        message: 'callerSessionId (or parentSessionId) required',
      },
    }
  }
  const leaseId = String(p.leaseId ?? '').trim()
  if (!leaseId) {
    return { error: { code: 'invalid_argument', message: 'leaseId required' } }
  }
  try {
    ctx.leases.assertValid({
      resource: { environmentId: ctx.identity.environmentId, sessionId: callerSessionId },
      leaseId,
      generation: String(p.generation ?? ''),
      holderClientId: ctx.client.clientSessionId,
    })
  } catch (err) {
    return mapThrown(err)
  }
  try {
    return {
      result: await ctx.collaboration.start({
        launchId,
        task: typeof p.task === 'string' ? p.task : undefined,
        formAnswers:
          p.formAnswers && typeof p.formAnswers === 'object'
            ? (p.formAnswers as Record<string, unknown>)
            : undefined,
        callerSessionId,
        controllerClientSessionId: ctx.client.clientSessionId,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

/**
 * Mailbox RPCs act as the calling session: the host authorizes by the session
 * pair, so the caller must hold that session's control lease. Retrieve advances
 * the session's read cursor, so it is gated like send.
 */
function assertMailboxLease(p: Record<string, unknown>, sessionId: string, ctx: RpcContext): RpcResult | null {
  const leaseId = String(p.leaseId ?? '').trim()
  if (!leaseId) return { error: { code: 'invalid_argument', message: 'leaseId required' } }
  try {
    ctx.leases.assertValid({
      resource: { environmentId: ctx.identity.environmentId, sessionId },
      leaseId,
      generation: String(p.generation ?? ''),
      holderClientId: ctx.client.clientSessionId,
    })
    return null
  } catch (err) {
    return mapThrown(err)
  }
}

function handleCollaborationSend(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? p.fromSessionId ?? '')
  const content =
    typeof p.content === 'string'
      ? p.content
      : p.body !== undefined
        ? typeof p.body === 'string'
          ? p.body
          : JSON.stringify(p.body)
        : ''
  if (!sessionId) {
    return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  }
  const leaseDenied = assertMailboxLease(p, sessionId, ctx)
  if (leaseDenied) return leaseDenied
  try {
    return {
      result: ctx.collaboration.send({
        sessionId,
        to: typeof p.to === 'string' ? p.to : undefined,
        content,
        clientMessageId: typeof p.clientMessageId === 'string' ? p.clientMessageId : undefined,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleCollaborationRetrieve(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const sessionId = String(p.sessionId ?? '')
  if (!sessionId) {
    return { error: { code: 'invalid_argument', message: 'sessionId required' } }
  }
  const leaseDenied = assertMailboxLease(p, sessionId, ctx)
  if (leaseDenied) return leaseDenied
  try {
    return {
      result: ctx.collaboration.retrieve({
        sessionId,
        from: Array.isArray(p.from) ? p.from.filter((id): id is string => typeof id === 'string') : undefined,
        max: typeof p.max === 'number' ? p.max : undefined,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}
