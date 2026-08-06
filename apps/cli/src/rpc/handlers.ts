import {
  DATABASE_SCHEMA_GENERATION,
  PHASE1_NODE_CAPABILITIES,
  PROTOCOL_GENERATION,
  hasAllScopes,
  isNodeHarnessId,
  normalizeSessionHarnessId,
  OPERATION_SCOPES,
  type AuthScope,
  type ExecutionEnvironmentDescriptor,
  type RpcErrorCode,
} from '@superone/shared/environment'
import { isCodexBinaryOverrideRunnable } from '../session/codex-turn-runner'
import { isClaudeBinaryOverrideRunnable } from '../session/claude-turn-runner'
import { assertSessionHarnessRuntimeReady, probeHarnessReadiness } from '../session/harness-runtime-ready'
import { resolveCliReleaseVersion } from '../cli-release-version'
import { cloneRepository } from '@superone/shared/git-clone'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join as pathJoin, resolve as pathResolve } from 'node:path'
import { arch, cpus, freemem, homedir, hostname, platform, totalmem, uptime } from 'node:os'
import type { AuthenticatedClient } from '../auth/auth-service'
import type { NodeIdentity } from '../identity'
import type { NodeTerminalManager } from '../terminal/manager'
import type { ProjectRegistry } from '../workspace/project-registry'
import type { WorkspaceFsService } from '../workspace/fs-service'
import type { WorkspaceGitService } from '../workspace/git-service'
import type { SessionRuntime } from '../session/session-runtime'
import type { HarnessManager } from '../session/harness-manager'
import type { ControlLeaseService } from '../session/control-lease'
import type { EventLog } from '../session/event-log'
import type { CollaborationMailbox } from '../session/collaboration'
import type { WorkspaceWatchService } from '../workspace/watch-service'
import type { IdempotencyService } from '../auth/idempotency'
import type { ProviderStore } from '../provider/provider-store'
import { listHarnessModels } from '../provider/resolve-service'
import type { ConsumerBinding, ConsumerId, Platform } from '@superone/shared/platform-registry'
import {
  dispatchResourceRpc,
  RESOURCE_MUTATING_METHODS,
} from './resource-handlers'

export interface RpcContext {
  client: AuthenticatedClient
  identity: NodeIdentity
  terminals: NodeTerminalManager
  projects: ProjectRegistry
  workspaceFs: WorkspaceFsService
  workspaceGit: WorkspaceGitService
  workspaceWatch: WorkspaceWatchService
  sessions: SessionRuntime
  harnesses: HarnessManager
  leases: ControlLeaseService
  events: EventLog
  collaboration: CollaborationMailbox
  idempotency: IdempotencyService
  providers: ProviderStore
  startedAt: number
  simulatedHarness?: boolean
  requestId?: string
  idempotencyKey?: string
}

export interface RpcResult {
  result?: unknown
  error?: { code: RpcErrorCode; message: string; details?: Record<string, unknown> }
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

const MUTATING_METHODS = new Set([
  'terminal.create',
  'terminal.write',
  'terminal.resize',
  'terminal.kill',
  'project.open',
  'project.remove',
  'workspace.writeFile',
  'workspace.rename',
  'workspace.move',
  'workspace.delete',
  'workspace.mkdir',
  'workspace.watchStart',
  'workspace.watchStop',
  'git.clone',
  'git.switchBranch',
  'git.createBranch',
  'git.worktreeActivate',
  'git.worktreeAssignBranch',
  'git.worktreeHandoff',
  'session.create',
  'session.setCwd',
  'session.fork',
  'session.send',
  'session.interrupt',
  'session.respondPermission',
  'session.respondQuestion',
  'session.respondPlan',
  'session.claimHostAction',
  'session.respondHostAction',
  'harness.probe',
  'session.acquireControl',
  'session.renewControl',
  'session.releaseControl',
  'session.close',
  'session.remove',
  'session.rename',
  'session.setUiFlags', // pin/hide
  'terminal.acquireControl',
  'terminal.renewControl',
  'terminal.releaseControl',
  'collaboration.send',
  'provider.createCredential',
  'provider.updateCredential',
  'provider.deleteCredential',
  'provider.setBinding',
  'provider.clearBinding',
  'provider.upsertCustomPlatform',
  'provider.deleteCustomPlatform',
  'provider.importBundle',
  ...RESOURCE_MUTATING_METHODS,
])

export async function dispatchRpc(method: string, payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  if (MUTATING_METHODS.has(method)) {
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

/**
 * Session RPC is always available: the node runs an injectable turn runner
 * (multi-harness router with simulated adapters until real CLIs are wired).
 * Collaboration stays opt-in behind simulatedHarness for now.
 */
function requireCollaborationCapability(ctx: RpcContext): RpcResult | null {
  if (!ctx.simulatedHarness) {
    return {
      error: {
        code: 'failed_precondition',
        message:
          'collaboration RPC disabled: set simulatedHarness only in tests until real collab adapters exist',
      },
    }
  }
  return null
}

async function dispatchRpcInner(method: string, payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  if (method.startsWith('collaboration.')) {
    const blocked = requireCollaborationCapability(ctx)
    if (blocked) return blocked
  }

  const resource = dispatchResourceRpc(method, payload, {
    client: ctx.client,
    projects: ctx.projects,
  })
  if (resource) return resource

  switch (method) {
    case 'environment.descriptor':
      return handleDescriptor(ctx)
    case 'environment.health':
      return handleHealth(ctx)
    case 'environment.systemInfo':
      return handleSystemInfo(ctx)
    case 'harness.list':
      return handleHarnessList(ctx)
    case 'harness.show':
      return handleHarnessShow(payload, ctx)
    case 'harness.probe':
      return handleHarnessProbe(payload, ctx)
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
    case 'git.worktreeActivate':
      return handleGitWorktreeActivate(payload, ctx)
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
    case 'session.fork':
      return handleSessionFork(payload, ctx)
    case 'session.get':
      return handleSessionGet(payload, ctx)
    case 'session.list':
      return handleSessionList(payload, ctx)
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
    case 'session.events':
      return handleSessionEvents(payload, ctx)
    case 'session.snapshot':
      return handleSessionSnapshot(ctx)
    case 'session.close':
      return handleSessionClose(payload, ctx)
    case 'session.remove':
      return handleSessionRemove(payload, ctx)
    case 'session.rename':
      return handleSessionRename(payload, ctx)
    case 'session.setUiFlags':
      return handleSessionSetUiFlags(payload, ctx)
    case 'collaboration.send':
      return handleCollaborationSend(payload, ctx)
    case 'collaboration.list':
      return handleCollaborationList(payload, ctx)
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
  return { result: listHarnessModels(ctx.providers, harness, apiProviderId) }
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

function handleDescriptor(ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  // Advertise enabled + ready catalog entries plus directly runnable bundled/
  // binary overrides. Simulated test mode pre-marks the catalog ready.
  const harnessIds = [...ctx.harnesses.readySessionHarnessIds()]
  if (isCodexBinaryOverrideRunnable() && !harnessIds.includes('codex')) {
    harnessIds.push('codex')
  }
  if (isClaudeBinaryOverrideRunnable() && !harnessIds.includes('claude')) {
    harnessIds.push('claude')
  }
  let cliVersion: string | undefined
  try {
    cliVersion = resolveCliReleaseVersion()
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
    capabilities: {
      ...PHASE1_NODE_CAPABILITIES,
      harnessIds,
      sessions: true,
      workspaceFs: true,
      git: true,
      worktrees: true,
      collaboration: Boolean(ctx.simulatedHarness),
      coldSessionResume: false,
      turnReattach: false,
      hostActionV1: true,
    },
    generations: {
      protocol: { ...PROTOCOL_GENERATION },
      databaseSchema: { ...DATABASE_SCHEMA_GENERATION },
    },
    nodePublicKeyFingerprint: ctx.identity.publicKeyFingerprint,
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
    const result = probeHarnessReadiness(ctx.harnesses, id, ctx.providers ?? null)
    return { result: { ...result, status: ctx.harnesses.get(id) } }
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

function handleSystemInfo(ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
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
    },
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
  const e = err as { code?: string; message?: string }
  const code = (e.code as RpcErrorCode | undefined) ?? 'internal'
  return { error: { code, message: e.message || 'internal error' } }
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

function handleGitWorktreeActivate(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  const mode = p.mode === 'attach' || p.mode === 'detach' || p.mode === 'branch' ? p.mode : null
  if (!mode) {
    return { error: { code: 'invalid_argument', message: 'mode must be branch|attach|detach' } }
  }
  try {
    return {
      result: ctx.workspaceGit.activateWorktree(String(p.projectId ?? ''), {
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
    if (cwd !== null && !ctx.workspaceGit.isAllowedSessionCwd(session.projectId, cwd)) {
      return { error: { code: 'invalid_argument', message: 'cwd not allowed for this project' } }
    }
    return { result: ctx.sessions.setCwd(sessionId, cwd) }
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
  let worktreePath: string | undefined
  let targetCwd: string | null = source.cwd

  try {
    if (mode === 'worktree') {
      // writeWorkspace for git worktree create
      const writeDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
      if (writeDenied) return writeDenied
      const wt = ctx.workspaceGit.activateWorktree(source.projectId, {
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

    const { forkNodeHarnessResume } = await import('../session/harness-fork')
    let providerResume: string | null = null
    try {
      providerResume = await forkNodeHarnessResume(
        source,
        effectiveCwd,
        {
          resolveProjectPath: (projectId) => ctx.projects.get(projectId)?.path ?? null,
          harnesses: ctx.harnesses,
          providers: ctx.providers,
        },
        forkFromMessageId,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (worktreePath) {
        try {
          ctx.workspaceGit.removeWorktree(source.projectId, worktreePath)
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
        ctx.workspaceGit.removeWorktree(source.projectId, worktreePath)
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
async function handleGitClone(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.manageProject)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const cloned = await cloneRepository({
      remoteUrl: String(p.remoteUrl ?? ''),
      parentPath: expandHostPath(String(p.parentPath ?? '')),
      directoryName: typeof p.directoryName === 'string' ? p.directoryName : undefined,
    })
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
    harnessId === 'codex' && isCodexBinaryOverrideRunnable()
  const claudeOverride =
    harnessId === 'claude' && isClaudeBinaryOverrideRunnable()
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
    const runtime = assertSessionHarnessRuntimeReady(harnessId, ctx.harnesses)
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
  try {
    return {
      result: ctx.sessions.create({
        projectId,
        harnessId,
        providerId: typeof p.providerId === 'string' ? p.providerId : undefined,
        title: typeof p.title === 'string' ? p.title : undefined,
        // Pairing-level identity survives token refresh; control lease is a fence, not identity.
        controllerClientSessionId: ctx.client.clientSessionId,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleSessionGet(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  return { result: ctx.sessions.get(String(p.sessionId ?? '')) }
}

function handleSessionList(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  return {
    result: ctx.sessions.list(typeof p.projectId === 'string' ? p.projectId : undefined),
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
    const lease = ctx.leases.acquire({
      resource: { environmentId: ctx.identity.environmentId, sessionId },
      holderClientId: ctx.client.clientSessionId,
      ttlMs: typeof p.ttlMs === 'number' ? p.ttlMs : undefined,
    })
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
    const effort =
      typeof options.effort === 'string' && options.effort.trim()
        ? options.effort.trim()
        : typeof p.effort === 'string' && p.effort.trim()
          ? p.effort.trim()
          : null
    const permissionMode =
      typeof options.permissionMode === 'string' && options.permissionMode.trim()
        ? options.permissionMode.trim()
        : typeof p.permissionMode === 'string' && p.permissionMode.trim()
          ? p.permissionMode.trim()
          : null
    const rawAdditionalDirs = Array.isArray(options.additionalDirectories)
      ? options.additionalDirectories
      : Array.isArray(p.additionalDirectories)
        ? p.additionalDirectories
        : []
    const additionalDirectories = rawAdditionalDirs
      .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
      .map((d) => d.trim())
      .slice(0, 32)
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
        : []
    const disabledSkills = rawDisabledSkills
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
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .slice(0, 8)
    const result = await ctx.sessions.send({
      sessionId: String(p.sessionId ?? ''),
      text: String(p.text ?? ''),
      client: { clientSessionId: ctx.client.clientSessionId },
      leaseId: String(p.leaseId ?? ''),
      generation: String(p.generation ?? ''),
      requestId: typeof p.requestId === 'string' ? p.requestId : undefined,
      model: modelFromOptions ?? modelTopLevel,
      effort,
      permissionMode,
      additionalDirectories:
        additionalDirectories.length > 0 ? additionalDirectories : undefined,
      enabledSkills: enabledSkills.length > 0 ? enabledSkills : undefined,
      disabledSkills: disabledSkills.length > 0 ? disabledSkills : undefined,
      images: images.length > 0 ? images : undefined,
      apiProviderId,
    })
    return { result }
  } catch (err) {
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
    ctx.sessions.respondPermission({
      sessionId: String(p.sessionId ?? ''),
      interactionId: String(p.interactionId ?? ''),
      decision: (p.decision as 'allow' | 'deny' | 'allow_always') || 'deny',
      client: { clientSessionId: ctx.client.clientSessionId },
      leaseId: String(p.leaseId ?? ''),
      generation: String(p.generation ?? ''),
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

function handleSessionEvents(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  const after = String(p.afterSequence ?? '0')
  return { result: { events: ctx.sessions.listEventsAfter(after) } }
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

function handleCollaborationSend(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateSession)
  if (denied) return denied
  const p = asRecord(payload)
  const fromSessionId = String(p.fromSessionId ?? '')
  const session = ctx.sessions.get(fromSessionId)
  if (!session) {
    return { error: { code: 'not_found', message: 'fromSessionId not found' } }
  }
  try {
    // Require control lease on the sending session so messages cannot be spoofed.
    ctx.leases.assertValid({
      resource: { environmentId: ctx.identity.environmentId, sessionId: fromSessionId },
      leaseId: String(p.leaseId ?? ''),
      generation: String(p.generation ?? ''),
      holderClientId: ctx.client.clientSessionId,
    })
    const toSessionId = typeof p.toSessionId === 'string' ? p.toSessionId : null
    if (toSessionId && !ctx.sessions.get(toSessionId)) {
      return { error: { code: 'not_found', message: 'toSessionId not found' } }
    }
    return {
      result: ctx.collaboration.send({
        fromSessionId,
        toSessionId,
        mailbox: String(p.mailbox ?? 'default'),
        body: p.body,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleCollaborationList(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readSession)
  if (denied) return denied
  const p = asRecord(payload)
  return {
    result: ctx.collaboration.list({
      mailbox: typeof p.mailbox === 'string' ? p.mailbox : undefined,
      sessionId: typeof p.sessionId === 'string' ? p.sessionId : undefined,
    }),
  }
}
