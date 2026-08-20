/**
 * Node-side Codex app-server admin surface (auth / usage / plugins / marketplace).
 * Electron-free; opens short-lived or shared admin connections via the binary.
 *
 * Auth store: `projectAuthById` is process-memory only (not SQLite). Pairing is
 * per-node and auth is re-set via `codex.setAuth` after restart; a durable table
 * is not justified until multi-restart ChatGPT/apiKey continuity is required.
 * MCP OAuth authorize URLs must be opened by the desktop/host_action, not here.
 */

import { openCodexAppServer, type CodexAppServerHandle, type CodexSpawnFn } from '@superone/codex'
import {
  applySetAuth,
  cancelAccountLogin,
  consumeRateLimitReset,
  detectExternalAgentConfig,
  getAuthStatus,
  importExternalAgentConfig,
  installPlugin,
  listPluginInventory,
  loginMcpServerOauth,
  logoutAccount,
  marketplaceAdd,
  marketplaceRemove,
  marketplaceUpgrade,
  normalizeApiKey,
  readAccountUsage,
  readAccountStatus,
  readRateLimits,
  resolveMode,
  startAccountLogin,
  uninstallPlugin,
  type CodexProjectAuth,
} from '@superone/codex'
import type {
  CodexAccountLoginStartResult,
  CodexAccountStatus,
  CodexAccountUsage,
  CodexAuthStatus,
  CodexExternalAgentImportResult,
  CodexExternalAgentItem,
  CodexMcpOauthLoginResult,
  CodexRateLimitResetOutcome,
  CodexRateLimits,
  CodexSetAuthRequest,
} from '@superone/shared/agent-types'
import type { HarnessManager } from './harness-manager'
import { resolveCodexBinaryPath } from './codex-turn-runner'
import type { ProviderStore } from '../provider/provider-store'
import { buildHarnessEnvWithProxy, resolveHarnessService } from '../provider/resolve-service'

export interface CodexAdminServiceOptions {
  binaryPath?: string | null
  harnesses?: HarnessManager
  providers?: ProviderStore
  env?: NodeJS.ProcessEnv
  spawnFn?: CodexSpawnFn
  resolveProjectPath: (projectId: string) => string | null
}

/**
 * Process-wide project auth keyed by projectId.
 * Intentionally not persisted: node restart clears mode/apiKey; clients re-auth.
 */
const projectAuthById = new Map<string, CodexProjectAuth>()

const pendingAccountLogins = new Map<
  string,
  { projectId: string; client: CodexAppServerHandle }
>()

export class CodexAdminService {
  constructor(private readonly opts: CodexAdminServiceOptions) {}

  getProjectAuth(projectId: string): CodexProjectAuth {
    let auth = projectAuthById.get(projectId)
    if (!auth) {
      auth = { mode: 'auto' }
      projectAuthById.set(projectId, auth)
    }
    return auth
  }

  getAuthStatus(projectId: string): CodexAuthStatus {
    return getAuthStatus(this.getProjectAuth(projectId))
  }

  setAuth(projectId: string, request: CodexSetAuthRequest): CodexAuthStatus {
    const current = this.getProjectAuth(projectId)
    const next = applySetAuth(current, request)
    projectAuthById.set(projectId, next)
    return getAuthStatus(next)
  }

  isBinaryReady(): boolean {
    return Boolean(
      resolveCodexBinaryPath({
        binaryPath: this.opts.binaryPath,
        harnesses: this.opts.harnesses,
      }),
    )
  }

  private async withClient<T>(
    projectId: string,
    apiProviderId: string | null | undefined,
    fn: (client: CodexAppServerHandle, projectPath: string) => Promise<T>,
  ): Promise<T> {
    const binary = resolveCodexBinaryPath({
      binaryPath: this.opts.binaryPath,
      harnesses: this.opts.harnesses,
    })
    if (!binary) {
      throw Object.assign(new Error('Codex binary not available'), {
        code: 'failed_precondition',
      })
    }
    const projectPath =
      this.opts.resolveProjectPath(projectId) ||
      process.env.SUPERONE_DEFAULT_CWD ||
      process.cwd()
    const auth = this.getProjectAuth(projectId)
    let providerEnv: NodeJS.ProcessEnv = {}
    if (this.opts.providers) {
      try {
        // openai-chat → loopback proxy; native openai-responses → real base URL.
        providerEnv = await buildHarnessEnvWithProxy(
          'codex',
          resolveHarnessService(this.opts.providers, 'codex', apiProviderId),
        )
      } catch {
        providerEnv = {}
      }
    }
    // Inject session API key when in apiKey mode.
    const authEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.opts.env,
      ...providerEnv,
    }
    if (resolveMode(auth.mode, auth.apiKey) === 'apiKey') {
      const key = normalizeApiKey(auth.apiKey) || normalizeApiKey(process.env.CODEX_API_KEY)
      if (key) authEnv.CODEX_API_KEY = key
    }

    const client = await openCodexAppServer({
      binaryPath: binary,
      env: authEnv,
      spawnFn: this.opts.spawnFn,
    })
    try {
      return await fn(client, projectPath)
    } finally {
      await client.close().catch(() => {})
    }
  }

  private async openAccountClient(): Promise<CodexAppServerHandle> {
    const binary = resolveCodexBinaryPath({
      binaryPath: this.opts.binaryPath,
      harnesses: this.opts.harnesses,
    })
    if (!binary) {
      throw Object.assign(new Error('Codex binary not available'), {
        code: 'failed_precondition',
      })
    }
    const env: NodeJS.ProcessEnv = { ...process.env, ...this.opts.env }
    delete env.CODEX_API_KEY
    return openCodexAppServer({
      binaryPath: binary,
      env,
      spawnFn: this.opts.spawnFn,
    })
  }

  async getAccountStatus(): Promise<CodexAccountStatus> {
    const client = await this.openAccountClient()
    try {
      return await readAccountStatus(client)
    } finally {
      await client.close().catch(() => {})
    }
  }

  async startAccountLogin(projectId: string): Promise<CodexAccountLoginStartResult> {
    const client = await this.openAccountClient()
    try {
      const result = await startAccountLogin(client, 'chatgptDeviceCode')
      pendingAccountLogins.set(result.loginId, { projectId, client })
      void this.waitForAccountLogin(result.loginId, client)
      return result
    } catch (error) {
      await client.close().catch(() => {})
      throw error
    }
  }

  private async waitForAccountLogin(
    loginId: string,
    client: CodexAppServerHandle,
  ): Promise<void> {
    const deadline = Date.now() + 15 * 60_000
    try {
      while (Date.now() < deadline && pendingAccountLogins.get(loginId)?.client === client) {
        const notification = await client.nextNotification(Math.min(1_000, deadline - Date.now()))
        if (!notification) continue
        if (
          notification.method === 'account/login/completed'
          && notification.params.loginId === loginId
        ) return
      }
    } catch {
      // The status poll in the desktop is the user-facing source of truth.
    } finally {
      if (pendingAccountLogins.get(loginId)?.client === client) {
        pendingAccountLogins.delete(loginId)
      }
      await client.close().catch(() => {})
    }
  }

  async cancelAccountLogin(loginId: string): Promise<void> {
    const pending = pendingAccountLogins.get(loginId)
    if (!pending) return
    pendingAccountLogins.delete(loginId)
    try {
      await cancelAccountLogin(pending.client, loginId)
    } finally {
      await pending.client.close().catch(() => {})
    }
  }

  async logoutAccount(): Promise<CodexAccountStatus> {
    for (const [loginId, pending] of [...pendingAccountLogins]) {
      pendingAccountLogins.delete(loginId)
      await cancelAccountLogin(pending.client, loginId).catch(() => {})
      await pending.client.close().catch(() => {})
    }
    const client = await this.openAccountClient()
    try {
      await logoutAccount(client)
      return await readAccountStatus(client)
    } finally {
      await client.close().catch(() => {})
    }
  }

  async getRateLimits(
    projectId: string,
    apiProviderId?: string | null,
  ): Promise<CodexRateLimits | null> {
    const auth = this.getProjectAuth(projectId)
    if (resolveMode(auth.mode, auth.apiKey) !== 'chatgpt') return null
    try {
      return await this.withClient(projectId, apiProviderId, (client) => readRateLimits(client))
    } catch {
      return null
    }
  }

  async getAccountUsage(
    projectId: string,
    apiProviderId?: string | null,
  ): Promise<CodexAccountUsage | null> {
    const auth = this.getProjectAuth(projectId)
    if (resolveMode(auth.mode, auth.apiKey) !== 'chatgpt') return null
    try {
      return await this.withClient(projectId, apiProviderId, (client) => readAccountUsage(client))
    } catch {
      return null
    }
  }

  async consumeRateLimitReset(
    projectId: string,
    apiProviderId?: string | null,
    creditId?: string | null,
  ): Promise<CodexRateLimitResetOutcome | null> {
    const auth = this.getProjectAuth(projectId)
    if (resolveMode(auth.mode, auth.apiKey) !== 'chatgpt') return null
    try {
      return await this.withClient(projectId, apiProviderId, (client) =>
        consumeRateLimitReset(client, creditId),
      )
    } catch {
      return null
    }
  }

  async loginMcpOauth(
    projectId: string,
    serverName: string,
    apiProviderId?: string | null,
  ): Promise<CodexMcpOauthLoginResult> {
    return this.withClient(projectId, apiProviderId, (client) =>
      loginMcpServerOauth(client, serverName),
    )
  }

  async detectExternalAgent(
    projectId: string,
    apiProviderId?: string | null,
  ): Promise<CodexExternalAgentItem[]> {
    return this.withClient(projectId, apiProviderId, (client, path) =>
      detectExternalAgentConfig(client, path),
    )
  }

  async importExternalAgent(
    projectId: string,
    items: CodexExternalAgentItem[],
    apiProviderId?: string | null,
  ): Promise<CodexExternalAgentImportResult | null> {
    return this.withClient(projectId, apiProviderId, (client) =>
      importExternalAgentConfig(client, items),
    )
  }

  async listPlugins(projectId: string, apiProviderId?: string | null) {
    return this.withClient(projectId, apiProviderId, async (client, path) => {
      const records = await listPluginInventory(client, path)
      return records
        .filter((r) => r.installed)
        .map((r) => ({
          key: r.key,
          name: r.name,
          marketplace: r.marketplace,
          installed: r.installed,
          enabled: r.enabled,
          sourcePath: r.sourcePath,
        }))
    })
  }

  async listMarketplacePlugins(projectId: string, apiProviderId?: string | null) {
    return this.withClient(projectId, apiProviderId, async (client, path) => {
      const records = await listPluginInventory(client, path)
      return records.map((r) => ({
        key: r.key,
        name: r.name,
        marketplace: r.marketplace,
        installed: r.installed,
        enabled: r.enabled,
      }))
    })
  }

  async installPlugin(projectId: string, key: string, apiProviderId?: string | null) {
    return this.withClient(projectId, apiProviderId, async (client, path) => {
      const records = await listPluginInventory(client, path)
      const record = records.find((r) => r.key === key)
      if (!record) throw new Error(`Unknown Codex plugin: ${key}`)
      await installPlugin(client, record.marketplacePath, record.name)
      return { ok: true as const, key }
    })
  }

  async uninstallPlugin(projectId: string, key: string, apiProviderId?: string | null) {
    return this.withClient(projectId, apiProviderId, async (client) => {
      await uninstallPlugin(client, key)
      return { ok: true as const, key }
    })
  }

  async marketplaceAdd(
    projectId: string,
    request: { source: string; refName?: string; sparsePaths?: string[] },
    apiProviderId?: string | null,
  ) {
    return this.withClient(projectId, apiProviderId, (client) => marketplaceAdd(client, request))
  }

  async marketplaceRemove(
    projectId: string,
    marketplaceName: string,
    apiProviderId?: string | null,
  ) {
    return this.withClient(projectId, apiProviderId, async (client) => {
      await marketplaceRemove(client, marketplaceName)
      return { ok: true as const }
    })
  }

  async marketplaceUpgrade(
    projectId: string,
    marketplaceName?: string,
    apiProviderId?: string | null,
  ) {
    return this.withClient(projectId, apiProviderId, (client) =>
      marketplaceUpgrade(client, marketplaceName),
    )
  }
}

export function createCodexAdminService(opts: CodexAdminServiceOptions): CodexAdminService {
  return new CodexAdminService(opts)
}

/** Test helper — clear durable auth map. */
export function clearCodexAdminAuthForTest(): void {
  projectAuthById.clear()
  for (const pending of pendingAccountLogins.values()) {
    void pending.client.close().catch(() => {})
  }
  pendingAccountLogins.clear()
}
