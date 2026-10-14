/**
 * `codex.*`: a node's Codex app-server admin surface (auth, accounts, usage,
 * MCP OAuth, external agent import, plugins, marketplaces), served by every
 * node over its own Codex services.
 *
 * The client is not at the node's screen: account sign-in is a device code
 * the client shows, an MCP sign-in hands the client its authorization URL and
 * takes back the browser's loopback callback, and nothing here returns key
 * material (`setAuth` writes a key and answers with its status only). Methods
 * that need the binary fail with `failed_precondition` while it is not ready.
 */

import { randomUUID } from 'node:crypto'
import { OPERATION_SCOPES, type AuthScope } from '@superone/shared/environment'
import type { CodexAccount, CodexManagedLoginStart } from '@superone/shared/codex-accounts'
import type {
  CodexAccountStatus,
  CodexAccountUsage,
  CodexAuthStatus,
  CodexConfigRequirements,
  CodexExternalAgentImportResult,
  CodexExternalAgentItem,
  CodexMarketplaceAddRequest,
  CodexMarketplaceAddResult,
  CodexMarketplaceUpgradeResult,
  CodexMcpOauthLoginOptions,
  CodexMcpOauthLoginResult,
  CodexMcpOauthLoginStart,
  CodexRateLimitResetOutcome,
  CodexRateLimits,
  CodexServerDiagnostics,
  CodexSetAuthRequest,
} from '@superone/shared/agent-types'
import { validateLoopbackOAuthCallback } from '@superone/shared/oauth-loopback'
import type { AuthenticatedClient } from './auth-service'
import type { RpcResult } from './rpc-context'
import { asRecord, mapThrown, optionalString, requireScopes } from './rpc-helpers'

/** A node's Codex services, addressed by project id. */
export interface CodexAdminPort {
  getAuthStatus(projectId: string): CodexAuthStatus
  setAuth(projectId: string, request: CodexSetAuthRequest): CodexAuthStatus
  isBinaryReady(): boolean
  accounts: { list(): Promise<CodexAccount[]>; setDefault(accountId: string): Promise<void>; remove(providerId: string): Promise<void> }
  getAccountStatus(apiProviderId?: string | null): Promise<CodexAccountStatus>
  /** A device-code sign-in: the client shows the code and opens the URL. */
  startAccountLogin(projectId: string, accountId?: string): Promise<CodexManagedLoginStart>
  cancelAccountLogin(loginId: string): Promise<void>
  logoutAccount(apiProviderId?: string | null): Promise<CodexAccountStatus>
  getRateLimits(projectId: string, apiProviderId: string | null, force?: boolean, preferCached?: boolean): Promise<CodexRateLimits | null>
  getAccountUsage(projectId: string, apiProviderId: string | null, threadId: string | null, force?: boolean, preferCached?: boolean): Promise<CodexAccountUsage | null>
  getServerDiagnostics(projectId: string, apiProviderId: string | null): Promise<CodexServerDiagnostics | null>
  getConfigRequirements(projectId: string, apiProviderId: string | null): Promise<CodexConfigRequirements | null>
  consumeRateLimitReset(projectId: string, apiProviderId: string | null, creditId: string | null): Promise<CodexRateLimitResetOutcome | null>
  /** Settles when Codex reports the sign-in; `openUrl` receives the authorization URL as soon as it exists. */
  loginMcpOauth(
    projectId: string, serverName: string, apiProviderId: string | null, options: CodexMcpOauthLoginOptions, openUrl: (url: string) => void,
  ): Promise<CodexMcpOauthLoginResult>
  detectExternalAgent(projectId: string, apiProviderId: string | null): Promise<CodexExternalAgentItem[]>
  importExternalAgent(projectId: string, items: CodexExternalAgentItem[], apiProviderId: string | null): Promise<CodexExternalAgentImportResult | null>
  listPlugins(projectId: string, apiProviderId: string | null): Promise<unknown[]>
  listMarketplacePlugins(projectId: string, apiProviderId: string | null): Promise<unknown[]>
  installPlugin(projectId: string, key: string, apiProviderId: string | null): Promise<void>
  uninstallPlugin(projectId: string, key: string, apiProviderId: string | null): Promise<void>
  marketplaceAdd(projectId: string, request: CodexMarketplaceAddRequest, apiProviderId: string | null): Promise<CodexMarketplaceAddResult>
  marketplaceRemove(projectId: string, marketplaceName: string, apiProviderId: string | null): Promise<void>
  marketplaceUpgrade(projectId: string, marketplaceName: string | undefined, apiProviderId: string | null): Promise<CodexMarketplaceUpgradeResult>
}

export interface CodexRpcContext {
  client: AuthenticatedClient
  projects?: { get(projectId: string): { path: string } | null | undefined }
  codex: CodexAdminPort
}

interface CodexMethod {
  scopes: readonly AuthScope[]
  /** `known`: the project must be registered here; `id`: only named. */
  project?: 'known' | 'id'
  binary?: true
  run(p: Record<string, unknown>, codex: CodexAdminPort, projectId: string, client: AuthenticatedClient): unknown
}

function invalid(message: string): never {
  throw Object.assign(new Error(message), { code: 'invalid_argument' })
}

function required(p: Record<string, unknown>, ...keys: string[]): string {
  const value = keys.map((key) => p[key]).find((v) => v != null)
  const text = typeof value === 'string' ? value.trim() : ''
  return text || invalid(`${keys[0]} required`)
}

function mcpOauthOptions(raw: Record<string, unknown>): CodexMcpOauthLoginOptions {
  return {
    ...(raw.clientRegistration === 'auto' || raw.clientRegistration === 'cimd' || raw.clientRegistration === 'dcr'
      ? { clientRegistration: raw.clientRegistration }
      : {}),
    ...(typeof raw.threadId === 'string' || raw.threadId === null ? { threadId: raw.threadId } : {}),
    ...(Array.isArray(raw.scopes) && raw.scopes.every((scope) => typeof scope === 'string') ? { scopes: raw.scopes as string[] } : {}),
    ...(typeof raw.timeoutSecs === 'number' && Number.isFinite(raw.timeoutSecs) && raw.timeoutSecs > 0 ? { timeoutSecs: raw.timeoutSecs } : {}),
  }
}

interface PendingMcpOauth {
  clientSessionId: string
  authorizationUrl: string
  result: Promise<CodexMcpOauthLoginResult>
}

/** MCP sign-ins handed to a client, by login id; process-wide like the node's Codex services. */
const pendingMcpOauth = new Map<string, PendingMcpOauth>()

/** How long a settled sign-in waits for its client to collect the outcome. */
const MCP_OAUTH_COLLECT_MS = 60_000

/** Answers as soon as Codex has an authorization URL; a sign-in that fails before that answers its outcome. */
async function startMcpOauth(
  client: AuthenticatedClient,
  login: (openUrl: (url: string) => void) => Promise<CodexMcpOauthLoginResult>,
): Promise<CodexMcpOauthLoginStart | CodexMcpOauthLoginResult> {
  let opened!: (url: string) => void
  const authorization = new Promise<string>((resolve) => { opened = resolve })
  const result = login((url) => opened(url))
  const first = await Promise.race([authorization, result])
  if (typeof first !== 'string') return first
  const loginId = randomUUID()
  pendingMcpOauth.set(loginId, { clientSessionId: client.clientSessionId, authorizationUrl: first, result })
  const forget = () => { setTimeout(() => pendingMcpOauth.delete(loginId), MCP_OAUTH_COLLECT_MS).unref?.() }
  result.then(forget, forget)
  return { loginId, authorizationUrl: first }
}

/** Delivers the browser's callback to Codex's loopback listener, then answers the sign-in's outcome. */
async function completeMcpOauth(client: AuthenticatedClient, loginId: string, callbackUrl: string | null): Promise<CodexMcpOauthLoginResult> {
  const pending = pendingMcpOauth.get(loginId)
  if (!pending || pending.clientSessionId !== client.clientSessionId) {
    throw Object.assign(new Error('MCP sign-in not found'), { code: 'not_found' })
  }
  if (callbackUrl) {
    let callback: URL
    try { callback = validateLoopbackOAuthCallback(pending.authorizationUrl, callbackUrl) }
    catch (err) { invalid((err as Error).message) }
    // Codex's listener answers with a page; its completion notification carries the outcome.
    const response = await fetch(callback, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
    await response.body?.cancel()
  }
  try { return await pending.result }
  finally { pendingMcpOauth.delete(loginId) }
}

/**
 * The device-code sign-in each client has waiting, as its cancel. A client
 * keeps one; it ends when the client goes (disconnect, revoke), so a sign-in
 * nobody can finish never rewrites the node's account.
 */
const accountLogins = new Map<string, () => Promise<void>>()

async function startAccountLogin(client: AuthenticatedClient, start: () => Promise<CodexManagedLoginStart>, cancel: (loginId: string) => Promise<void>) {
  await cancelCodexAccountLoginForClient(client.clientSessionId)
  const started = start()
  // Registered before the start settles: a client gone meanwhile still cancels it.
  const end = () => started.then((login) => cancel(login.loginId), () => {})
  accountLogins.set(client.clientSessionId, end)
  try { return await started }
  catch (err) {
    if (accountLogins.get(client.clientSessionId) === end) accountLogins.delete(client.clientSessionId)
    throw err
  }
}

/** Ends the device-code sign-in a client that went away left waiting. */
export async function cancelCodexAccountLoginForClient(clientSessionId: string): Promise<void> {
  const cancel = accountLogins.get(clientSessionId)
  accountLogins.delete(clientSessionId)
  await cancel?.().catch(() => {})
}

const provider = (p: Record<string, unknown>) => optionalString(p.apiProviderId)
const read = OPERATION_SCOPES.readEnvironment
const admin = OPERATION_SCOPES.adminNode

const CODEX_METHODS: Readonly<Record<string, CodexMethod>> = {
  'codex.listAccounts': { scopes: read, project: 'known', run: (_p, codex) => codex.accounts.list() },
  'codex.removeAccount': {
    scopes: admin, project: 'known',
    run: async (p, codex) => {
      await codex.accounts.remove(required(p, 'apiProviderId'))
      return { ok: true }
    },
  },
  'codex.setDefaultAccount': {
    scopes: admin, project: 'known',
    run: async (p, codex) => {
      await codex.accounts.setDefault(required(p, 'accountId'))
      return { ok: true }
    },
  },
  'codex.getAuthStatus': { scopes: read, project: 'known', run: (_p, codex, projectId) => codex.getAuthStatus(projectId) },
  'codex.setAuth': {
    scopes: admin, project: 'known',
    run: (p, codex, projectId) => {
      const mode = p.mode
      if (mode !== 'auto' && mode !== 'chatgpt' && mode !== 'apiKey') invalid('mode must be auto|chatgpt|apiKey')
      return codex.setAuth(projectId, { mode, ...(typeof p.apiKey === 'string' ? { apiKey: p.apiKey } : {}) })
    },
  },
  'codex.getAccountStatus': { scopes: read, project: 'known', run: (p, codex) => codex.getAccountStatus(optionalString(p.apiProviderId) ?? undefined) },
  'codex.accountLoginStart': {
    scopes: admin, project: 'known',
    run: (p, codex, projectId, client) => startAccountLogin(
      client, () => codex.startAccountLogin(projectId, optionalString(p.accountId) ?? undefined), (loginId) => codex.cancelAccountLogin(loginId)),
  },
  'codex.accountLoginCancel': {
    scopes: admin,
    run: async (p, codex) => {
      await codex.cancelAccountLogin(required(p, 'loginId'))
      return { ok: true }
    },
  },
  'codex.accountLogout': { scopes: admin, project: 'known', run: (p, codex) => codex.logoutAccount(optionalString(p.apiProviderId) ?? undefined) },
  'codex.getRateLimits': { scopes: read, project: 'known', binary: true, run: (p, codex, projectId) => codex.getRateLimits(projectId, provider(p), p.force === true, p.preferCached === true) },
  'codex.getAccountUsage': {
    scopes: read, project: 'known', binary: true,
    run: (p, codex, projectId) => codex.getAccountUsage(projectId, provider(p), optionalString(p.threadId), p.force === true, p.preferCached === true),
  },
  'codex.getServerDiagnostics': { scopes: read, project: 'known', binary: true, run: (p, codex, projectId) => codex.getServerDiagnostics(projectId, provider(p)) },
  'codex.getConfigRequirements': { scopes: read, project: 'known', binary: true, run: (p, codex, projectId) => codex.getConfigRequirements(projectId, provider(p)) },
  'codex.consumeRateLimitReset': {
    scopes: admin, project: 'known', binary: true,
    run: (p, codex, projectId) => codex.consumeRateLimitReset(projectId, provider(p), optionalString(p.creditId)),
  },
  'codex.loginMcpOauth': {
    scopes: admin, project: 'id',
    run: (p, codex, projectId, client) => startMcpOauth(client, (openUrl) =>
      codex.loginMcpOauth(projectId, required(p, 'serverName', 'name'), provider(p), mcpOauthOptions(asRecord(p.options)), openUrl)),
  },
  'codex.completeMcpOauth': {
    scopes: admin,
    run: (p, _codex, _projectId, client) => completeMcpOauth(client, required(p, 'loginId'), optionalString(p.callbackUrl)),
  },
  'codex.detectExternalAgent': {
    scopes: read, project: 'id',
    run: async (p, codex, projectId) => ({ items: await codex.detectExternalAgent(projectId, provider(p)) }),
  },
  'codex.importExternalAgent': {
    scopes: admin, project: 'id',
    run: (p, codex, projectId) => codex.importExternalAgent(projectId, Array.isArray(p.items) ? (p.items as CodexExternalAgentItem[]) : [], provider(p)),
  },
  'codex.plugins.list': {
    scopes: OPERATION_SCOPES.readWorkspace, project: 'id', binary: true,
    run: async (p, codex, projectId) => ({
      plugins: p.marketplace === true || p.includeMarketplace === true
        ? await codex.listMarketplacePlugins(projectId, provider(p))
        : await codex.listPlugins(projectId, provider(p)),
      provider: 'codex',
    }),
  },
  'codex.plugins.install': {
    scopes: admin, project: 'id',
    run: async (p, codex, projectId) => {
      const key = required(p, 'key', 'pluginId')
      await codex.installPlugin(projectId, key, provider(p))
      return { ok: true, key }
    },
  },
  'codex.plugins.uninstall': {
    scopes: admin, project: 'id',
    run: async (p, codex, projectId) => {
      const key = required(p, 'key', 'pluginId')
      await codex.uninstallPlugin(projectId, key, provider(p))
      return { ok: true, key }
    },
  },
  'codex.marketplace.add': {
    scopes: admin, project: 'id',
    run: (p, codex, projectId) => {
      const sparsePaths = Array.isArray(p.sparsePaths) ? p.sparsePaths.filter((s): s is string => typeof s === 'string') : undefined
      return codex.marketplaceAdd(projectId, {
        source: required(p, 'source'),
        ...(typeof p.refName === 'string' ? { refName: p.refName } : {}),
        ...(sparsePaths ? { sparsePaths } : {}),
      }, provider(p))
    },
  },
  'codex.marketplace.remove': {
    scopes: admin, project: 'id',
    run: async (p, codex, projectId) => {
      await codex.marketplaceRemove(projectId, required(p, 'marketplaceName', 'name'), provider(p))
      return { ok: true }
    },
  },
  'codex.marketplace.upgrade': {
    scopes: admin, project: 'id',
    run: (p, codex, projectId) => codex.marketplaceUpgrade(projectId, typeof p.marketplaceName === 'string' ? p.marketplaceName : undefined, provider(p)),
  },
}

/** Every method of the family. */
export const CODEX_RPC_METHODS: ReadonlySet<string> = new Set(Object.keys(CODEX_METHODS))

/** `null` for a method outside the family. */
export async function dispatchCodexRpc(method: string, payload: unknown, ctx: CodexRpcContext): Promise<RpcResult | null> {
  const handler = Object.hasOwn(CODEX_METHODS, method) ? CODEX_METHODS[method] : undefined
  if (!handler) return null
  const denied = requireScopes(ctx.client, handler.scopes)
  if (denied) return denied
  try {
    const p = asRecord(payload)
    const projectId = handler.project ? required(p, 'projectId') : ''
    if (handler.project === 'known' && !ctx.projects?.get(projectId)) return { error: { code: 'not_found', message: 'project not found' } }
    if (handler.binary && !ctx.codex.isBinaryReady()) return { error: { code: 'failed_precondition', message: 'Codex binary not ready' } }
    return { result: await handler.run(p, ctx.codex, projectId, ctx.client) }
  } catch (err) {
    return mapThrown(err)
  }
}
