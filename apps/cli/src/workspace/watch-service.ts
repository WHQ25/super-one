import { watch, type FSWatcher } from 'node:fs'
import { resolveProjectPath } from './path-security'
import type { ProjectRegistry } from './project-registry'

export type WatchEvent = { path: string; type: string }

/**
 * Bounded project file watcher. Yields relative paths that stay inside the project root.
 */
export class WorkspaceWatchService {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly ownerByWatch = new Map<string, string>()
  private readonly cancelByWatch = new Map<string, () => void>()

  constructor(private readonly projects: ProjectRegistry) {}

  cancelForClient(clientSessionId: string): void {
    for (const [watchId, owner] of [...this.ownerByWatch]) {
      if (owner !== clientSessionId) continue
      this.cancelByWatch.get(watchId)?.()
      this.cancelByWatch.delete(watchId)
      this.ownerByWatch.delete(watchId)
    }
  }

  async *watch(projectId: string, relativePath = '.'): AsyncGenerator<WatchEvent> {
    const project = this.projects.get(projectId)
    if (!project) throw Object.assign(new Error('project not found'), { code: 'not_found' })
    const resolved = resolveProjectPath(project.path, relativePath || '.')
    if (!resolved.ok) {
      throw Object.assign(new Error(resolved.reason), { code: 'invalid_argument' })
    }

    const queue: WatchEvent[] = []
    let wake: (() => void) | null = null
    let closed = false
    const watchId = crypto.randomUUID()

    const watcher = watch(resolved.absolutePath, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      const rel = String(filename).split('\\').join('/')
      const check = resolveProjectPath(project.path, relativePath === '.' ? rel : `${relativePath}/${rel}`)
      if (!check.ok) return
      queue.push({ path: rel, type: eventType })
      wake?.()
    })
    this.watchers.set(watchId, watcher)

    try {
      while (!closed) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve
            // Allow consumer abort by closing after idle — 30s heartbeat empty check
            setTimeout(() => resolve(), 100)
          })
          wake = null
          continue
        }
        const next = queue.shift()
        if (next) yield next
      }
    } finally {
      watcher.close()
      this.watchers.delete(watchId)
    }
  }

  /**
   * One-shot subscribe used by RPC: register a push callback, return cancel fn.
   */
  subscribe(
    projectId: string,
    relativePath: string,
    onEvent: (ev: WatchEvent) => void,
    ownerClientId?: string,
  ): { watchId: string; cancel: () => void } {
    const project = this.projects.get(projectId)
    if (!project) throw Object.assign(new Error('project not found'), { code: 'not_found' })
    const resolved = resolveProjectPath(project.path, relativePath || '.')
    if (!resolved.ok) {
      throw Object.assign(new Error(resolved.reason), { code: 'invalid_argument' })
    }
    const watcher = watch(resolved.absolutePath, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      const rel = String(filename).split('\\').join('/')
      const check = resolveProjectPath(project.path, relativePath === '.' ? rel : `${relativePath}/${rel}`)
      if (!check.ok) return
      onEvent({ path: rel, type: eventType })
    })
    const id = crypto.randomUUID()
    this.watchers.set(id, watcher)
    if (ownerClientId) this.ownerByWatch.set(id, ownerClientId)
    const cancel = () => {
      watcher.close()
      this.watchers.delete(id)
      this.ownerByWatch.delete(id)
      this.cancelByWatch.delete(id)
    }
    this.cancelByWatch.set(id, cancel)
    return { watchId: id, cancel }
  }

  assertOwner(watchId: string, clientSessionId: string): void {
    const owner = this.ownerByWatch.get(watchId)
    if (!owner || owner !== clientSessionId) {
      throw Object.assign(new Error('watch not found or not owned'), { code: 'not_found' })
    }
  }

  closeAll(): void {
    for (const w of this.watchers.values()) w.close()
    this.watchers.clear()
    this.ownerByWatch.clear()
    this.cancelByWatch.clear()
  }
}
