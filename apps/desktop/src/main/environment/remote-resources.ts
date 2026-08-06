/**
 * Remote Skills / MCP / plugins / hooks management via node RPC.
 *
 * Desktop settings for a remote project (`remote:<connectionId>:<path>`) must
 * not touch local FS — route through {@link RemoteEnvironmentGateway}.
 */

import type {
  HookConfig,
  HookSavePayload,
  McpServerConfig,
  PluginInfo,
  ResourceScope,
  SkillDetail,
  SkillInfo,
} from '@superone/shared/agent-types'
import type { ResourceProvider } from '@superone/shared/environment'
import type { EnvironmentHost } from './environment-host'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'
import { resolveRemoteProjectContext } from './remote-file-tree'

export interface RemoteResourceContext {
  connectionId: string
  environmentId: string
  projectId: string
  hostPath: string
}

function asRemoteGw(host: EnvironmentHost, environmentId: string): RemoteEnvironmentGateway | null {
  const gw = host.getGateway(environmentId)
  return gw instanceof RemoteEnvironmentGateway ? gw : null
}

export async function resolveRemoteResourceContext(
  host: EnvironmentHost,
  folderPath: string,
): Promise<RemoteResourceContext | null> {
  return resolveRemoteProjectContext(host, folderPath, { registerIfMissing: true })
}

function unwrapServers(result: unknown): McpServerConfig[] {
  if (!result || typeof result !== 'object') return []
  const servers = (result as { servers?: unknown }).servers
  return Array.isArray(servers) ? (servers as McpServerConfig[]) : []
}

function unwrapSkills(result: unknown): SkillInfo[] {
  if (!result || typeof result !== 'object') return []
  const skills = (result as { skills?: unknown }).skills
  return Array.isArray(skills) ? (skills as SkillInfo[]) : []
}

export async function listRemoteManagedSkills(
  host: EnvironmentHost,
  folderPath: string,
  provider: ResourceProvider = 'claude',
): Promise<SkillInfo[] | null> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return []
  try {
    const result = await gw.skillsList(ctx.projectId, provider)
    return unwrapSkills(result)
  } catch {
    return []
  }
}

export async function getRemoteManagedSkill(
  host: EnvironmentHost,
  folderPath: string,
  name: string,
  opts?: { sourcePath?: string; provider?: ResourceProvider },
): Promise<SkillDetail | null> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return null
  try {
    const result = (await gw.skillsGet(ctx.projectId, name, {
      sourcePath: opts?.sourcePath,
      provider: opts?.provider ?? 'claude',
    })) as { skill?: SkillDetail | null }
    return result?.skill ?? null
  } catch {
    return null
  }
}

export async function readRemoteManagedSkillFile(
  host: EnvironmentHost,
  folderPath: string,
  skillName: string,
  relativePath: string,
  opts?: { sourcePath?: string; provider?: ResourceProvider },
): Promise<string | null> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return null
  try {
    const result = (await gw.skillsReadFile(ctx.projectId, skillName, relativePath, {
      sourcePath: opts?.sourcePath,
      provider: opts?.provider ?? 'claude',
    })) as { content?: string }
    return typeof result?.content === 'string' ? result.content : null
  } catch {
    return null
  }
}

export async function deleteRemoteManagedSkill(
  host: EnvironmentHost,
  folderPath: string,
  sourcePath: string,
  provider: ResourceProvider = 'claude',
): Promise<boolean> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return false
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return false
  await gw.skillsDelete(ctx.projectId, sourcePath, provider)
  return true
}

export async function listRemoteManagedMcp(
  host: EnvironmentHost,
  folderPath: string,
  provider: ResourceProvider,
): Promise<McpServerConfig[] | null> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return []
  try {
    const result = await gw.mcpList(ctx.projectId, provider)
    return unwrapServers(result)
  } catch {
    return []
  }
}

export async function saveRemoteManagedMcp(
  host: EnvironmentHost,
  folderPath: string,
  input: {
    provider: ResourceProvider
    name: string
    scope: Extract<ResourceScope, 'user' | 'project'>
    config: Record<string, unknown>
  },
): Promise<boolean> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return false
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return false
  await gw.mcpSave(ctx.projectId, input)
  return true
}

export async function toggleRemoteManagedMcp(
  host: EnvironmentHost,
  folderPath: string,
  input: {
    provider: ResourceProvider
    name: string
    scope: Extract<ResourceScope, 'user' | 'project'>
    disabled: boolean
  },
): Promise<boolean> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return false
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return false
  await gw.mcpToggle(ctx.projectId, input)
  return true
}

export async function deleteRemoteManagedMcp(
  host: EnvironmentHost,
  folderPath: string,
  input: {
    provider: ResourceProvider
    name: string
    scope: Extract<ResourceScope, 'user' | 'project'>
  },
): Promise<boolean> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return false
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return false
  await gw.mcpDelete(ctx.projectId, input)
  return true
}

function unwrapPlugins(result: unknown): PluginInfo[] {
  if (!result || typeof result !== 'object') return []
  const plugins = (result as { plugins?: unknown }).plugins
  return Array.isArray(plugins) ? (plugins as PluginInfo[]) : []
}

function unwrapHooks(result: unknown): HookConfig[] {
  if (!result || typeof result !== 'object') return []
  const hooks = (result as { hooks?: unknown }).hooks
  return Array.isArray(hooks) ? (hooks as HookConfig[]) : []
}

/** Node-local Claude plugins via `plugins.list`. Null when path is not remote. */
export async function listRemoteManagedPlugins(
  host: EnvironmentHost,
  folderPath: string,
): Promise<PluginInfo[] | null> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return []
  try {
    const result = await gw.pluginsList(ctx.projectId)
    return unwrapPlugins(result)
  } catch {
    return []
  }
}

/** `plugins.get` for a remote project. Null when path is not remote. */
export async function getRemoteManagedPlugin(
  host: EnvironmentHost,
  folderPath: string,
  key: string,
): Promise<unknown | null> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return null
  try {
    const result = await gw.pluginsGet(ctx.projectId, key)
    return (result as { plugin?: unknown })?.plugin ?? null
  } catch {
    return null
  }
}

/** `plugins.readFile` for a remote project. Null when path is not remote. */
export async function readRemoteManagedPluginFile(
  host: EnvironmentHost,
  folderPath: string,
  key: string,
  relativePath: string,
): Promise<string | null> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return null
  try {
    const result = await gw.pluginsReadFile(ctx.projectId, key, relativePath)
    return typeof (result as { content?: unknown })?.content === 'string'
      ? ((result as { content: string }).content)
      : null
  } catch {
    return null
  }
}

/** `plugins.delete`. Returns false when path is not remote. */
export async function deleteRemoteManagedPlugin(
  host: EnvironmentHost,
  folderPath: string,
  key: string,
  scope: Extract<ResourceScope, 'user' | 'project'>,
): Promise<boolean> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return false
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return false
  await gw.pluginsDelete(ctx.projectId, key, scope)
  return true
}

/** `plugins.install`. Returns false when path is not remote. */
export async function installRemoteManagedPlugin(
  host: EnvironmentHost,
  folderPath: string,
  key: string,
  scope: Extract<ResourceScope, 'user' | 'project'>,
): Promise<boolean> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return false
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return false
  await gw.pluginsInstall(ctx.projectId, key, scope)
  return true
}

/** `plugins.update`. Returns false when path is not remote. */
export async function updateRemoteManagedPlugin(
  host: EnvironmentHost,
  folderPath: string,
  key: string,
  scope: Extract<ResourceScope, 'user' | 'project'>,
): Promise<boolean> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return false
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return false
  await gw.pluginsUpdate(ctx.projectId, key, scope)
  return true
}

/** `plugins.listMarketplace`. Null when path is not remote. */
export async function listRemoteMarketplacePlugins(
  host: EnvironmentHost,
  folderPath: string,
): Promise<PluginInfo[] | null> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return []
  try {
    const result = await gw.pluginsListMarketplace(ctx.projectId)
    return unwrapPlugins(result)
  } catch {
    return []
  }
}

/** `plugins.addMarketplace`. Returns false when path is not remote. */
export async function addRemoteMarketplace(
  host: EnvironmentHost,
  folderPath: string,
  source: string,
  scope: Extract<ResourceScope, 'user' | 'project'>,
): Promise<boolean> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return false
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return false
  await gw.pluginsAddMarketplace(ctx.projectId, source, scope)
  return true
}

/** `plugins.removeMarketplace`. Returns false when path is not remote. */
export async function removeRemoteMarketplace(
  host: EnvironmentHost,
  folderPath: string,
  name: string,
  scope: Extract<ResourceScope, 'user' | 'project' | 'local' | 'official'>,
): Promise<boolean> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return false
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return false
  await gw.pluginsRemoveMarketplace(ctx.projectId, name, scope)
  return true
}

/** Node-local hooks via `hooks.list`. Null when path is not remote. */
export async function listRemoteManagedHooks(
  host: EnvironmentHost,
  folderPath: string,
): Promise<HookConfig[] | null> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return []
  try {
    const result = await gw.hooksList(ctx.projectId)
    return unwrapHooks(result)
  } catch {
    return []
  }
}

/** Persist a hook via `hooks.save`. Returns false when path is not remote. */
export async function saveRemoteManagedHook(
  host: EnvironmentHost,
  folderPath: string,
  payload: HookSavePayload,
  replaceId?: string,
): Promise<boolean> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return false
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return false
  await gw.hooksSave(ctx.projectId, payload, replaceId)
  return true
}

/** Delete a hook via `hooks.delete`. Returns false when path is not remote. */
export async function deleteRemoteManagedHook(
  host: EnvironmentHost,
  folderPath: string,
  id: string,
): Promise<boolean> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return false
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return false
  await gw.hooksDelete(ctx.projectId, id)
  return true
}

/**
 * Node harness.resources aggregate for a remote project path.
 * Null when path is not remote. Empty-ish object when gateway missing.
 */
export async function fetchRemoteHarnessResources(
  host: EnvironmentHost,
  folderPath: string,
  opts?: { harnessId?: string; apiProviderId?: string | null },
): Promise<unknown | null> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return null
  try {
    return await gw.harnessResources({
      projectId: ctx.projectId,
      harnessId: opts?.harnessId,
      apiProviderId: opts?.apiProviderId ?? null,
    })
  } catch {
    return null
  }
}

/** Node sessionProviders.list for a connection. Null when not remote. */
export async function listRemoteSessionProvidersForPath(
  host: EnvironmentHost,
  folderPath: string,
  harnessId?: string,
): Promise<unknown[] | null> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return []
  try {
    const result = (await gw.sessionProvidersList(harnessId)) as {
      providers?: unknown[]
    }
    return Array.isArray(result?.providers) ? result.providers : []
  } catch {
    return []
  }
}

// --- Codex admin via remote project path (`remote:<connectionId>:<path>`) ---

async function withRemoteCodexGw(
  host: EnvironmentHost,
  folderPath: string,
): Promise<{ ctx: RemoteResourceContext; gw: RemoteEnvironmentGateway } | null> {
  const ctx = await resolveRemoteResourceContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return null
  return { ctx, gw }
}

/** Null when path is not remote. */
export async function remoteCodexGetAuthStatus(
  host: EnvironmentHost,
  folderPath: string,
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) return null
  return pair.gw.codexGetAuthStatus(pair.ctx.projectId)
}

export async function remoteCodexSetAuth(
  host: EnvironmentHost,
  folderPath: string,
  request: { mode: string; apiKey?: string },
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) {
    throw new Error('Remote Codex setAuth requires a connected remote project')
  }
  return pair.gw.codexSetAuth(pair.ctx.projectId, request)
}

export async function remoteCodexGetRateLimits(
  host: EnvironmentHost,
  folderPath: string,
  apiProviderId?: string | null,
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) return null
  return pair.gw.codexGetRateLimits(pair.ctx.projectId, apiProviderId)
}

export async function remoteCodexGetAccountUsage(
  host: EnvironmentHost,
  folderPath: string,
  apiProviderId?: string | null,
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) return null
  return pair.gw.codexGetAccountUsage(pair.ctx.projectId, apiProviderId)
}

export async function remoteCodexConsumeRateLimitReset(
  host: EnvironmentHost,
  folderPath: string,
  apiProviderId?: string | null,
  creditId?: string | null,
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) return null
  return pair.gw.codexConsumeRateLimitReset(pair.ctx.projectId, apiProviderId, creditId)
}

export async function remoteCodexLoginMcpOauth(
  host: EnvironmentHost,
  folderPath: string,
  serverName: string,
  apiProviderId?: string | null,
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) return null
  return pair.gw.codexLoginMcpOauth(pair.ctx.projectId, serverName, apiProviderId)
}

export async function remoteCodexDetectExternalAgent(
  host: EnvironmentHost,
  folderPath: string,
  apiProviderId?: string | null,
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) return null
  return pair.gw.codexDetectExternalAgent(pair.ctx.projectId, apiProviderId)
}

export async function remoteCodexImportExternalAgent(
  host: EnvironmentHost,
  folderPath: string,
  items: unknown[],
  apiProviderId?: string | null,
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) return null
  return pair.gw.codexImportExternalAgent(pair.ctx.projectId, items, apiProviderId)
}

export async function remoteCodexPluginsList(
  host: EnvironmentHost,
  folderPath: string,
  opts?: { marketplace?: boolean; apiProviderId?: string | null },
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) return null
  return pair.gw.codexPluginsList(pair.ctx.projectId, opts)
}

export async function remoteCodexPluginsInstall(
  host: EnvironmentHost,
  folderPath: string,
  key: string,
  apiProviderId?: string | null,
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) {
    throw new Error('Remote Codex plugins.install requires a connected remote project')
  }
  return pair.gw.codexPluginsInstall(pair.ctx.projectId, key, apiProviderId)
}

export async function remoteCodexPluginsUninstall(
  host: EnvironmentHost,
  folderPath: string,
  key: string,
  apiProviderId?: string | null,
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) {
    throw new Error('Remote Codex plugins.uninstall requires a connected remote project')
  }
  return pair.gw.codexPluginsUninstall(pair.ctx.projectId, key, apiProviderId)
}

export async function remoteCodexMarketplaceAdd(
  host: EnvironmentHost,
  folderPath: string,
  request: { source: string; refName?: string; sparsePaths?: string[] },
  apiProviderId?: string | null,
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) {
    throw new Error('Remote Codex marketplace.add requires a connected remote project')
  }
  return pair.gw.codexMarketplaceAdd(pair.ctx.projectId, request, apiProviderId)
}

export async function remoteCodexMarketplaceRemove(
  host: EnvironmentHost,
  folderPath: string,
  marketplaceName: string,
  apiProviderId?: string | null,
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) {
    throw new Error('Remote Codex marketplace.remove requires a connected remote project')
  }
  return pair.gw.codexMarketplaceRemove(pair.ctx.projectId, marketplaceName, apiProviderId)
}

export async function remoteCodexMarketplaceUpgrade(
  host: EnvironmentHost,
  folderPath: string,
  marketplaceName?: string,
  apiProviderId?: string | null,
): Promise<unknown | null> {
  const pair = await withRemoteCodexGw(host, folderPath)
  if (!pair) {
    throw new Error('Remote Codex marketplace.upgrade requires a connected remote project')
  }
  return pair.gw.codexMarketplaceUpgrade(pair.ctx.projectId, marketplaceName, apiProviderId)
}
