import type { RelayClient } from '@superone/relay-client'
import type { HarnessId, RemoteCommand, RemoteSystemInfo } from '@superone/shared/agent-types'
import { randomId } from './ids'

type Client = Pick<RelayClient, 'request'>
type ProjectResources = { workspaceDirs?: string[]; projectSlashCommands?: unknown[]; skills?: unknown[] }
type Resources = { get_system_info: RemoteSystemInfo; get_project_resources: ProjectResources }
type Entry = { value?: unknown; pending: Promise<unknown> }
// A new device connection gets a new client. Never share its catalogs with another host.
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
  const existing = cache.get(key)
  if (existing && !refresh) return existing.pending as Promise<Resources[T]>
  // A refresh keeps the last known value readable until the new one lands, so
  // a peek during reconnect serves the catalog it had instead of nothing.
  const entry: Entry = { value: existing?.value, pending: Promise.resolve() }
  entry.pending = Promise.resolve().then(() => client.request({
    type, requestId: randomId(), projectPath, provider: provider as HarnessId,
  } as RemoteCommand)).then((value) => {
    if (!value || (value as { error?: string }).error) {
      throw new Error((value as { error?: string } | null)?.error || 'Could not load harness resources')
    }
    entry.value = value
    return value
  }).catch((error) => {
    if (cache.get(key) === entry) cache.delete(key)
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
