import type { ProjectSnapshot } from '@superone/shared/environment'
import { pathBasename } from '@superone/shared/collab-request-display'
import { repoIdentityRemote } from '@superone/shared/git-remote-url'
import { homePath } from '@superone/shared/path-display'

export interface ProjectRepoLink {
  /** GitHub shows `owner/repo`. Every other host keeps `host/path`. */
  label: string
  href: string
  github: boolean
}

export interface ProjectHoverFolder {
  /** Basename, or the shortened path when two folders share a basename. */
  name: string
  path: string
  title: string
}

/** `git:<origin>` becomes a browser URL. A checkout with no origin has nothing to open. */
export function projectRepoLink(repoIdentity: string | null | undefined): ProjectRepoLink | null {
  const remote = repoIdentityRemote(repoIdentity)
  if (!remote) return null
  const github = remote === 'github.com' || remote.startsWith('github.com/')
  const slash = remote.indexOf('/')
  return {
    label: github && slash !== -1 ? remote.slice(slash + 1) : remote,
    href: `https://${remote}`,
    github,
  }
}

/** The path on the machine that holds the checkout. A remote project key is not that path. */
export function projectHostPath(projectKey: string): string {
  if (!projectKey.startsWith('remote:')) return projectKey
  const rest = projectKey.slice(projectKey.indexOf(':', 'remote:'.length) + 1)
  return rest || projectKey
}

/**
 * The checkout plus any extra workspace folders. Hover text is the full path.
 * Two folders with the same basename show the shortened path so they stay distinct.
 */
export function projectHoverFolders(rootPath: string, extraDirs?: readonly string[]): ProjectHoverFolder[] {
  const seen = new Set<string>()
  const folders: ProjectHoverFolder[] = []
  for (const path of [rootPath, ...(extraDirs ?? [])]) {
    if (!path || seen.has(path)) continue
    seen.add(path)
    folders.push({ name: pathBasename(path) || path, path, title: homePath(path) })
  }
  const names = new Map<string, number>()
  for (const folder of folders) names.set(folder.name, (names.get(folder.name) ?? 0) + 1)
  return folders.map((folder) => (
    (names.get(folder.name) ?? 0) > 1 ? { ...folder, name: folder.title } : folder
  ))
}

/** Non-hidden sessions, or null when the sidebar has not loaded the whole list. */
export function knownSessionCount(input: {
  loaded: boolean
  hasMore: boolean
  sessions: readonly { isHidden?: boolean }[]
}): number | null {
  if (!input.loaded || input.hasMore) return null
  return input.sessions.reduce((count, session) => count + (session.isHidden ? 0 : 1), 0)
}

const repoLists = new Map<string, Promise<Map<string, string | null>>>()

function indexRepoIdentities(projects: ProjectSnapshot[]): Map<string, string | null> {
  const map = new Map<string, string | null>()
  for (const project of projects) {
    map.set(project.projectId, project.repoIdentity ?? null)
    map.set(project.path, project.repoIdentity ?? null)
  }
  return map
}

/** One `listProjects` per connection. The origin rarely changes during a session. */
export function repoIdentityFor(
  connectionId: string,
  projectId: string,
  hostPath: string,
  listProjects: (connectionId: string) => Promise<ProjectSnapshot[]>,
): Promise<string | null> {
  let pending = repoLists.get(connectionId)
  if (!pending) {
    pending = listProjects(connectionId).then(indexRepoIdentities).catch(() => new Map())
    repoLists.set(connectionId, pending)
  }
  return pending.then((map) => map.get(projectId) ?? map.get(hostPath) ?? null)
}

/** Tests replace the cached list. */
export function resetRepoIdentityCache(): void {
  repoLists.clear()
}
