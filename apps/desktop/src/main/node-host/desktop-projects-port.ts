import { realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ProjectSnapshot } from '@superone/shared/environment'
import type { RecentFolder } from '@superone/shared/agent-types'
import type { ProjectsPort } from '@superone/runtime/server'
import { unsupportedMethodError } from '@superone/runtime/server'
import { detectRepoIdentity } from '@superone/runtime/workspace'

/** The desktop project registry operations the node surface reads and writes. */
export interface DesktopProjectRegistry {
  list(): RecentFolder[]
  /** Register a folder (or bump an existing one). */
  add(path: string): void
}

/**
 * `project.list/get/open` over the desktop's own project list, so a remote
 * controller sees the same projects as this desktop's sidebar. `repoIdentity`
 * is `git:<origin url>` like the CLI node's registry, which is what a
 * controller matches its own checkout against. Edit/remove stay with this
 * desktop's user.
 */
export function createDesktopProjectsPort(registry: DesktopProjectRegistry): ProjectsPort {
  // git config reads per project are cheap but not free; the origin of a
  // checkout rarely changes while the app runs.
  const identities = new Map<string, string | null>()
  const repoIdentity = (path: string): string | null => {
    if (!identities.has(path)) identities.set(path, detectRepoIdentity(path))
    return identities.get(path) ?? null
  }
  const toSnapshot = (folder: RecentFolder): ProjectSnapshot => ({
    projectId: folder.id,
    path: folder.path,
    name: folder.name,
    extraDirs: folder.extraDirs ?? [],
    repoIdentity: repoIdentity(folder.path),
    lastActiveAt: Date.parse(folder.lastOpened) || undefined,
  })
  const get = (projectId: string): ProjectSnapshot | null => {
    const folder = registry.list().find((f) => f.id === projectId)
    return folder ? toSnapshot(folder) : null
  }

  return {
    list: () => registry.list().map(toSnapshot),
    get,
    // The desktop names a project after its folder; `git.clone` passes the
    // clone's directory name, which is the same thing.
    open(path) {
      let abs: string
      try {
        abs = realpathSync(resolve(path))
        if (!statSync(abs).isDirectory()) throw new Error('not a directory')
      } catch {
        throw Object.assign(new Error(`not a directory: ${path}`), { code: 'invalid_argument' })
      }
      registry.add(abs)
      const folder = registry.list().find((f) => f.path === abs)
      if (!folder) throw Object.assign(new Error('failed to register project'), { code: 'internal' })
      identities.delete(abs)
      return toSnapshot(folder)
    },
    update: () => {
      throw unsupportedMethodError('project.update')
    },
    remove: () => {
      throw unsupportedMethodError('project.remove')
    },
  }
}
