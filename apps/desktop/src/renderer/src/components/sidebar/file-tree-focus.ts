import type { GitFileStatus, GitStatusFile } from '@superone/shared/agent-types'
import type { FlatNode, VisibleItem } from '@/stores/file-tree'

export function parentDir(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

export function basename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? path : path.slice(slash + 1)
}

/** Ancestor folders from the project root down to the parent of `focusPath`. Empty at the root. */
export function ancestorFolders(focusPath: string): string[] {
  if (!focusPath) return []
  const parts = focusPath.split('/')
  const out = ['']
  let acc = ''
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]
    out.push(acc)
  }
  return out
}

/** Directory siblings of the focused folder, including itself. Empty when the parent is not loaded. */
export function siblingDirectories(
  nodes: Map<string, FlatNode>,
  focusPath: string,
): { path: string; name: string }[] {
  if (!focusPath) return []
  const parent = nodes.get(parentDir(focusPath))
  if (!parent) return []
  const items: { path: string; name: string }[] = []
  for (const child of parent.childPaths) {
    const node = nodes.get(child)
    if (!node?.entry.isDirectory) continue
    items.push({ path: child, name: node.entry.name })
  }
  return items
}

/** Drop matches outside `scopeDir` and make the remaining paths relative to it. */
export function scopeSearchResults<T extends { path: string; matchIndices: number[] }>(
  results: T[],
  scopeDir: string,
): T[] {
  if (!scopeDir) return results
  const prefix = `${scopeDir}/`
  const shift = prefix.length
  const scoped: T[] = []
  for (const result of results) {
    if (!result.path.startsWith(prefix)) continue
    scoped.push({
      ...result,
      path: result.path.slice(shift),
      matchIndices: result.matchIndices.filter((index) => index >= shift).map((index) => index - shift),
    })
  }
  return scoped
}

interface ChangedPair {
  path: string
  gitIndex: GitFileStatus | null
  gitWorktree: GitFileStatus | null
}

function pairOf(file: GitStatusFile): { gitIndex: GitFileStatus | null; gitWorktree: GitFileStatus | null } {
  if (file.staged && file.status !== '?') return { gitIndex: file.status, gitWorktree: null }
  return { gitIndex: null, gitWorktree: file.status }
}

function isUnder(focusPath: string, path: string): boolean {
  if (!focusPath) return true
  return path.startsWith(`${focusPath}/`)
}

/**
 * Tree of git changes under `focusPath`. Ignored files are left out.
 * Intermediate directories stay so a nested change is still reachable, and
 * depths start at 0 for the focused folder's own children.
 */
export function buildChangedFileTree(files: GitStatusFile[], focusPath: string): VisibleItem[] {
  const byPath = new Map<string, ChangedPair>()
  for (const file of files) {
    if (file.status === '!' || !isUnder(focusPath, file.path)) continue
    const pair = pairOf(file)
    const prev = byPath.get(file.path)
    if (!prev) {
      byPath.set(file.path, { path: file.path, ...pair })
      continue
    }
    byPath.set(file.path, {
      path: file.path,
      gitIndex: prev.gitIndex ?? pair.gitIndex,
      gitWorktree: prev.gitWorktree ?? pair.gitWorktree,
    })
  }

  const dirSet = new Set<string>()
  for (const path of byPath.keys()) {
    const rel = focusPath ? path.slice(focusPath.length + 1) : path
    const parts = rel.split('/')
    let acc = focusPath
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      dirSet.add(acc)
    }
  }
  for (const path of [...byPath.keys()]) {
    for (const other of byPath.keys()) {
      if (!other.startsWith(`${path}/`)) continue
      byPath.delete(path)
      dirSet.add(path)
      break
    }
  }

  const children = new Map<string, string[]>()
  const add = (parent: string, child: string) => {
    const list = children.get(parent)
    if (list) {
      if (!list.includes(child)) list.push(child)
    } else {
      children.set(parent, [child])
    }
  }
  for (const dir of dirSet) add(parentDir(dir), dir)
  for (const file of byPath.keys()) add(parentDir(file), file)
  for (const list of children.values()) {
    list.sort((a, b) => {
      const aDir = dirSet.has(a)
      const bDir = dirSet.has(b)
      if (aDir !== bDir) return aDir ? -1 : 1
      return basename(a).localeCompare(basename(b))
    })
  }

  const result: VisibleItem[] = []
  const walk = (parent: string, depth: number) => {
    const list = children.get(parent)
    if (!list) return
    for (const path of list) {
      const isDirectory = dirSet.has(path)
      const file = byPath.get(path)
      result.push({
        path,
        name: basename(path),
        isDirectory,
        gitIndex: file?.gitIndex ?? null,
        gitWorktree: file?.gitWorktree ?? null,
        depth,
        isExpanded: isDirectory,
        isLoading: false,
        hasChildren: isDirectory && (children.get(path)?.length ?? 0) > 0,
      })
      if (isDirectory) walk(path, depth + 1)
    }
  }
  walk(focusPath, 0)
  return result
}
