import type { RemoteCommand, WorktreeInfo } from '@superone/shared/agent-types'
import type { ShellGitInfo } from './project-types'
import { randomId } from './ids'

type Resources = {
  get_git_info: ShellGitInfo
  get_worktree_info: WorktreeInfo
  get_git_branches: { branches?: string[] }
  get_checked_out_branches: { branches?: string[] }
}
type Client = { request(command: RemoteCommand): Promise<unknown> }
type Entry = { pending: Promise<unknown>; expires: number }
const clients = new WeakMap<Client, Map<string, Entry>>()
const keyFor = (type: string, project: string) => JSON.stringify([project, type])

/** Short-lived, connection-local reads. Mutations and turn completion invalidate the project. */
export function requestGitResource<T extends keyof Resources>(client: Client, type: T, projectPath: string): Promise<Resources[T]> {
  let cache = clients.get(client)
  if (!cache) { cache = new Map(); clients.set(client, cache) }
  const key = keyFor(type, projectPath)
  const previous = cache.get(key)
  if (previous && previous.expires > Date.now()) return previous.pending as Promise<Resources[T]>
  const entry: Entry = { pending: Promise.resolve(), expires: Infinity }
  entry.pending = Promise.resolve().then(() => client.request({ type, requestId: randomId(), projectPath } as RemoteCommand)).then(value => {
    if (!value || (value as { error?: string }).error) throw new Error((value as { error?: string })?.error || 'Git info unavailable')
    entry.expires = Date.now() + (type === 'get_git_info' ? 5_000 : 30_000)
    return value
  }).catch(error => {
    if (cache.get(key) === entry) cache.delete(key)
    throw error
  })
  cache.set(key, entry)
  // The UI can visit many projects during one long-lived connection.
  if (cache.size > 256) cache.delete(cache.keys().next().value!)
  return entry.pending as Promise<Resources[T]>
}

export function invalidateGitResources(client: Client, projectPath?: string): void {
  const cache = clients.get(client)
  if (!cache) return
  if (!projectPath) { cache.clear(); return }
  for (const key of cache.keys()) if (JSON.parse(key)[0] === projectPath) cache.delete(key)
}
