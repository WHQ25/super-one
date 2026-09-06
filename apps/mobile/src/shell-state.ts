export type RemoteDirectoryEntry = { name: string; isDirectory: boolean }
export type RemoteDirectoryAction = { kind: 'directory' | 'file'; path: string }

export function joinRemotePath(parent: string, name: string): string {
  const base = parent.replace(/\\/g, '/').replace(/\/+$/, '')
  const child = name.replace(/\\/g, '/').replace(/^\/+/, '')
  return `${base || ''}/${child}`
}

export function parentRemotePath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const drive = slashed.match(/^([A-Za-z]:)(?:\/|$)/)?.[1]
  const uncRoot = slashed.match(/^(\/\/[^/]+\/[^/]+)/)?.[1]
  if (drive && slashed.replace(/\/+$/, '') === drive) return `${drive}/`
  if (uncRoot && slashed.replace(/\/+$/, '') === uncRoot) return uncRoot
  const normalized = slashed.replace(/\/+$/, '')
  const slash = normalized.lastIndexOf('/')
  if (drive && slash <= drive.length) return `${drive}/`
  if (uncRoot && slash <= uncRoot.length) return uncRoot
  if (slash <= 0) return '/'
  return normalized.slice(0, slash)
}

export function resolveRemoteFilePath(projectPath: string, filePath: string): string {
  const absolute = filePath.startsWith('/')
    || filePath.startsWith('\\\\')
    || /^[A-Za-z]:[\\/]/.test(filePath)
  return absolute ? filePath : joinRemotePath(projectPath, filePath)
}

export function directoryEntryAction(parent: string, entry: RemoteDirectoryEntry): RemoteDirectoryAction {
  return {
    kind: entry.isDirectory ? 'directory' : 'file',
    path: joinRemotePath(parent, entry.name),
  }
}

/** Same path, one spelling: separators normalized and any trailing slash dropped. */
function normalizeRemotePath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const trimmed = slashed.replace(/\/+$/, '')
  return trimmed || '/'
}

/** Whether `path` is `root` itself or lives under it. Separator- and trailing-slash tolerant. */
export function isWithinRemoteRoot(root: string, path: string): boolean {
  const base = normalizeRemotePath(root)
  const target = normalizeRemotePath(path)
  if (base === '/') return true
  return target === base || target.startsWith(`${base}/`)
}

/**
 * Breadcrumbs from `root` down to `path`, excluding the root itself — the header
 * owns that, and offering it here would be a second way to leave the project the
 * browser is scoped to.
 *
 * A path outside the root (an additional directory the agent touched, say) has no
 * relative reading, so it falls back to the absolute chain rather than rendering
 * an empty bar over a folder the user cannot place.
 */
export function remoteBreadcrumbsWithin(root: string, path: string): { path: string; label: string }[] {
  if (!isWithinRemoteRoot(root, path)) return remoteBreadcrumbs(path)
  const base = normalizeRemotePath(root)
  const target = normalizeRemotePath(path)
  if (base === target) return []
  const rest = base === '/' ? target.slice(1) : target.slice(base.length + 1)
  let current = base === '/' ? '' : base
  return rest.split('/').filter(Boolean).map((label) => {
    current = `${current}/${label}`
    return { path: current, label }
  })
}

export function remoteBreadcrumbs(path: string): { path: string; label: string }[] {
  const result: { path: string; label: string }[] = []
  let current = path.replace(/\\/g, '/')
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const parent = parentRemotePath(current)
    const root = current === parent
    result.unshift({ path: current, label: root ? current : current.replace(/\/+$/, '').split('/').pop() || '/' })
    if (root) break
    current = parent
  }
  return result
}

/**
 * What the file browser is anchored to. Project mode is fenced to one working
 * directory the way the desktop's tree is; computer mode browses the whole host,
 * which is what a folder picker (add a project, choose an upload target) needs.
 */
export type FileBrowserMode =
  | { kind: 'project'; root: string; name: string }
  | { kind: 'computer'; name: string }

/** Where the browser's title returns to: the project root, or the host root of the current path. */
export function fileBrowserHome(mode: FileBrowserMode, path: string): string {
  if (mode.kind === 'project') return mode.root
  // Windows has no single root, so "home" is whichever drive or share we are on.
  return remoteBreadcrumbs(path)[0]?.path ?? '/'
}

export function fileBrowserCrumbs(mode: FileBrowserMode, path: string): { path: string; label: string }[] {
  return mode.kind === 'project' ? remoteBreadcrumbsWithin(mode.root, path) : remoteBreadcrumbs(path)
}

/** Repo-relative path git reports for an absolute one, or null when it is outside. */
export function repoRelativePath(root: string, path: string): string | null {
  if (!isWithinRemoteRoot(root, path)) return null
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const target = path.replace(/\\/g, '/').replace(/\/+$/, '')
  if (base === target) return ''
  return target.slice(base.length + 1)
}
