import type { FileSearchResult, GitFileStatus, GitStatusFile } from '@superone/shared/agent-types'

export interface FlatSearchNode {
  path: string
  name: string
  isDirectory: boolean
  depth: number
  matchIndices: number[]
}

interface BuiltNode {
  name: string
  isDirectory: boolean
  matchIndices: Set<number>
}

export function buildSearchTree(results: FileSearchResult[]): FlatSearchNode[] {
  const nodeMap = new Map<string, BuiltNode>()

  for (const result of results) {
    const parts = result.path.split('/')
    let acc = ''
    let segStart = 0
    for (let k = 0; k < parts.length; k++) {
      const name = parts[k]
      acc = acc ? `${acc}/${name}` : name
      const isDirectory = k < parts.length - 1 ? true : result.isDirectory
      let node = nodeMap.get(acc)
      if (!node) {
        node = { name, isDirectory, matchIndices: new Set() }
        nodeMap.set(acc, node)
      }
      for (const idx of result.matchIndices) {
        if (idx >= segStart && idx < segStart + name.length) {
          node.matchIndices.add(idx - segStart)
        }
      }
      segStart += name.length + 1
    }
  }

  const childrenMap = new Map<string, string[]>()
  for (const path of nodeMap.keys()) {
    const slash = path.lastIndexOf('/')
    const parent = slash >= 0 ? path.slice(0, slash) : ''
    const list = childrenMap.get(parent)
    if (list) list.push(path)
    else childrenMap.set(parent, [path])
  }

  for (const list of childrenMap.values()) {
    list.sort((a, b) => {
      const na = nodeMap.get(a)!
      const nb = nodeMap.get(b)!
      if (na.isDirectory !== nb.isDirectory) return na.isDirectory ? -1 : 1
      return na.name.localeCompare(nb.name)
    })
  }

  const flat: FlatSearchNode[] = []
  const walk = (parent: string, depth: number): void => {
    const children = childrenMap.get(parent)
    if (!children) return
    for (const path of children) {
      const node = nodeMap.get(path)!
      flat.push({
        path,
        name: node.name,
        isDirectory: node.isDirectory,
        depth,
        matchIndices: [...node.matchIndices].sort((a, b) => a - b),
      })
      walk(path, depth + 1)
    }
  }
  walk('', 0)
  return flat
}

export interface SearchGitPair {
  gitIndex: GitFileStatus | null
  gitWorktree: GitFileStatus | null
}

const EMPTY_GIT_PAIR: SearchGitPair = { gitIndex: null, gitWorktree: null }

/** Higher wins when a directory takes its color from the files inside it. */
const GIT_RANK: Record<string, number> = { U: 6, D: 5, R: 4, C: 4, T: 3, M: 3, A: 2, '?': 1 }

function pairOf(file: GitStatusFile): SearchGitPair {
  if (file.staged && file.status !== '?') return { gitIndex: file.status, gitWorktree: null }
  return { gitIndex: null, gitWorktree: file.status }
}

function worse(current: GitFileStatus | null, next: GitFileStatus | null): GitFileStatus | null {
  if (!next || next === '!') return current
  if (!current || (GIT_RANK[next] ?? 0) > (GIT_RANK[current] ?? 0)) return next
  return current
}

/**
 * Git color for a search row. Paths compare case-insensitively.
 * A directory uses the strongest status of the files under it.
 */
export function buildSearchGitIndex(files: GitStatusFile[]) {
  const entries = files.map((file) => ({
    path: file.path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(),
    ...pairOf(file),
  }))
  return (projectPath: string, isDirectory: boolean): SearchGitPair => {
    const path = projectPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (!path) return EMPTY_GIT_PAIR
    if (!isDirectory) {
      const hit = entries.find((entry) => entry.path === path)
      return hit ? { gitIndex: hit.gitIndex, gitWorktree: hit.gitWorktree } : EMPTY_GIT_PAIR
    }
    const self = entries.find((entry) => entry.path === path)
    if (self?.gitIndex === '!' || self?.gitWorktree === '!') {
      return { gitIndex: self.gitIndex, gitWorktree: self.gitWorktree }
    }
    const prefix = `${path}/`
    let gitIndex: GitFileStatus | null = null
    let gitWorktree: GitFileStatus | null = null
    for (const entry of entries) {
      if (entry.path !== path && !entry.path.startsWith(prefix)) continue
      if (entry.gitIndex === '!' || entry.gitWorktree === '!') continue
      gitIndex = worse(gitIndex, entry.gitIndex)
      gitWorktree = worse(gitWorktree, entry.gitWorktree)
    }
    return { gitIndex, gitWorktree }
  }
}
