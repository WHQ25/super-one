/**
 * Harness resources on this host's disk, managed the way its own settings
 * manage them: `skills.*`, `mcp.*`, `plugins.*`, `agents.*`, `hooks.*`.
 *
 * Reads need `workspace:read`; writes need `workspace:write`, and a write to
 * the host user's own config (user scope) needs `node:admin` as well. MCP env
 * and header values leave the host masked; a save that sends a masked value
 * back keeps the stored secret.
 */

import {
  OPERATION_SCOPES,
  type AuthScope,
  type ResourceProvider,
} from '@superone/shared/environment'
import type { HookSavePayload, MarketplaceScope, McpServerConfig } from '@superone/shared/agent-types'
import { maskSecret } from '@superone/shared/secret-mask'
import {
  addMarketplace,
  deleteHook,
  deleteManagedSkill,
  deleteMcpConfig,
  deletePlugin,
  setPluginEnabled,
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
  readManagedSkillFile,
  readMarketplacePluginContent,
  readMarketplacePluginFile,
  readPluginContent,
  readPluginFile,
  removeMarketplace,
  saveHook,
  saveMcpConfig,
  toggleMcpConfig,
  updateMarketplace,
  updatePlugin,
  type McpWriteFields,
} from '../fs/index'
import type { AuthenticatedClient } from './auth-service'
import type { RpcResult } from './rpc-context'
import { asRecord, mapThrown, requireScopes } from './rpc-helpers'

/** The projects resource methods address, by id. */
export interface ResourceProjects {
  get(projectId: string): { path: string } | null
  /** Record that a client used the project; hosts that keep recency elsewhere leave it out. */
  touch?(projectId: string): void
}

/**
 * What a host adds to the resource files: its shell, live sessions and Codex.
 * Change hooks run after the change is on disk and handle their own failures.
 */
export interface ResourceHost {
  /** Override the host home for user-scope paths (tests). */
  homeDir?: string
  codexHome?: string
  /** Resolves once commands that run a bare `claude` can find it on PATH. */
  shellReady?(): Promise<void>
  /** Installed Codex plugins, from the host's Codex app-server (`plugins.list` provider codex). */
  listCodexPlugins?(project: { projectId: string; path: string }): Promise<unknown>
  /** Installed Claude plugins changed on disk; a live Claude process loads them once. */
  pluginsChanged?(projectPath: string): void | Promise<void>
  /** An MCP server's config changed on disk; `enabled` is its state now (false once deleted). */
  mcpChanged?(change: McpChange): void | Promise<void>
}

export interface McpChange {
  provider: ResourceProvider
  projectPath: string
  name: string
  enabled: boolean
  /** Saved: the server's launch config may differ, so a running one reconnects. */
  saved: boolean
}

export interface ResourceRpcContext extends ResourceHost {
  client: AuthenticatedClient
  projects: ResourceProjects
}

type Payload = Record<string, unknown>
type Project = { projectId: string; cwd: string }

function invalid(message: string): RpcResult {
  return { error: { code: 'invalid_argument', message } }
}

function requireResourceWrite(client: AuthenticatedClient, scope: 'user' | 'project'): RpcResult | null {
  return requireScopes(client, OPERATION_SCOPES.writeWorkspace)
    ?? (scope === 'user' ? requireScopes(client, OPERATION_SCOPES.adminNode) : null)
}

function projectRoot(ctx: ResourceRpcContext, projectId: string): string {
  const project = ctx.projects.get(projectId)
  if (!project) throw Object.assign(new Error('project not found'), { code: 'not_found' })
  return project.path
}

function parseProvider(raw: unknown): ResourceProvider | null {
  return raw === 'claude' || raw === 'codex' ? raw : null
}

/** MCP config also covers dsh, which keeps its own profile patch layer. */
function parseMcpProvider(raw: unknown): ResourceProvider | null {
  return raw === 'claude' || raw === 'codex' || raw === 'dsh' ? raw : null
}

/** Plugins and marketplaces are Claude's; Codex lists through its app-server. */
function parseClaudeProvider(raw: unknown): 'claude' | null {
  return raw === undefined || raw === null || raw === 'claude' ? 'claude' : null
}

function parseScope(raw: unknown): 'user' | 'project' | null {
  return raw === 'user' || raw === 'project' ? raw : null
}

function parseMarketplaceScope(raw: unknown): MarketplaceScope | null {
  return raw === 'user' || raw === 'project' || raw === 'local' || raw === 'official' ? raw : null
}

function manageOpts(ctx: ResourceRpcContext): { homeDir?: string; codexHome?: string } {
  return {
    ...(ctx.homeDir ? { homeDir: ctx.homeDir } : {}),
    ...(ctx.codexHome ? { codexHome: ctx.codexHome } : {}),
  }
}

function stringRecord(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

function parseMcpWriteConfig(raw: unknown): McpWriteFields | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const c = raw as Record<string, unknown>
  const config: McpWriteFields = {}
  if (c.type === 'stdio' || c.type === 'http' || c.type === 'sse') config.type = c.type
  if (typeof c.command === 'string') config.command = c.command
  if (Array.isArray(c.args) && c.args.every((a) => typeof a === 'string')) config.args = c.args as string[]
  const env = stringRecord(c.env)
  if (env) config.env = env
  if (typeof c.url === 'string') config.url = c.url
  const headers = stringRecord(c.headers)
  if (headers) config.headers = headers
  if (typeof c.bearerTokenFile === 'string' && c.bearerTokenFile) config.bearerTokenFile = c.bearerTokenFile
  return config
}

function maskValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, maskSecret(value)]))
}

/** A server as it leaves the host: env and header values masked. */
export function maskMcpServer(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    ...(server.env ? { env: maskValues(server.env) } : {}),
    ...(server.headers ? { headers: maskValues(server.headers) } : {}),
  }
}

function restoreValues(values: Record<string, string>, stored: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => {
    const secret = stored?.[key]
    return [key, secret !== undefined && value === maskSecret(secret) ? secret : value]
  }))
}

/**
 * A save as the client meant it: every value it sent back still masked
 * becomes the stored secret it was masked from. `stored` is the server the
 * client was shown (the listing merges scopes by name).
 */
export function restoreMaskedMcpSecrets(config: McpWriteFields, stored: McpServerConfig | undefined): McpWriteFields {
  if (!stored) return config
  return {
    ...config,
    ...(config.env ? { env: restoreValues(config.env, stored.env) } : {}),
    ...(config.headers ? { headers: restoreValues(config.headers, stored.headers) } : {}),
  }
}

interface ResourceMethod {
  scopes: readonly AuthScope[]
  /** Marketplace methods are not about a project; a payload may leave it out. */
  projectOptional?: true
  run(p: Payload, ctx: ResourceRpcContext, project: Project): RpcResult | Promise<RpcResult>
}

const READ = OPERATION_SCOPES.readWorkspace
const WRITE = OPERATION_SCOPES.writeWorkspace

const RESOURCE_METHODS: Readonly<Record<string, ResourceMethod>> = {
  'skills.list': {
    scopes: READ,
    run: (p, ctx, { cwd }) => {
      const provider = parseProvider(p.provider)
      if (!provider) return invalid('provider must be claude or codex')
      return { result: { skills: listManagedSkills(provider, cwd, manageOpts(ctx)), provider } }
    },
  },
  'skills.get': {
    scopes: READ,
    run: (p, ctx, { cwd }) => {
      const provider = parseProvider(p.provider)
      if (!provider) return invalid('provider must be claude or codex')
      const name = String(p.name ?? '')
      if (!name) return invalid('name is required')
      const sourcePath = typeof p.sourcePath === 'string' ? p.sourcePath : undefined
      return { result: { skill: getManagedSkill(provider, cwd, name, sourcePath, manageOpts(ctx)), provider } }
    },
  },
  'skills.readFile': {
    scopes: READ,
    run: (p, ctx, { cwd }) => {
      const provider = parseProvider(p.provider)
      if (!provider) return invalid('provider must be claude or codex')
      const skillName = String(p.skillName ?? '')
      const relativePath = String(p.relativePath ?? '')
      if (!skillName || !relativePath) return invalid('skillName and relativePath are required')
      const sourcePath = typeof p.sourcePath === 'string' ? p.sourcePath : undefined
      const content = readManagedSkillFile(provider, cwd, skillName, relativePath, sourcePath, manageOpts(ctx))
      if (content == null) return { error: { code: 'not_found', message: 'skill file not found' } }
      return { result: { content, provider } }
    },
  },
  'skills.delete': {
    scopes: WRITE,
    run: (p, ctx, { cwd }) => {
      const provider = parseProvider(p.provider)
      if (!provider) return invalid('provider must be claude or codex')
      const sourcePath = String(p.sourcePath ?? '')
      if (!sourcePath) return invalid('sourcePath is required')
      const userRoots = getSkillDirs(provider, cwd, manageOpts(ctx))
        .filter((dir) => dir.scope === 'user' && !dir.readOnly && !dir.namePrefix)
        .map((dir) => dir.dir)
      if (isPathAtOrWithinAllowed(sourcePath, userRoots)) {
        const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
        if (denied) return denied
      }
      deleteManagedSkill(provider, cwd, sourcePath, manageOpts(ctx))
      return { result: { ok: true as const, provider } }
    },
  },
  'skills.install': {
    scopes: WRITE,
    run: (p, ctx, { cwd }) => {
      const provider = parseProvider(p.provider)
      if (!provider) return invalid('provider must be claude or codex')
      const scope = parseScope(p.scope)
      if (!scope) return invalid('scope must be user or project')
      const denied = requireResourceWrite(ctx.client, scope)
      if (denied) return denied
      const filesRaw = p.files
      if (!filesRaw || typeof filesRaw !== 'object' || Array.isArray(filesRaw)) return invalid('files object is required')
      const files: Record<string, string> = {}
      for (const [k, v] of Object.entries(filesRaw as Record<string, unknown>)) {
        if (typeof v !== 'string') return invalid(`files.${k} must be a string`)
        files[k] = v
      }
      const skill = installManagedSkill(provider, cwd, { scope, name: String(p.name ?? ''), files }, manageOpts(ctx))
      return { result: { skill, provider } }
    },
  },

  'mcp.list': {
    scopes: READ,
    run: (p, ctx, { cwd }) => {
      const provider = parseMcpProvider(p.provider)
      if (!provider) return invalid('provider must be claude, codex or dsh')
      return { result: { servers: listMcpConfigs(provider, cwd, manageOpts(ctx)).map(maskMcpServer), provider } }
    },
  },
  'mcp.save': {
    scopes: WRITE,
    run: async (p, ctx, { cwd }) => {
      const provider = parseMcpProvider(p.provider)
      if (!provider) return invalid('provider must be claude, codex or dsh')
      const scope = parseScope(p.scope)
      if (!scope) return invalid('scope must be user or project')
      const denied = requireResourceWrite(ctx.client, scope)
      if (denied) return denied
      const name = String(p.name ?? '')
      if (!name) return invalid('name is required')
      const config = parseMcpWriteConfig(p.config)
      if (!config) return invalid('config object is required')
      const shown = listMcpConfigs(provider, cwd, manageOpts(ctx)).find((server) => server.name === name)
      saveMcpConfig(provider, name, restoreMaskedMcpSecrets(config, shown), scope, cwd, manageOpts(ctx))
      await ctx.mcpChanged?.({ provider, projectPath: cwd, name, enabled: true, saved: true })
      return { result: { ok: true as const, provider } }
    },
  },
  'mcp.toggle': {
    scopes: WRITE,
    run: async (p, ctx, { cwd }) => {
      const provider = parseMcpProvider(p.provider)
      if (!provider) return invalid('provider must be claude, codex or dsh')
      const scope = parseScope(p.scope)
      if (!scope) return invalid('scope must be user or project')
      const denied = requireResourceWrite(ctx.client, scope)
      if (denied) return denied
      const name = String(p.name ?? '')
      if (!name) return invalid('name is required')
      if (typeof p.disabled !== 'boolean') return invalid('disabled must be boolean')
      toggleMcpConfig(provider, name, p.disabled, scope, cwd, manageOpts(ctx))
      await ctx.mcpChanged?.({ provider, projectPath: cwd, name, enabled: !p.disabled, saved: false })
      return { result: { ok: true as const, provider } }
    },
  },
  'mcp.delete': {
    scopes: WRITE,
    run: async (p, ctx, { cwd }) => {
      const provider = parseMcpProvider(p.provider)
      if (!provider) return invalid('provider must be claude, codex or dsh')
      const scope = parseScope(p.scope)
      if (!scope) return invalid('scope must be user or project')
      const denied = requireResourceWrite(ctx.client, scope)
      if (denied) return denied
      const name = String(p.name ?? '')
      if (!name) return invalid('name is required')
      deleteMcpConfig(provider, name, scope, cwd, manageOpts(ctx))
      await ctx.mcpChanged?.({ provider, projectPath: cwd, name, enabled: false, saved: false })
      return { result: { ok: true as const, provider } }
    },
  },

  'plugins.list': {
    scopes: READ,
    run: async (p, ctx, { projectId, cwd }) => {
      if (p.provider === 'codex') {
        if (!ctx.listCodexPlugins) {
          return { error: { code: 'failed_precondition', message: 'codex plugins require harness catalog on node' } }
        }
        return { result: { plugins: await ctx.listCodexPlugins({ projectId, path: cwd }), provider: 'codex' } }
      }
      const provider = parseClaudeProvider(p.provider)
      if (!provider) return invalid('provider must be claude or codex')
      return { result: { plugins: listPlugins(cwd, manageOpts(ctx)), provider } }
    },
  },
  'plugins.get': {
    scopes: READ,
    run: (p, ctx, { cwd }) => {
      const provider = parseClaudeProvider(p.provider)
      if (!provider) return invalid('provider must be claude')
      const key = String(p.key ?? '')
      if (!key) return invalid('key is required')
      return { result: { plugin: readPluginContent(cwd, key, manageOpts(ctx)), provider } }
    },
  },
  'plugins.readFile': {
    scopes: READ,
    run: (p, ctx, { cwd }) => {
      const provider = parseClaudeProvider(p.provider)
      if (!provider) return invalid('provider must be claude')
      const pluginKey = String(p.pluginKey ?? p.key ?? '')
      const relativePath = String(p.relativePath ?? '')
      if (!pluginKey || !relativePath) return invalid('pluginKey and relativePath are required')
      const content = readPluginFile(cwd, pluginKey, relativePath, manageOpts(ctx))
      if (content == null) return { error: { code: 'not_found', message: 'plugin file not found' } }
      return { result: { content, provider } }
    },
  },
  'plugins.delete': pluginWrite((key, scope, cwd, ctx) => deletePlugin(key, scope, cwd, manageOpts(ctx))),
  'plugins.setEnabled': {
    scopes: WRITE,
    run: async (p, ctx, { cwd }) => {
      const provider = parseClaudeProvider(p.provider)
      if (!provider) return invalid('provider must be claude')
      const scope = parseScope(p.scope)
      if (!scope) return invalid('scope must be user or project')
      const denied = requireResourceWrite(ctx.client, scope)
      if (denied) return denied
      const key = String(p.key ?? '')
      if (!key || typeof p.enabled !== 'boolean') return invalid('key and enabled are required')
      setPluginEnabled(cwd, key, scope, p.enabled, manageOpts(ctx))
      await ctx.pluginsChanged?.(cwd)
      return { result: { ok: true as const, provider } }
    },
  },
  'plugins.install': pluginWrite(async (key, scope, cwd, ctx) => {
    await ctx.shellReady?.()
    await installPlugin(key, scope, cwd)
  }),
  'plugins.update': pluginWrite((key, scope, cwd, ctx) => updatePlugin(key, scope, cwd, manageOpts(ctx))),
  'plugins.listMarketplace': {
    scopes: READ,
    run: (p, ctx, { cwd }) => {
      const provider = parseClaudeProvider(p.provider)
      if (!provider) return invalid('provider must be claude')
      return { result: { plugins: listMarketplacePlugins(cwd, manageOpts(ctx)), provider } }
    },
  },
  'plugins.addMarketplace': {
    scopes: WRITE,
    run: async (p, ctx, { cwd }) => {
      const provider = parseClaudeProvider(p.provider)
      if (!provider) return invalid('provider must be claude')
      const scope = parseScope(p.scope)
      if (!scope) return invalid('scope must be user or project')
      const denied = requireResourceWrite(ctx.client, scope)
      if (denied) return denied
      const source = String(p.source ?? '')
      if (!source) return invalid('source is required')
      await ctx.shellReady?.()
      await addMarketplace(source, scope, cwd)
      return { result: { ok: true as const, provider } }
    },
  },
  'plugins.removeMarketplace': {
    scopes: WRITE,
    run: async (p, ctx, { cwd }) => {
      const provider = parseClaudeProvider(p.provider)
      if (!provider) return invalid('provider must be claude')
      const scope = parseMarketplaceScope(p.scope)
      if (!scope) return invalid('scope must be user, project, local, or official')
      if (scope === 'user') {
        const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
        if (denied) return denied
      }
      const name = String(p.name ?? '')
      if (!name) return invalid('name is required')
      await ctx.shellReady?.()
      await removeMarketplace(name, scope, cwd, manageOpts(ctx))
      return { result: { ok: true as const, provider } }
    },
  },
  'plugins.updateMarketplace': {
    // The marketplace cache lives under the host home.
    scopes: [...WRITE, ...OPERATION_SCOPES.adminNode],
    projectOptional: true,
    run: async (p, ctx) => {
      const provider = parseClaudeProvider(p.provider)
      if (!provider) return invalid('provider must be claude')
      const name = String(p.name ?? '')
      if (!name) return invalid('name is required')
      await ctx.shellReady?.()
      await updateMarketplace(name)
      return { result: { ok: true as const, provider } }
    },
  },
  'plugins.readMarketplace': {
    scopes: READ,
    projectOptional: true,
    run: (p, ctx) => {
      const provider = parseClaudeProvider(p.provider)
      if (!provider) return invalid('provider must be claude')
      const marketplace = String(p.marketplace ?? '')
      const name = String(p.name ?? '')
      if (!marketplace || !name) return invalid('marketplace and name are required')
      return { result: { plugin: readMarketplacePluginContent(marketplace, name, manageOpts(ctx)), provider } }
    },
  },
  'plugins.readMarketplaceFile': {
    scopes: READ,
    projectOptional: true,
    run: (p, ctx) => {
      const provider = parseClaudeProvider(p.provider)
      if (!provider) return invalid('provider must be claude')
      const marketplace = String(p.marketplace ?? '')
      const name = String(p.name ?? '')
      const relativePath = String(p.relativePath ?? '')
      if (!marketplace || !name || !relativePath) return invalid('marketplace, name, and relativePath are required')
      const content = readMarketplacePluginFile(marketplace, name, relativePath, manageOpts(ctx))
      if (content == null) return { error: { code: 'not_found', message: 'marketplace plugin file not found' } }
      return { result: { content, provider } }
    },
  },

  'agents.list': {
    scopes: READ,
    run: (_p, ctx, { cwd }) => ({ result: { agents: discoverAllAgents(cwd, manageOpts(ctx)) } }),
  },
  'agents.readFile': {
    scopes: READ,
    run: (p, ctx, { cwd }) => {
      const name = String(p.name ?? '')
      if (!name) return invalid('name is required')
      return { result: { content: readAgentFile(cwd, name, manageOpts(ctx)) } }
    },
  },

  'hooks.list': {
    scopes: READ,
    run: (_p, ctx, { cwd }) => ({ result: { hooks: listHooks(cwd, manageOpts(ctx)) } }),
  },
  'hooks.save': {
    scopes: WRITE,
    run: (p, ctx, { cwd }) => {
      const hook = parseHookSavePayload(p.payload)
      if (!hook) return invalid('payload with scope, event, and entry is required')
      if (hook.scope === 'user') {
        const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
        if (denied) return denied
      }
      saveHook(cwd, hook, typeof p.replaceId === 'string' ? p.replaceId : undefined, manageOpts(ctx))
      return { result: { ok: true as const } }
    },
  },
  'hooks.delete': {
    scopes: WRITE,
    run: (p, ctx, { cwd }) => {
      const id = String(p.id ?? '')
      if (!id) return invalid('id is required')
      if (id.startsWith('user:')) {
        const denied = requireScopes(ctx.client, OPERATION_SCOPES.adminNode)
        if (denied) return denied
      }
      deleteHook(cwd, id, manageOpts(ctx))
      return { result: { ok: true as const } }
    },
  },
}

/** A write to one installed Claude plugin: delete, install, update. */
function pluginWrite(
  write: (key: string, scope: 'user' | 'project', cwd: string, ctx: ResourceRpcContext) => void | Promise<void>,
): ResourceMethod {
  return {
    scopes: WRITE,
    run: async (p, ctx, { cwd }) => {
      const provider = parseClaudeProvider(p.provider)
      if (!provider) return invalid('provider must be claude')
      const scope = parseScope(p.scope)
      if (!scope) return invalid('scope must be user or project')
      const denied = requireResourceWrite(ctx.client, scope)
      if (denied) return denied
      const key = String(p.key ?? '')
      if (!key) return invalid('key is required')
      await write(key, scope, cwd, ctx)
      await ctx.pluginsChanged?.(cwd)
      return { result: { ok: true as const, provider } }
    },
  }
}

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

/** Every method of the resource families. */
export const RESOURCE_RPC_METHODS: ReadonlySet<string> = new Set(Object.keys(RESOURCE_METHODS))

/** Serve one resource method; null when the method is not one of them. */
export async function dispatchResourceRpc(method: string, payload: unknown, ctx: ResourceRpcContext): Promise<RpcResult | null> {
  const spec = Object.hasOwn(RESOURCE_METHODS, method) ? RESOURCE_METHODS[method] : undefined
  if (!spec) return null
  const denied = requireScopes(ctx.client, spec.scopes)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const projectId = String(p.projectId ?? '')
    const cwd = projectId || !spec.projectOptional ? projectRoot(ctx, projectId) : ''
    const result = await spec.run(p, ctx, { projectId, cwd })
    if (projectId && !result.error) ctx.projects.touch?.(projectId)
    return result
  } catch (err) {
    return mapThrown(err)
  }
}
