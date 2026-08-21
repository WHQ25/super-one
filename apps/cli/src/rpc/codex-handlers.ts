/**
 * Codex admin RPC surface on the node:
 *   codex.getAuthStatus | setAuth | getAccountStatus | accountLogin* | accountLogout
 *   codex.getRateLimits | getAccountUsage | getServerDiagnostics | getConfigRequirements
 *   codex.consumeRateLimitReset
 *   codex.loginMcpOauth | detectExternalAgent | importExternalAgent
 *   codex.plugins.list | install | uninstall
 *   codex.marketplace.add | remove | upgrade
 *
 * Requires codex binary when the method talks to app-server.
 * Marketplace mutate methods require node:admin.
 * Auth is process-memory only (see codex-admin-service projectAuthById).
 */

import { hasAllScopes, OPERATION_SCOPES, type RpcErrorCode } from '@superone/shared/environment'
import type { CodexExternalAgentItem, CodexSetAuthRequest } from '@superone/shared/agent-types'
import type { AuthenticatedClient } from '../auth/auth-service'
import type { ProjectRegistry } from '../workspace/project-registry'
import type { HarnessManager } from '../session/harness-manager'
import type { ProviderStore } from '../provider/provider-store'
import { createCodexAdminService } from '../session/codex-admin-service'
import type { CodexSpawnFn } from '@superone/codex'

export interface CodexRpcContext {
  client: AuthenticatedClient
  projects: ProjectRegistry
  harnesses: HarnessManager
  providers: ProviderStore
  binaryPath?: string | null
  spawnFn?: CodexSpawnFn
}

export interface CodexRpcResult {
  result?: unknown
  error?: { code: RpcErrorCode; message: string; details?: Record<string, unknown> }
}

function requireScopes(
  client: AuthenticatedClient,
  scopes: readonly string[],
): CodexRpcResult | null {
  if (!hasAllScopes(client.scopes, scopes as never)) {
    return { error: { code: 'forbidden', message: `missing scopes: ${scopes.join(', ')}` } }
  }
  return null
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

function mapThrown(err: unknown): CodexRpcResult {
  const e = err as { code?: string; message?: string }
  const code = (e.code as RpcErrorCode | undefined) ?? 'internal'
  return { error: { code, message: e.message || 'internal error' } }
}

function admin(ctx: CodexRpcContext) {
  return createCodexAdminService({
    binaryPath: ctx.binaryPath,
    harnesses: ctx.harnesses,
    providers: ctx.providers,
    spawnFn: ctx.spawnFn,
    resolveProjectPath: (projectId) => ctx.projects.get(projectId)?.path ?? null,
  })
}

function projectIdOf(p: Record<string, unknown>): string {
  return String(p.projectId ?? '')
}

export async function dispatchCodexRpc(
  method: string,
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult | null> {
  if (!method.startsWith('codex.')) return null

  switch (method) {
    case 'codex.getAuthStatus':
      return handleGetAuthStatus(payload, ctx)
    case 'codex.setAuth':
      return handleSetAuth(payload, ctx)
    case 'codex.getAccountStatus':
      return handleGetAccountStatus(payload, ctx)
    case 'codex.accountLoginStart':
      return handleAccountLoginStart(payload, ctx)
    case 'codex.accountLoginCancel':
      return handleAccountLoginCancel(payload, ctx)
    case 'codex.accountLogout':
      return handleAccountLogout(payload, ctx)
    case 'codex.getRateLimits':
      return handleGetRateLimits(payload, ctx)
    case 'codex.getAccountUsage':
      return handleGetAccountUsage(payload, ctx)
    case 'codex.getServerDiagnostics':
      return handleGetServerDiagnostics(payload, ctx)
    case 'codex.getConfigRequirements':
      return handleGetConfigRequirements(payload, ctx)
    case 'codex.consumeRateLimitReset':
      return handleConsumeRateLimitReset(payload, ctx)
    case 'codex.loginMcpOauth':
      return handleLoginMcpOauth(payload, ctx)
    case 'codex.detectExternalAgent':
      return handleDetectExternalAgent(payload, ctx)
    case 'codex.importExternalAgent':
      return handleImportExternalAgent(payload, ctx)
    case 'codex.plugins.list':
      return handlePluginsList(payload, ctx)
    case 'codex.plugins.install':
      return handlePluginsInstall(payload, ctx)
    case 'codex.plugins.uninstall':
      return handlePluginsUninstall(payload, ctx)
    case 'codex.marketplace.add':
      return handleMarketplaceAdd(payload, ctx)
    case 'codex.marketplace.remove':
      return handleMarketplaceRemove(payload, ctx)
    case 'codex.marketplace.upgrade':
      return handleMarketplaceUpgrade(payload, ctx)
    default:
      return {
        error: { code: 'not_found', message: `unknown method: ${method}` },
      }
  }
}

export const CODEX_MUTATING_METHODS = [
  'codex.setAuth',
  'codex.accountLoginStart',
  'codex.accountLoginCancel',
  'codex.accountLogout',
  'codex.consumeRateLimitReset',
  'codex.loginMcpOauth',
  'codex.importExternalAgent',
  'codex.plugins.install',
  'codex.plugins.uninstall',
  'codex.marketplace.add',
  'codex.marketplace.remove',
  'codex.marketplace.upgrade',
] as const

function handleGetAuthStatus(payload: unknown, ctx: CodexRpcContext): CodexRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId required' } }
  }
  if (!ctx.projects.get(projectId)) {
    return { error: { code: 'not_found', message: 'project not found' } }
  }
  return { result: admin(ctx).getAuthStatus(projectId) }
}

function handleSetAuth(payload: unknown, ctx: CodexRpcContext): CodexRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId required' } }
  }
  if (!ctx.projects.get(projectId)) {
    return { error: { code: 'not_found', message: 'project not found' } }
  }
  const mode = p.mode
  if (mode !== 'auto' && mode !== 'chatgpt' && mode !== 'apiKey') {
    return { error: { code: 'invalid_argument', message: 'mode must be auto|chatgpt|apiKey' } }
  }
  try {
    const request: CodexSetAuthRequest = {
      mode,
      ...(typeof p.apiKey === 'string' ? { apiKey: p.apiKey } : {}),
    }
    return { result: admin(ctx).setAuth(projectId, request) }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleGetAccountStatus(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) return { error: { code: 'invalid_argument', message: 'projectId required' } }
  if (!ctx.projects.get(projectId)) return { error: { code: 'not_found', message: 'project not found' } }
  try {
    return { result: await admin(ctx).getAccountStatus() }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleAccountLoginStart(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) return { error: { code: 'invalid_argument', message: 'projectId required' } }
  if (!ctx.projects.get(projectId)) return { error: { code: 'not_found', message: 'project not found' } }
  try {
    return { result: await admin(ctx).startAccountLogin(projectId) }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleAccountLoginCancel(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const loginId = typeof p.loginId === 'string' ? p.loginId.trim() : ''
  if (!loginId) return { error: { code: 'invalid_argument', message: 'loginId required' } }
  try {
    await admin(ctx).cancelAccountLogin(loginId)
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleAccountLogout(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) return { error: { code: 'invalid_argument', message: 'projectId required' } }
  if (!ctx.projects.get(projectId)) return { error: { code: 'not_found', message: 'project not found' } }
  try {
    return { result: await admin(ctx).logoutAccount() }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleGetRateLimits(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId required' } }
  }
  if (!ctx.projects.get(projectId)) {
    return { error: { code: 'not_found', message: 'project not found' } }
  }
  try {
    const svc = admin(ctx)
    if (!svc.isBinaryReady()) {
      return {
        error: {
          code: 'failed_precondition',
          message: 'Codex binary not ready',
        },
      }
    }
    const apiProviderId =
      typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    return { result: await svc.getRateLimits(projectId, apiProviderId) }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleGetAccountUsage(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId required' } }
  }
  if (!ctx.projects.get(projectId)) {
    return { error: { code: 'not_found', message: 'project not found' } }
  }
  try {
    const svc = admin(ctx)
    if (!svc.isBinaryReady()) {
      return {
        error: {
          code: 'failed_precondition',
          message: 'Codex binary not ready',
        },
      }
    }
    const apiProviderId =
      typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    const threadId = typeof p.threadId === 'string' ? p.threadId : null
    return { result: await svc.getAccountUsage(projectId, apiProviderId, threadId) }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleGetServerDiagnostics(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) return { error: { code: 'invalid_argument', message: 'projectId required' } }
  if (!ctx.projects.get(projectId)) return { error: { code: 'not_found', message: 'project not found' } }
  try {
    const svc = admin(ctx)
    if (!svc.isBinaryReady()) {
      return { error: { code: 'failed_precondition', message: 'Codex binary not ready' } }
    }
    const apiProviderId = typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    return { result: await svc.getServerDiagnostics(projectId, apiProviderId) }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleGetConfigRequirements(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) return { error: { code: 'invalid_argument', message: 'projectId required' } }
  if (!ctx.projects.get(projectId)) return { error: { code: 'not_found', message: 'project not found' } }
  try {
    const svc = admin(ctx)
    if (!svc.isBinaryReady()) {
      return { error: { code: 'failed_precondition', message: 'Codex binary not ready' } }
    }
    const apiProviderId = typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    return { result: await svc.getConfigRequirements(projectId, apiProviderId) }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleConsumeRateLimitReset(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId required' } }
  }
  if (!ctx.projects.get(projectId)) {
    return { error: { code: 'not_found', message: 'project not found' } }
  }
  try {
    const svc = admin(ctx)
    if (!svc.isBinaryReady()) {
      return {
        error: {
          code: 'failed_precondition',
          message: 'Codex binary not ready',
        },
      }
    }
    const apiProviderId =
      typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    const creditId = typeof p.creditId === 'string' ? p.creditId : null
    return {
      result: await svc.consumeRateLimitReset(projectId, apiProviderId, creditId),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleLoginMcpOauth(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  const serverName = String(p.serverName ?? p.name ?? '').trim()
  if (!projectId || !serverName) {
    return {
      error: { code: 'invalid_argument', message: 'projectId and serverName required' },
    }
  }
  try {
    const apiProviderId =
      typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    const rawOptions = asRecord(p.options)
    const options = {
      ...(rawOptions.clientRegistration === 'auto' || rawOptions.clientRegistration === 'cimd' || rawOptions.clientRegistration === 'dcr'
        ? { clientRegistration: rawOptions.clientRegistration }
        : {}),
      ...(typeof rawOptions.threadId === 'string' || rawOptions.threadId === null
        ? { threadId: rawOptions.threadId }
        : {}),
      ...(Array.isArray(rawOptions.scopes) && rawOptions.scopes.every((scope) => typeof scope === 'string')
        ? { scopes: rawOptions.scopes as string[] }
        : {}),
      ...(typeof rawOptions.timeoutSecs === 'number' && Number.isFinite(rawOptions.timeoutSecs) && rawOptions.timeoutSecs > 0
        ? { timeoutSecs: rawOptions.timeoutSecs }
        : {}),
    }
    return {
      result: await admin(ctx).loginMcpOauth(projectId, serverName, apiProviderId, options),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleDetectExternalAgent(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readEnvironment)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId required' } }
  }
  try {
    const apiProviderId =
      typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    return {
      result: {
        items: await admin(ctx).detectExternalAgent(projectId, apiProviderId),
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleImportExternalAgent(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId required' } }
  }
  const items = Array.isArray(p.items) ? (p.items as CodexExternalAgentItem[]) : []
  try {
    const apiProviderId =
      typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    return {
      result: await admin(ctx).importExternalAgent(projectId, items, apiProviderId),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handlePluginsList(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId required' } }
  }
  try {
    const apiProviderId =
      typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    const marketplace = p.marketplace === true || p.includeMarketplace === true
    const svc = admin(ctx)
    if (!svc.isBinaryReady()) {
      return {
        error: { code: 'failed_precondition', message: 'Codex binary not ready' },
      }
    }
    const plugins = marketplace
      ? await svc.listMarketplacePlugins(projectId, apiProviderId)
      : await svc.listPlugins(projectId, apiProviderId)
    return { result: { plugins, provider: 'codex' } }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handlePluginsInstall(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  const key = String(p.key ?? p.pluginId ?? '').trim()
  if (!projectId || !key) {
    return { error: { code: 'invalid_argument', message: 'projectId and key required' } }
  }
  try {
    const apiProviderId =
      typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    return { result: await admin(ctx).installPlugin(projectId, key, apiProviderId) }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handlePluginsUninstall(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  const key = String(p.key ?? p.pluginId ?? '').trim()
  if (!projectId || !key) {
    return { error: { code: 'invalid_argument', message: 'projectId and key required' } }
  }
  try {
    const apiProviderId =
      typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    return { result: await admin(ctx).uninstallPlugin(projectId, key, apiProviderId) }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleMarketplaceAdd(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  const source = String(p.source ?? '').trim()
  if (!projectId || !source) {
    return {
      error: { code: 'invalid_argument', message: 'projectId and source required' },
    }
  }
  try {
    const apiProviderId =
      typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    const sparsePaths = Array.isArray(p.sparsePaths)
      ? p.sparsePaths.filter((s): s is string => typeof s === 'string')
      : undefined
    return {
      result: await admin(ctx).marketplaceAdd(
        projectId,
        {
          source,
          ...(typeof p.refName === 'string' ? { refName: p.refName } : {}),
          ...(sparsePaths ? { sparsePaths } : {}),
        },
        apiProviderId,
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleMarketplaceRemove(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  const marketplaceName = String(p.marketplaceName ?? p.name ?? '').trim()
  if (!projectId || !marketplaceName) {
    return {
      error: {
        code: 'invalid_argument',
        message: 'projectId and marketplaceName required',
      },
    }
  }
  try {
    const apiProviderId =
      typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    return {
      result: await admin(ctx).marketplaceRemove(projectId, marketplaceName, apiProviderId),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleMarketplaceUpgrade(
  payload: unknown,
  ctx: CodexRpcContext,
): Promise<CodexRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (denied) return denied
  const p = asRecord(payload)
  const projectId = projectIdOf(p)
  if (!projectId) {
    return { error: { code: 'invalid_argument', message: 'projectId required' } }
  }
  try {
    const apiProviderId =
      typeof p.apiProviderId === 'string' ? p.apiProviderId : null
    const marketplaceName =
      typeof p.marketplaceName === 'string' ? p.marketplaceName : undefined
    return {
      result: await admin(ctx).marketplaceUpgrade(
        projectId,
        marketplaceName,
        apiProviderId,
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}
