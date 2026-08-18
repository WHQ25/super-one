/**
 * Skills + MCP + plugins + agents + hooks RPC handlers (desktop resource management parity).
 * Methods:
 *   skills.list|get|readFile|delete|install
 *   mcp.list|save|toggle|delete
 *   plugins.list|get|readFile|delete|install|update
 *   plugins.listMarketplace|addMarketplace|removeMarketplace|updateMarketplace
 *   plugins.readMarketplace|readMarketplaceFile
 *   agents.list|readFile
 *   hooks.list|save|delete
 */

import {
  OPERATION_SCOPES,
  hasAllScopes,
  type AuthScope,
  type ResourceProvider,
  type RpcErrorCode,
} from '@superone/shared/environment'
import type { HookSavePayload, MarketplaceScope } from '@superone/shared/agent-types'
import {
  addMarketplace,
  addProjectAdditionalDir,
  deleteHook,
  deleteManagedSkill,
  deleteMcpConfig,
  deletePlugin,
  discoverAllAgents,
  getManagedSkill,
  getSkillDirs,
  installManagedSkill,
  installPlugin,
  isPathAtOrWithinAllowed,
  listHooks,
  listManagedSkills,
  listMarketplacePlugins,
  listMcpConfigs,
  listPlugins,
  readAgentFile,
  readScopedAdditionalDirs,
  readManagedSkillFile,
  readMarketplacePluginContent,
  readMarketplacePluginFile,
  readPluginContent,
  readPluginFile,
  removeMarketplace,
  removeProjectAdditionalDir,
  saveHook,
  saveMcpConfig,
  toggleMcpConfig,
  updateMarketplace,
  updatePlugin,
} from '@superone/runtime/fs'
import type { AuthenticatedClient } from '../auth/auth-service'
import type { ProjectRegistry } from '../workspace/project-registry'

export interface ResourceRpcResult {
  result?: unknown
  error?: { code: RpcErrorCode; message: string; details?: Record<string, unknown> }
}

export interface ResourceRpcContext {
  client: AuthenticatedClient
  projects: ProjectRegistry
  /**
   * Override host home for skill/MCP user-scope paths (tests).
   * Production omits this so the node process home is used.
   */
  homeDir?: string
  codexHome?: string
  /** Optional harness catalog — enables plugins.list provider=codex. */
  harnesses?: import('../session/harness-manager').HarnessManager
  /** Optional provider store for Codex app-server auth env. */
  providers?: import('../provider/provider-store').ProviderStore
}

function requireScopes(client: AuthenticatedClient, scopes: readonly AuthScope[]): ResourceRpcResult | null {
  if (!hasAllScopes(client.scopes, scopes)) {
    return { error: { code: 'forbidden', message: `missing scopes: ${scopes.join(', ')}` } }
  }
  return null
}

function requireResourceWrite(
  client: AuthenticatedClient,
  scope: 'user' | 'project',
): ResourceRpcResult | null {
  const denied = requireScopes(client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  if (scope === 'user') return requireScopes(client, OPERATION_SCOPES.adminNode)
  return null
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

function mapThrown(err: unknown): ResourceRpcResult {
  const e = err as { code?: string; message?: string }
  const code = (e.code as RpcErrorCode | undefined) ?? 'internal'
  return { error: { code, message: e.message || 'internal error' } }
}

function projectRoot(projects: ProjectRegistry, projectId: string): string {
  const p = projects.get(projectId)
  if (!p) throw Object.assign(new Error('project not found'), { code: 'not_found' })
  return p.path
}

function parseProviderStrict(raw: unknown): ResourceProvider | null {
  return raw === 'claude' || raw === 'codex' ? raw : null
}

function parseScope(raw: unknown): 'user' | 'project' | null {
  if (raw === 'user' || raw === 'project') return raw
  return null
}

function manageOpts(ctx: ResourceRpcContext): { homeDir?: string; codexHome?: string } {
  return {
    ...(ctx.homeDir ? { homeDir: ctx.homeDir } : {}),
    ...(ctx.codexHome ? { codexHome: ctx.codexHome } : {}),
  }
}

export function handleSkillsList(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    ctx.projects.touch(projectId)
    return {
      result: {
        skills: listManagedSkills(provider, cwd, manageOpts(ctx)),
        provider,
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleSkillsGet(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    const name = String(p.name ?? '')
    if (!name) {
      return { error: { code: 'invalid_argument', message: 'name is required' } }
    }
    const sourcePath = typeof p.sourcePath === 'string' ? p.sourcePath : undefined
    ctx.projects.touch(projectId)
    return {
      result: {
        skill: getManagedSkill(provider, cwd, name, sourcePath, manageOpts(ctx)),
        provider,
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleSkillsReadFile(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    const skillName = String(p.skillName ?? '')
    const relativePath = String(p.relativePath ?? '')
    if (!skillName || !relativePath) {
      return {
        error: { code: 'invalid_argument', message: 'skillName and relativePath are required' },
      }
    }
    const sourcePath = typeof p.sourcePath === 'string' ? p.sourcePath : undefined
    const content = readManagedSkillFile(
      provider,
      cwd,
      skillName,
      relativePath,
      sourcePath,
      manageOpts(ctx),
    )
    if (content == null) {
      return { error: { code: 'not_found', message: 'skill file not found' } }
    }
    ctx.projects.touch(projectId)
    return { result: { content, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleSkillsDelete(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    const sourcePath = String(p.sourcePath ?? '')
    if (!sourcePath) {
      return { error: { code: 'invalid_argument', message: 'sourcePath is required' } }
    }
    const userRoots = getSkillDirs(provider, cwd, manageOpts(ctx))
      .filter((dir) => dir.scope === 'user' && !dir.readOnly && !dir.namePrefix)
      .map((dir) => dir.dir)
    if (isPathAtOrWithinAllowed(sourcePath, userRoots)) {
      const adminDenied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
      if (adminDenied) return adminDenied
    }
    deleteManagedSkill(provider, cwd, sourcePath, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleSkillsInstall(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    const scope = parseScope(p.scope)
    if (!scope) {
      return { error: { code: 'invalid_argument', message: 'scope must be user or project' } }
    }
    const denied = requireResourceWrite(ctx.client, scope)
    if (denied) return denied
    const name = String(p.name ?? '')
    const filesRaw = p.files
    if (!filesRaw || typeof filesRaw !== 'object' || Array.isArray(filesRaw)) {
      return { error: { code: 'invalid_argument', message: 'files object is required' } }
    }
    const files: Record<string, string> = {}
    for (const [k, v] of Object.entries(filesRaw as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        return { error: { code: 'invalid_argument', message: `files.${k} must be a string` } }
      }
      files[k] = v
    }
    const skill = installManagedSkill(provider, cwd, { scope, name, files }, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { skill, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleMcpList(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    if (p.provider !== 'claude' && p.provider !== 'codex') {
      return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    }
    const provider = p.provider as ResourceProvider
    ctx.projects.touch(projectId)
    const servers = listMcpConfigs(provider, cwd, manageOpts(ctx))
    // Environment variables and headers commonly contain API keys. Only node
    // administrators may read those values over the remote resource channel.
    const visibleServers = hasAllScopes(ctx.client.scopes, OPERATION_SCOPES.adminNode)
      ? servers
      : servers.map(({ env: _env, headers: _headers, ...server }) => server)
    return {
      result: {
        servers: visibleServers,
        provider,
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleAdditionalDirsList(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    ctx.projects.touch(projectId)
    return { result: readScopedAdditionalDirs(provider, cwd, manageOpts(ctx)) }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleAdditionalDirsAdd(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    const dir = typeof p.dir === 'string' ? p.dir.trim() : ''
    if (!dir) return { error: { code: 'invalid_argument', message: 'dir is required' } }
    addProjectAdditionalDir(provider, cwd, dir, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleAdditionalDirsRemove(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseProviderStrict(p.provider)
    if (!provider) return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    const dir = typeof p.dir === 'string' ? p.dir.trim() : ''
    if (!dir) return { error: { code: 'invalid_argument', message: 'dir is required' } }
    removeProjectAdditionalDir(provider, cwd, dir)
    ctx.projects.touch(projectId)
    return { result: { ok: true as const } }
  } catch (err) {
    return mapThrown(err)
  }
}

function parseMcpWriteConfig(raw: unknown): {
  ok: true
  config: Partial<{
    type: 'stdio' | 'http' | 'sse'
    command: string
    args: string[]
    env: Record<string, string>
    url: string
    headers: Record<string, string>
  }>
} | { ok: false; error: ResourceRpcResult } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error: { error: { code: 'invalid_argument', message: 'config object is required' } },
    }
  }
  const c = raw as Record<string, unknown>
  const config: {
    type?: 'stdio' | 'http' | 'sse'
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
  } = {}
  if (c.type === 'stdio' || c.type === 'http' || c.type === 'sse') {
    config.type = c.type
  }
  if (typeof c.command === 'string') config.command = c.command
  if (Array.isArray(c.args) && c.args.every((a) => typeof a === 'string')) {
    config.args = c.args as string[]
  }
  if (c.env && typeof c.env === 'object' && !Array.isArray(c.env)) {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.env as Record<string, unknown>)) {
      if (typeof v === 'string') env[k] = v
    }
    config.env = env
  }
  if (typeof c.url === 'string') config.url = c.url
  if (c.headers && typeof c.headers === 'object' && !Array.isArray(c.headers)) {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.headers as Record<string, unknown>)) {
      if (typeof v === 'string') headers[k] = v
    }
    config.headers = headers
  }
  return { ok: true, config }
}

export function handleMcpSave(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    if (p.provider !== 'claude' && p.provider !== 'codex') {
      return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    }
    const provider = p.provider as ResourceProvider
    const scope = parseScope(p.scope)
    if (!scope) {
      return { error: { code: 'invalid_argument', message: 'scope must be user or project' } }
    }
    const denied = requireResourceWrite(ctx.client, scope)
    if (denied) return denied
    const name = String(p.name ?? '')
    if (!name) {
      return { error: { code: 'invalid_argument', message: 'name is required' } }
    }
    const parsed = parseMcpWriteConfig(p.config)
    if (!parsed.ok) return parsed.error
    saveMcpConfig(provider, name, parsed.config, scope, cwd, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleMcpToggle(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    if (p.provider !== 'claude' && p.provider !== 'codex') {
      return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    }
    const provider = p.provider as ResourceProvider
    const scope = parseScope(p.scope)
    if (!scope) {
      return { error: { code: 'invalid_argument', message: 'scope must be user or project' } }
    }
    const denied = requireResourceWrite(ctx.client, scope)
    if (denied) return denied
    const name = String(p.name ?? '')
    if (!name) {
      return { error: { code: 'invalid_argument', message: 'name is required' } }
    }
    if (typeof p.disabled !== 'boolean') {
      return { error: { code: 'invalid_argument', message: 'disabled must be boolean' } }
    }
    toggleMcpConfig(provider, name, p.disabled, scope, cwd, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleMcpDelete(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    if (p.provider !== 'claude' && p.provider !== 'codex') {
      return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    }
    const provider = p.provider as ResourceProvider
    const scope = parseScope(p.scope)
    if (!scope) {
      return { error: { code: 'invalid_argument', message: 'scope must be user or project' } }
    }
    const denied = requireResourceWrite(ctx.client, scope)
    if (denied) return denied
    const name = String(p.name ?? '')
    if (!name) {
      return { error: { code: 'invalid_argument', message: 'name is required' } }
    }
    deleteMcpConfig(provider, name, scope, cwd, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

// --- Plugins (Claude; codex routes to app-server when harness/providers present) ---

function parseClaudeProvider(raw: unknown): ResourceProvider | null {
  if (raw === undefined || raw === null || raw === 'claude') return 'claude'
  if (raw === 'codex') return null // handled separately via codex admin surface
  return null
}

function isCodexProvider(raw: unknown): boolean {
  return raw === 'codex'
}

function parseMarketplaceScope(raw: unknown): MarketplaceScope | null {
  if (raw === 'user' || raw === 'project' || raw === 'local' || raw === 'official') return raw
  return null
}

export async function handlePluginsList(
  payload: unknown,
  ctx: ResourceRpcContext,
): Promise<ResourceRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    projectRoot(ctx.projects, projectId) // validates project exists
    if (isCodexProvider(p.provider)) {
      if (!ctx.harnesses) {
        return {
          error: {
            code: 'failed_precondition',
            message: 'codex plugins require harness catalog on node',
          },
        }
      }
      const { createCodexAdminService } = await import('../session/codex-admin-service')
      const svc = createCodexAdminService({
        harnesses: ctx.harnesses,
        providers: ctx.providers,
        resolveProjectPath: (id) => ctx.projects.get(id)?.path ?? null,
      })
      if (!svc.isBinaryReady()) {
        return {
          error: { code: 'failed_precondition', message: 'Codex binary not ready' },
        }
      }
      ctx.projects.touch(projectId)
      const plugins = await svc.listPlugins(projectId)
      return { result: { plugins, provider: 'codex' } }
    }
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseClaudeProvider(p.provider)
    if (!provider) {
      return { error: { code: 'invalid_argument', message: 'provider must be claude or codex' } }
    }
    ctx.projects.touch(projectId)
    return {
      result: {
        plugins: listPlugins(cwd, manageOpts(ctx)),
        provider,
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handlePluginsGet(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseClaudeProvider(p.provider)
    if (!provider) {
      return { error: { code: 'invalid_argument', message: 'provider must be claude' } }
    }
    const key = String(p.key ?? '')
    if (!key) return { error: { code: 'invalid_argument', message: 'key is required' } }
    ctx.projects.touch(projectId)
    return {
      result: {
        plugin: readPluginContent(cwd, key, manageOpts(ctx)),
        provider,
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handlePluginsReadFile(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseClaudeProvider(p.provider)
    if (!provider) {
      return { error: { code: 'invalid_argument', message: 'provider must be claude' } }
    }
    const pluginKey = String(p.pluginKey ?? p.key ?? '')
    const relativePath = String(p.relativePath ?? '')
    if (!pluginKey || !relativePath) {
      return {
        error: { code: 'invalid_argument', message: 'pluginKey and relativePath are required' },
      }
    }
    const content = readPluginFile(cwd, pluginKey, relativePath, manageOpts(ctx))
    if (content == null) {
      return { error: { code: 'not_found', message: 'plugin file not found' } }
    }
    ctx.projects.touch(projectId)
    return { result: { content, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handlePluginsDelete(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseClaudeProvider(p.provider)
    if (!provider) {
      return { error: { code: 'invalid_argument', message: 'provider must be claude' } }
    }
    const scope = parseScope(p.scope)
    if (!scope) {
      return { error: { code: 'invalid_argument', message: 'scope must be user or project' } }
    }
    const denied = requireResourceWrite(ctx.client, scope)
    if (denied) return denied
    const key = String(p.key ?? '')
    if (!key) return { error: { code: 'invalid_argument', message: 'key is required' } }
    deletePlugin(key, scope, cwd, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export async function handlePluginsInstall(
  payload: unknown,
  ctx: ResourceRpcContext,
): Promise<ResourceRpcResult> {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseClaudeProvider(p.provider)
    if (!provider) {
      return { error: { code: 'invalid_argument', message: 'provider must be claude' } }
    }
    const scope = parseScope(p.scope)
    if (!scope) {
      return { error: { code: 'invalid_argument', message: 'scope must be user or project' } }
    }
    const denied = requireResourceWrite(ctx.client, scope)
    if (denied) return denied
    const key = String(p.key ?? '')
    if (!key) return { error: { code: 'invalid_argument', message: 'key is required' } }
    await installPlugin(key, scope, cwd)
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handlePluginsUpdate(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseClaudeProvider(p.provider)
    if (!provider) {
      return { error: { code: 'invalid_argument', message: 'provider must be claude' } }
    }
    const scope = parseScope(p.scope)
    if (!scope) {
      return { error: { code: 'invalid_argument', message: 'scope must be user or project' } }
    }
    const denied = requireResourceWrite(ctx.client, scope)
    if (denied) return denied
    const key = String(p.key ?? '')
    if (!key) return { error: { code: 'invalid_argument', message: 'key is required' } }
    updatePlugin(key, scope, cwd, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handlePluginsListMarketplace(
  payload: unknown,
  ctx: ResourceRpcContext,
): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseClaudeProvider(p.provider)
    if (!provider) {
      return { error: { code: 'invalid_argument', message: 'provider must be claude' } }
    }
    ctx.projects.touch(projectId)
    return {
      result: {
        plugins: listMarketplacePlugins(cwd, manageOpts(ctx)),
        provider,
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

export async function handlePluginsAddMarketplace(
  payload: unknown,
  ctx: ResourceRpcContext,
): Promise<ResourceRpcResult> {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseClaudeProvider(p.provider)
    if (!provider) {
      return { error: { code: 'invalid_argument', message: 'provider must be claude' } }
    }
    const scope = parseScope(p.scope)
    if (!scope) {
      return { error: { code: 'invalid_argument', message: 'scope must be user or project' } }
    }
    const denied = requireResourceWrite(ctx.client, scope)
    if (denied) return denied
    const source = String(p.source ?? '')
    if (!source) return { error: { code: 'invalid_argument', message: 'source is required' } }
    await addMarketplace(source, scope, cwd)
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export async function handlePluginsRemoveMarketplace(
  payload: unknown,
  ctx: ResourceRpcContext,
): Promise<ResourceRpcResult> {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const provider = parseClaudeProvider(p.provider)
    if (!provider) {
      return { error: { code: 'invalid_argument', message: 'provider must be claude' } }
    }
    const scope = parseMarketplaceScope(p.scope)
    if (!scope) {
      return {
        error: {
          code: 'invalid_argument',
          message: 'scope must be user, project, local, or official',
        },
      }
    }
    if (scope === 'user') {
      const adminDenied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
      if (adminDenied) return adminDenied
    }
    const name = String(p.name ?? '')
    if (!name) return { error: { code: 'invalid_argument', message: 'name is required' } }
    await removeMarketplace(name, scope, cwd, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export async function handlePluginsUpdateMarketplace(
  payload: unknown,
  ctx: ResourceRpcContext,
): Promise<ResourceRpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (denied) return denied
  // Marketplace cache lives under node home → require admin.
  const adminDenied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
  if (adminDenied) return adminDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    if (projectId) {
      projectRoot(ctx.projects, projectId)
      ctx.projects.touch(projectId)
    }
    const provider = parseClaudeProvider(p.provider)
    if (!provider) {
      return { error: { code: 'invalid_argument', message: 'provider must be claude' } }
    }
    const name = String(p.name ?? '')
    if (!name) return { error: { code: 'invalid_argument', message: 'name is required' } }
    await updateMarketplace(name)
    return { result: { ok: true as const, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handlePluginsReadMarketplace(
  payload: unknown,
  ctx: ResourceRpcContext,
): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    if (projectId) {
      projectRoot(ctx.projects, projectId)
      ctx.projects.touch(projectId)
    }
    const provider = parseClaudeProvider(p.provider)
    if (!provider) {
      return { error: { code: 'invalid_argument', message: 'provider must be claude' } }
    }
    const marketplace = String(p.marketplace ?? '')
    const name = String(p.name ?? '')
    if (!marketplace || !name) {
      return {
        error: { code: 'invalid_argument', message: 'marketplace and name are required' },
      }
    }
    return {
      result: {
        plugin: readMarketplacePluginContent(marketplace, name, manageOpts(ctx)),
        provider,
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handlePluginsReadMarketplaceFile(
  payload: unknown,
  ctx: ResourceRpcContext,
): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    if (projectId) {
      projectRoot(ctx.projects, projectId)
      ctx.projects.touch(projectId)
    }
    const provider = parseClaudeProvider(p.provider)
    if (!provider) {
      return { error: { code: 'invalid_argument', message: 'provider must be claude' } }
    }
    const marketplace = String(p.marketplace ?? '')
    const name = String(p.name ?? '')
    const relativePath = String(p.relativePath ?? '')
    if (!marketplace || !name || !relativePath) {
      return {
        error: {
          code: 'invalid_argument',
          message: 'marketplace, name, and relativePath are required',
        },
      }
    }
    const content = readMarketplacePluginFile(marketplace, name, relativePath, manageOpts(ctx))
    if (content == null) {
      return { error: { code: 'not_found', message: 'marketplace plugin file not found' } }
    }
    return { result: { content, provider } }
  } catch (err) {
    return mapThrown(err)
  }
}

// --- Agents ---

export function handleAgentsList(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    ctx.projects.touch(projectId)
    return {
      result: {
        agents: discoverAllAgents(cwd, manageOpts(ctx)),
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleAgentsReadFile(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const name = String(p.name ?? '')
    if (!name) return { error: { code: 'invalid_argument', message: 'name is required' } }
    ctx.projects.touch(projectId)
    return {
      result: {
        content: readAgentFile(cwd, name, manageOpts(ctx)),
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

// --- Hooks ---

function parseHookSavePayload(raw: unknown): HookSavePayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const p = raw as Record<string, unknown>
  if (p.scope !== 'user' && p.scope !== 'project' && p.scope !== 'local') return null
  if (typeof p.event !== 'string' || !p.event) return null
  if (!p.entry || typeof p.entry !== 'object' || Array.isArray(p.entry)) return null
  return {
    scope: p.scope,
    event: p.event as HookSavePayload['event'],
    matcher: typeof p.matcher === 'string' ? p.matcher : undefined,
    entry: p.entry as HookSavePayload['entry'],
  }
}

export function handleHooksList(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    ctx.projects.touch(projectId)
    return { result: { hooks: listHooks(cwd, manageOpts(ctx)) } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleHooksSave(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const hookPayload = parseHookSavePayload(p.payload)
    if (!hookPayload) {
      return {
        error: {
          code: 'invalid_argument',
          message: 'payload with scope, event, and entry is required',
        },
      }
    }
    if (hookPayload.scope === 'user') {
      const adminDenied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
      if (adminDenied) return adminDenied
    }
    const replaceId = typeof p.replaceId === 'string' ? p.replaceId : undefined
    saveHook(cwd, hookPayload, replaceId, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const } }
  } catch (err) {
    return mapThrown(err)
  }
}

export function handleHooksDelete(payload: unknown, ctx: ResourceRpcContext): ResourceRpcResult {
  const baseDenied = requireScopes(ctx.client, OPERATION_SCOPES.writeWorkspace)
  if (baseDenied) return baseDenied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectRoot(ctx.projects, projectId)
    const id = String(p.id ?? '')
    if (!id) return { error: { code: 'invalid_argument', message: 'id is required' } }
    if (id.startsWith('user:')) {
      const adminDenied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
      if (adminDenied) return adminDenied
    }
    deleteHook(cwd, id, manageOpts(ctx))
    ctx.projects.touch(projectId)
    return { result: { ok: true as const } }
  } catch (err) {
    return mapThrown(err)
  }
}

/** Route skills.* / mcp.* / plugins.* / agents.* / hooks.* methods. */
export function dispatchResourceRpc(
  method: string,
  payload: unknown,
  ctx: ResourceRpcContext,
): ResourceRpcResult | Promise<ResourceRpcResult> | null {
  switch (method) {
    case 'skills.list':
      return handleSkillsList(payload, ctx)
    case 'skills.get':
      return handleSkillsGet(payload, ctx)
    case 'skills.readFile':
      return handleSkillsReadFile(payload, ctx)
    case 'skills.delete':
      return handleSkillsDelete(payload, ctx)
    case 'skills.install':
      return handleSkillsInstall(payload, ctx)
    case 'mcp.list':
      return handleMcpList(payload, ctx)
    case 'mcp.save':
      return handleMcpSave(payload, ctx)
    case 'mcp.toggle':
      return handleMcpToggle(payload, ctx)
    case 'mcp.delete':
      return handleMcpDelete(payload, ctx)
    case 'additionalDirs.list':
      return handleAdditionalDirsList(payload, ctx)
    case 'additionalDirs.add':
      return handleAdditionalDirsAdd(payload, ctx)
    case 'additionalDirs.remove':
      return handleAdditionalDirsRemove(payload, ctx)
    case 'plugins.list':
      return handlePluginsList(payload, ctx)
    case 'plugins.get':
      return handlePluginsGet(payload, ctx)
    case 'plugins.readFile':
      return handlePluginsReadFile(payload, ctx)
    case 'plugins.delete':
      return handlePluginsDelete(payload, ctx)
    case 'plugins.install':
      return handlePluginsInstall(payload, ctx)
    case 'plugins.update':
      return handlePluginsUpdate(payload, ctx)
    case 'plugins.listMarketplace':
      return handlePluginsListMarketplace(payload, ctx)
    case 'plugins.addMarketplace':
      return handlePluginsAddMarketplace(payload, ctx)
    case 'plugins.removeMarketplace':
      return handlePluginsRemoveMarketplace(payload, ctx)
    case 'plugins.updateMarketplace':
      return handlePluginsUpdateMarketplace(payload, ctx)
    case 'plugins.readMarketplace':
      return handlePluginsReadMarketplace(payload, ctx)
    case 'plugins.readMarketplaceFile':
      return handlePluginsReadMarketplaceFile(payload, ctx)
    case 'agents.list':
      return handleAgentsList(payload, ctx)
    case 'agents.readFile':
      return handleAgentsReadFile(payload, ctx)
    case 'hooks.list':
      return handleHooksList(payload, ctx)
    case 'hooks.save':
      return handleHooksSave(payload, ctx)
    case 'hooks.delete':
      return handleHooksDelete(payload, ctx)
    default:
      return null
  }
}

export const RESOURCE_MUTATING_METHODS = [
  'skills.delete',
  'skills.install',
  'mcp.save',
  'mcp.toggle',
  'mcp.delete',
  'plugins.delete',
  'plugins.install',
  'plugins.update',
  'plugins.addMarketplace',
  'plugins.removeMarketplace',
  'plugins.updateMarketplace',
  'hooks.save',
  'hooks.delete',
] as const
