import { create } from 'zustand'
import type { FileTreeEntry, GitFileStatus } from '../../../shared/agent-types'

export interface FlatNode {
  entry: FileTreeEntry
  depth: number
  parentPath: string
  childPaths: string[]
  isLoaded: boolean
}

export interface VisibleItem {
  path: string
  name: string
  isDirectory: boolean
  gitStatus: GitFileStatus | null | undefined
  depth: number
  isExpanded: boolean
  isLoading: boolean
  hasChildren: boolean
}

interface ExplorerState {
  nodes: Map<string, FlatNode>
  expandedDirs: Set<string>
  loadingDirs: Set<string>
  loading: boolean
  _visibleList: VisibleItem[]
  _visibleVersion: number

  fetchTree: (projectPath: string) => Promise<void>
  refreshTree: (projectPath: string) => Promise<void>
  toggleDir: (projectPath: string, path: string) => void
  reset: () => void
}

function entriesToNodes(
  entries: FileTreeEntry[],
  parentPath: string,
  depth: number,
  target: Map<string, FlatNode>,
): string[] {
  const paths: string[] = []
  for (const entry of entries) {
    paths.push(entry.path)
    target.set(entry.path, {
      entry: { name: entry.name, path: entry.path, isDirectory: entry.isDirectory, gitStatus: entry.gitStatus },
      depth,
      parentPath,
      childPaths: [],
      isLoaded: false,
    })
  }
  return paths
}

function computeVisible(
  nodes: Map<string, FlatNode>,
  expandedDirs: Set<string>,
  loadingDirs: Set<string>,
): VisibleItem[] {
  const result: VisibleItem[] = []

  const rootNode = nodes.get('')
  if (!rootNode) return result

  const walk = (childPaths: string[]) => {
    for (const path of childPaths) {
      const node = nodes.get(path)
      if (!node) continue
      const isExpanded = expandedDirs.has(path)
      const isLoading = loadingDirs.has(path)
      result.push({
        path,
        name: node.entry.name,
        isDirectory: node.entry.isDirectory,
        gitStatus: node.entry.gitStatus,
        depth: node.depth,
        isExpanded,
        isLoading,
        hasChildren: node.childPaths.length > 0 || !node.isLoaded,
      })
      if (node.entry.isDirectory && isExpanded && node.isLoaded) {
        walk(node.childPaths)
      }
    }
  }

  walk(rootNode.childPaths)
  return result
}

function mergeEntries(
  nodes: Map<string, FlatNode>,
  parentPath: string,
  depth: number,
  entries: FileTreeEntry[],
): void {
  const parent = nodes.get(parentPath)
  if (!parent) return

  const newPaths = new Set(entries.map((e) => e.path))
  for (const oldPath of parent.childPaths) {
    if (!newPaths.has(oldPath)) removeSubtree(nodes, oldPath)
  }

  const childPaths: string[] = []
  for (const entry of entries) {
    childPaths.push(entry.path)
    const existing = nodes.get(entry.path)
    if (existing) {
      existing.entry = { name: entry.name, path: entry.path, isDirectory: entry.isDirectory, gitStatus: entry.gitStatus }
      existing.depth = depth
      existing.parentPath = parentPath
    } else {
      nodes.set(entry.path, {
        entry: { name: entry.name, path: entry.path, isDirectory: entry.isDirectory, gitStatus: entry.gitStatus },
        depth,
        parentPath,
        childPaths: [],
        isLoaded: false,
      })
    }
  }
  parent.childPaths = childPaths
  parent.isLoaded = true
}

function removeSubtree(nodes: Map<string, FlatNode>, path: string): void {
  const node = nodes.get(path)
  if (!node) return
  for (const child of node.childPaths) removeSubtree(nodes, child)
  nodes.delete(path)
}

function recomputeAndSet(
  get: () => ExplorerState,
  set: (partial: Partial<ExplorerState>) => void,
  extra?: Partial<ExplorerState>,
): void {
  const s = get()
  const _visibleList = computeVisible(s.nodes, s.expandedDirs, s.loadingDirs)
  set({ ...extra, _visibleList, _visibleVersion: s._visibleVersion + 1 })
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  nodes: new Map(),
  expandedDirs: new Set(),
  loadingDirs: new Set(),
  loading: false,
  _visibleList: [],
  _visibleVersion: 0,

  fetchTree: async (projectPath) => {
    set({ loading: true })
    try {
      const entries = await window.app.listDir(projectPath, '')
      const nodes = new Map<string, FlatNode>()
      const rootChildPaths = entriesToNodes(entries, '', 0, nodes)
      nodes.set('', { entry: { name: '', path: '', isDirectory: true }, depth: -1, parentPath: '', childPaths: rootChildPaths, isLoaded: true })
      const _visibleList = computeVisible(nodes, new Set(), new Set())
      set({ nodes, expandedDirs: new Set(), loadingDirs: new Set(), loading: false, _visibleList, _visibleVersion: get()._visibleVersion + 1 })
    } catch {
      set({ nodes: new Map(), loading: false, _visibleList: [], _visibleVersion: get()._visibleVersion + 1 })
    }
  },

  refreshTree: async (projectPath) => {
    const { expandedDirs } = get()
    try {
      const dirs = ['', ...expandedDirs]
      const results = await Promise.all(
        dirs.map(async (dir) => {
          try {
            return { dir, entries: await window.app.listDir(projectPath, dir) }
          } catch {
            return { dir, entries: [] as FileTreeEntry[] }
          }
        }),
      )

      const sorted = results.sort((a, b) => a.dir.split('/').length - b.dir.split('/').length)

      const { nodes } = get()
      for (const { dir, entries } of sorted) {
        const depth = dir === '' ? 0 : (nodes.get(dir)?.depth ?? 0) + 1
        mergeEntries(nodes, dir, depth, entries)
      }

      recomputeAndSet(get, set)
    } catch { /* keep existing on error */ }
  },

  toggleDir: (projectPath, path) => {
    const { expandedDirs, loadingDirs, nodes } = get()

    if (expandedDirs.has(path)) {
      const next = new Set(expandedDirs)
      next.delete(path)
      set({ expandedDirs: next })
      recomputeAndSet(get, set)
      return
    }

    const next = new Set(expandedDirs)
    next.add(path)
    set({ expandedDirs: next })

    const node = nodes.get(path)
    if (node?.isLoaded) {
      recomputeAndSet(get, set)
      return
    }

    if (loadingDirs.has(path)) {
      recomputeAndSet(get, set)
      return
    }

    const nextLoading = new Set(loadingDirs)
    nextLoading.add(path)
    set({ loadingDirs: nextLoading })
    recomputeAndSet(get, set)

    window.app.listDir(projectPath, path).then((children) => {
      const { nodes: currentNodes } = get()
      const parentNode = currentNodes.get(path)
      const depth = parentNode ? parentNode.depth + 1 : 0
      mergeEntries(currentNodes, path, depth, children)
      const nl = new Set(get().loadingDirs)
      nl.delete(path)
      set({ loadingDirs: nl })
      recomputeAndSet(get, set)
    }).catch(() => {
      const { nodes: currentNodes } = get()
      mergeEntries(currentNodes, path, (currentNodes.get(path)?.depth ?? 0) + 1, [])
      const nl = new Set(get().loadingDirs)
      nl.delete(path)
      set({ loadingDirs: nl })
      recomputeAndSet(get, set)
    })
  },

  reset: () => {
    set({
      nodes: new Map(),
      expandedDirs: new Set(),
      loadingDirs: new Set(),
      loading: false,
      _visibleList: [],
      _visibleVersion: get()._visibleVersion + 1,
    })
  },
}))
