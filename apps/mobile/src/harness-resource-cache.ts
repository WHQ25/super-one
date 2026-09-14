import type { PersistedWorkspace } from './persisted-workspace'
import type { RelayClient } from '@superone/relay-client'
import type { HarnessId, RemoteCommand, RemoteSystemInfo } from '@superone/shared/agent-types'
import { randomId } from './ids'

type Client = Pick<RelayClient, 'request'>
type ProjectResources = { workspaceDirs?: string[]; projectSlashCommands?: unknown[]; skills?: unknown[] }
type Resources = { get_system_info: RemoteSystemInfo; get_project_resources: ProjectResources }
type Entry = { value?: unknown; pending: Promise<unknown>; updatedAt: number; refreshing: boolean }
// A new device connection gets a new client. Never share its catalogs with another host.
const persistence = new WeakMap<Client, PersistedWorkspace>()
type ResourceListener = (type: keyof Resources, projectPath: string, provider: string, value: unknown) => void
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
const keyFor = (type: keyof Resources, projectPath: string, provider: string) => JSON.stringify([type, projectPath, provider])

export function peekHarnessResource<T extends keyof Resources>(
  client: Client, type: T, projectPath: string, provider: string,
): Resources[T] | undefined {
  return entries(client).get(keyFor(type, projectPath, provider))?.value as Resources[T] | undefined
}

export function requestHarnessResource<T extends keyof Resources>(
  client: Client, type: T, projectPath: string, provider: string, refresh = false,
): Promise<Resources[T]> {
  const cache = entries(client)
  const key = keyFor(type, projectPath, provider)
  if (!cache.has(key)) {
    const value = persistence.get(client)?.get(`catalog:${key}`)
    if (value !== undefined) cache.set(key, { value, pending: Promise.resolve(value), updatedAt: 0, refreshing: false })
  }
  const existing = cache.get(key)
  if (existing && !refresh) {
    if (existing.value !== undefined && Date.now() - existing.updatedAt > 60_000 && !existing.refreshing) {
      void requestHarnessResource(client, type, projectPath, provider, true).catch(() => {})
      return Promise.resolve(existing.value as Resources[T])
    }
    return existing.value !== undefined ? Promise.resolve(existing.value as Resources[T]) : existing.pending as Promise<Resources[T]>
  }
  // A refresh keeps the last known value readable until the new one lands, so
  // a peek during reconnect serves the catalog it had instead of nothing.
  const entry: Entry = { value: existing?.value, pending: Promise.resolve(), updatedAt: existing?.updatedAt ?? 0, refreshing: true }
  entry.pending = Promise.resolve().then(() => client.request({
    type, requestId: randomId(), projectPath, provider: provider as HarnessId,
  } as RemoteCommand)).then((value) => {
    if (!value || (value as { error?: string }).error) {
      throw new Error((value as { error?: string } | null)?.error || 'Could not load harness resources')
    }
    const current = connections.get(client) === cache && cache.get(key) === entry
    if (current) persistence.get(client)?.set(`catalog:${key}`, value)
    entry.value = value
    entry.updatedAt = Date.now()
    entry.refreshing = false
    if (current) for (const listener of listeners.get(client) ?? []) {
      try { listener(type, projectPath, provider, value) } catch { /* one consumer cannot fail the shared read */ }
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
