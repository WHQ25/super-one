import type { PersistedWorkspace } from './persisted-workspace'
import type { MobileRpcClient } from './runtime-session-rpc'
import type { RemoteSystemInfo } from '@superone/shared/agent-types'

export type HarnessResourceClient = Pick<MobileRpcClient, 'rpc' | 'resolveProject'>
type Client = HarnessResourceClient
type ProjectResources = { workspaceDirs?: string[]; projectSlashCommands?: unknown[]; skills?: unknown[] }
type Resources = { get_system_info: RemoteSystemInfo; get_project_resources: ProjectResources }
type Entry = { value?: unknown; pending: Promise<unknown>; updatedAt: number; refreshing: boolean }
// A new device connection gets a new client. Never share its catalogs with another host.
const persistence = new WeakMap<Client, PersistedWorkspace>()
type ResourceListener = (type: keyof Resources, projectPath: string, provider: string, value: unknown, acpAgentId?: string | null) => void
const listeners = new WeakMap<Client, Set<ResourceListener>>()
export function subscribeHarnessResources(client: Client, listener: ResourceListener): () => void {
  let subscriptions = listeners.get(client)
  if (!subscriptions) { subscriptions = new Set(); listeners.set(client, subscriptions) }
  subscriptions.add(listener)
  return () => { subscriptions.delete(listener) }
}

const connections = new WeakMap<Client, Map<string, Entry>>()

function entries(client: Client) {
  let cache = connections.get(client)
  if (!cache) { cache = new Map(); connections.set(client, cache) }
  return cache
}

function splitProviderKey(type: keyof Resources, provider: string, acpAgentId?: string | null): {
  harnessId: string
  acpAgentId: string | null
  cacheProvider: string
} {
  if (provider.startsWith('acp:')) {
    const agent = provider.slice(4).trim() || null
    const cacheProvider = type === 'get_system_info' && agent ? `acp:${agent}` : 'acp'
    return { harnessId: 'acp', acpAgentId: agent, cacheProvider }
  }
  const agent = provider === 'acp' ? (acpAgentId?.trim() || null) : null
  const cacheProvider = type === 'get_system_info' && agent ? `acp:${agent}` : provider
  return { harnessId: provider, acpAgentId: agent, cacheProvider }
}

const keyFor = (type: keyof Resources, projectPath: string, cacheProvider: string) => JSON.stringify([type, projectPath, cacheProvider])

export function peekHarnessResource<T extends keyof Resources>(
  client: Client, type: T, projectPath: string, provider: string, acpAgentId?: string | null,
): Resources[T] | undefined {
  const { cacheProvider } = splitProviderKey(type, provider, acpAgentId)
  return entries(client).get(keyFor(type, projectPath, cacheProvider))?.value as Resources[T] | undefined
}

export function requestHarnessResource<T extends keyof Resources>(
  client: Client,
  type: T,
  projectPath: string,
  provider: string,
  refresh: boolean | { force?: boolean; acpAgentId?: string | null } = false,
  acpAgentId?: string | null,
): Promise<Resources[T]> {
  const cache = entries(client)
  const effectiveAcpAgentId = acpAgentId !== undefined
    ? acpAgentId
    : (typeof refresh === 'object' ? refresh.acpAgentId : undefined)
  const isRefresh = typeof refresh === 'boolean' ? refresh : Boolean(refresh.force)
  const { harnessId, acpAgentId: resolvedAcpAgentId, cacheProvider } = splitProviderKey(type, provider, effectiveAcpAgentId)
  const key = keyFor(type, projectPath, cacheProvider)
  if (!cache.has(key)) {
    const value = persistence.get(client)?.get(`catalog:${key}`)
    if (value !== undefined) cache.set(key, { value, pending: Promise.resolve(value), updatedAt: 0, refreshing: false })
  }
  const existing = cache.get(key)
  if (existing && !isRefresh) {
    if (existing.value !== undefined && Date.now() - existing.updatedAt > 60_000 && !existing.refreshing) {
      void requestHarnessResource(client, type, projectPath, cacheProvider, true).catch(() => {})
      return Promise.resolve(existing.value as Resources[T])
    }
    return existing.value !== undefined ? Promise.resolve(existing.value as Resources[T]) : existing.pending as Promise<Resources[T]>
  }
  // A refresh keeps the last known value readable until the new one lands, so
  // a peek during reconnect serves the catalog it had instead of nothing.
  const entry: Entry = { value: existing?.value, pending: Promise.resolve(), updatedAt: existing?.updatedAt ?? 0, refreshing: true }
  entry.pending = Promise.resolve().then(async () => {
    const project = await client.resolveProject(projectPath)
    return client.rpc(type === 'get_system_info' ? 'harness.systemInfo' : 'harness.projectResources', {
      projectId: project.projectId, harnessId,
      ...(type === 'get_system_info' && resolvedAcpAgentId ? { acpAgentId: resolvedAcpAgentId } : {}),
      ...(type === 'get_system_info' && typeof refresh === 'object' && refresh.force ? { force: refresh.force } : {}),
    }, { environmentId: project.environmentId })
  }).then((value) => {
    if (!value || (value as { error?: string }).error) {
      throw new Error((value as { error?: string } | null)?.error || 'Could not load harness resources')
    }
    const current = connections.get(client) === cache && cache.get(key) === entry
    if (current) persistence.get(client)?.set(`catalog:${key}`, value)
    entry.value = value
    entry.updatedAt = Date.now()
    entry.refreshing = false
    if (current) for (const listener of listeners.get(client) ?? []) {
      try { listener(type, projectPath, harnessId, value, resolvedAcpAgentId) } catch { /* one consumer cannot fail the shared read */ }
    }
    return value
  }).catch((error) => {
    entry.refreshing = false
    if (cache.get(key) === entry) {
      if (entry.value !== undefined) entry.pending = Promise.resolve(entry.value)
      else cache.delete(key)
    }
    throw error
  })
  cache.set(key, entry)
  return entry.pending as Promise<Resources[T]>
}

export async function preloadHarnessResources(client: Client, projectPath: string, providers: readonly string[]) {
  await Promise.allSettled([...new Set(providers)].flatMap((provider) => [
    requestHarnessResource(client, 'get_system_info', projectPath, provider),
    requestHarnessResource(client, 'get_project_resources', projectPath, provider),
  ]))
}

export function clearHarnessResources(client: Client) { connections.delete(client) }

/** Refresh the connected host's known catalogs after transport/session restore. */
export async function refreshHarnessResources(client: Client) {
  const keys = [...entries(client).keys()]
  await Promise.allSettled(keys.map((key) => {
    const [type, projectPath, provider] = JSON.parse(key) as [keyof Resources, string, string]
    return requestHarnessResource(client, type, projectPath, provider, true)
  }))
}

/** Reconnect invalidates freshness without launching unused harnesses. */
export function markHarnessResourcesStale(client: Client): void {
  for (const entry of entries(client).values()) entry.updatedAt = 0
}

export function bindHarnessPersistence(client: Client, cache: PersistedWorkspace): void { persistence.set(client, cache) }
