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
  consumeRateLimitReset,
  detectExternalAgentConfig,
  getAuthStatus,
  importExternalAgentConfig,
  installPlugin,
  listPluginInventory,
  loginMcpServerOauth,
  marketplaceAdd,
  marketplaceRemove,
  marketplaceUpgrade,
  normalizeApiKey,
  readAccountUsage,
  readRateLimits,
  resolveMode,
  uninstallPlugin,
  type CodexProjectAuth,
} from '@superone/codex'
import type {
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
}
