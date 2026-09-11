import { create } from 'zustand'
import type { FileEntryKind, FileOpResult, FileTreeEntry, GitFileStatus } from '@superone/shared/agent-types'

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
  gitIndex: GitFileStatus | null | undefined
  gitWorktree: GitFileStatus | null | undefined
  depth: number
  isExpanded: boolean
  isLoading: boolean
  hasChildren: boolean
  /** Synthetic "New File / New Folder" row that carries the name input; never on disk. */
  isDraft?: boolean
}

export interface DraftEntry {
  /** Project-relative parent directory; '' = project root. */
  parentDir: string
  kind: FileEntryKind
}

/** Draft rows key off a NUL byte so they can never collide with a real path. */
const DRAFT_PATH_SUFFIX = '\0new'

interface FileTreeState {
  nodes: Map<string, FlatNode>
  expandedDirs: Set<string>
  loadingDirs: Set<string>
  loading: boolean
  renamingPath: string | null
  dragOverPath: string | null
  revealedPath: string | null
  draft: DraftEntry | null
  _visibleList: VisibleItem[]
  _visibleVersion: number
  _currentRoot: string | null

  fetchTree: (projectPath: string) => Promise<void>
  refreshTree: (projectPath: string) => Promise<void>
  toggleDir: (projectPath: string, path: string) => void
  reset: () => void
  setRenamingPath: (path: string | null) => void
  setDragOverPath: (path: string | null) => void
  moveFile: (projectPath: string, srcPath: string, destDirPath: string) => Promise<FileOpResult>
  copyFilesIn: (projectPath: string, destDirPath: string, absolutePaths: string[]) => Promise<FileOpResult>
  moveFilesIn: (projectPath: string, destDirPath: string, absolutePaths: string[]) => Promise<FileOpResult>
  deleteFile: (projectPath: string, relPath: string) => Promise<FileOpResult>
  renameFile: (projectPath: string, oldPath: string, newName: string) => Promise<FileOpResult>
  revealPath: (projectPath: string, path: string) => Promise<void>
  clearRevealed: () => void
  /** Open an inline name input under `parentDir` (expanding it first). */
  startDraft: (projectPath: string, parentDir: string, kind: FileEntryKind) => Promise<void>
  cancelDraft: () => void
  /** Commit the draft: create on disk, refresh, and reveal the new entry. */
  createEntry: (projectPath: string, name: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
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
      entry: { name: entry.name, path: entry.path, isDirectory: entry.isDirectory, gitIndex: entry.gitIndex, gitWorktree: entry.gitWorktree },
      depth,
      parentPath,
      childPaths: [],
      isLoaded: false,
    })
  }
  return paths
}

function draftItem(draft: DraftEntry, depth: number): VisibleItem {
  return {
    path: `${draft.parentDir}${DRAFT_PATH_SUFFIX}`,
    name: '',
    isDirectory: draft.kind === 'directory',
    gitIndex: null,
    gitWorktree: null,
    depth,
    isExpanded: false,
    isLoading: false,
    hasChildren: false,
    isDraft: true,
  }
}

function computeVisible(
  nodes: Map<string, FlatNode>,
  expandedDirs: Set<string>,
  loadingDirs: Set<string>,
  draft: DraftEntry | null = null,
): VisibleItem[] {
  const result: VisibleItem[] = []

  const rootNode = nodes.get('')
  if (!rootNode) return result

  const walk = (parentPath: string, childPaths: string[]) => {
    // The draft sits first among its parent's children, like VS Code's new-file row.
    if (draft && draft.parentDir === parentPath) {
      result.push(draftItem(draft, (nodes.get(parentPath)?.depth ?? -1) + 1))
    }
    for (const path of childPaths) {
      const node = nodes.get(path)
      if (!node) continue
      const isExpanded = expandedDirs.has(path)
      const isLoading = loadingDirs.has(path)
      result.push({
        path,
        name: node.entry.name,
        isDirectory: node.entry.isDirectory,
        gitIndex: node.entry.gitIndex,
        gitWorktree: node.entry.gitWorktree,
        depth: node.depth,
        isExpanded,
        isLoading,
        hasChildren: node.childPaths.length > 0 || !node.isLoaded,
      })
      if (node.entry.isDirectory && isExpanded && node.isLoaded) {
        walk(path, node.childPaths)
      }
    }
  }

  walk('', rootNode.childPaths)
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
      existing.entry = { name: entry.name, path: entry.path, isDirectory: entry.isDirectory, gitIndex: entry.gitIndex, gitWorktree: entry.gitWorktree }
      existing.depth = depth
      existing.parentPath = parentPath
    } else {
      nodes.set(entry.path, {
        entry: { name: entry.name, path: entry.path, isDirectory: entry.isDirectory, gitIndex: entry.gitIndex, gitWorktree: entry.gitWorktree },
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
  get: () => FileTreeState,
  set: (partial: Partial<FileTreeState>) => void,
  extra?: Partial<FileTreeState>,
): void {
  const s = get()
  const nodes = (extra?.nodes as Map<string, FlatNode> | undefined) ?? s.nodes
  const expandedDirs = (extra?.expandedDirs as Set<string> | undefined) ?? s.expandedDirs
  const loadingDirs = (extra?.loadingDirs as Set<string> | undefined) ?? s.loadingDirs
  const draft = extra?.draft !== undefined ? extra.draft : s.draft
  const _visibleList = computeVisible(nodes, expandedDirs, loadingDirs, draft)
  set({ ...extra, _visibleList, _visibleVersion: s._visibleVersion + 1 })
}

async function ensureExpanded(
  get: () => FileTreeState,
  set: (partial: Partial<FileTreeState>) => void,
  projectPath: string,
  path: string,
): Promise<void> {
  const { expandedDirs, nodes } = get()
  const node = nodes.get(path)
  if (!node || !node.entry.isDirectory) return

  const next = new Set(expandedDirs)
  next.add(path)
  if (node.isLoaded) {
    if (!expandedDirs.has(path)) recomputeAndSet(get, set, { expandedDirs: next })
    return
  }

  recomputeAndSet(get, set, { expandedDirs: next })
  try {
    const children = await window.app.listDir(projectPath, path)
    const cur = get().nodes
    mergeEntries(cur, path, (cur.get(path)?.depth ?? 0) + 1, children)
    recomputeAndSet(get, set)
  } catch {
    const cur = get().nodes
    mergeEntries(cur, path, (cur.get(path)?.depth ?? 0) + 1, [])
    recomputeAndSet(get, set)
  }
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  nodes: new Map(),
  expandedDirs: new Set(),
  loadingDirs: new Set(),
  loading: false,
  renamingPath: null,
  dragOverPath: null,
  revealedPath: null,
  draft: null,
  _visibleList: [],
  _visibleVersion: 0,
  _currentRoot: null,

  fetchTree: async (projectPath) => {
    const s = get()
    if (s._currentRoot === projectPath && (s.loading || s.nodes.size > 0)) return
    set({ loading: true, _currentRoot: projectPath })
    try {
      const entries = await window.app.listDir(projectPath, '')
      if (get()._currentRoot !== projectPath) return
      const nodes = new Map<string, FlatNode>()
      const rootChildPaths = entriesToNodes(entries, '', 0, nodes)
      nodes.set('', { entry: { name: '', path: '', isDirectory: true }, depth: -1, parentPath: '', childPaths: rootChildPaths, isLoaded: true })
      const _visibleList = computeVisible(nodes, new Set(), new Set())
      set({ nodes, expandedDirs: new Set(), loadingDirs: new Set(), loading: false, draft: null, _visibleList, _visibleVersion: get()._visibleVersion + 1 })
    } catch {
      if (get()._currentRoot !== projectPath) return
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
      recomputeAndSet(get, set, { expandedDirs: next })
      return
    }

    const next = new Set(expandedDirs)
    next.add(path)

    if (loadingDirs.has(path)) {
      recomputeAndSet(get, set, { expandedDirs: next })
      return
    }

    // A collapsed directory is skipped by refreshTree (it only re-lists expanded
    // dirs), so its cached children go stale whenever a terminal or agent writes
    // into it. Always re-list on expand: an already-loaded dir shows its cached
    // children immediately and merges the fresh listing in the background; an
    // unloaded one shows the spinner until the listing lands.
    const node = nodes.get(path)
    const showSpinner = !node?.isLoaded
    const nextLoading = showSpinner ? new Set(loadingDirs).add(path) : loadingDirs
    recomputeAndSet(get, set, { expandedDirs: next, loadingDirs: nextLoading })

    const settle = (children: FileTreeEntry[] | null) => {
      const { nodes: currentNodes } = get()
      // On error keep the cached children; only a never-loaded dir settles to empty.
      if (children) mergeEntries(currentNodes, path, (currentNodes.get(path)?.depth ?? 0) + 1, children)
      else if (showSpinner) mergeEntries(currentNodes, path, (currentNodes.get(path)?.depth ?? 0) + 1, [])
      const nl = new Set(get().loadingDirs)
      nl.delete(path)
      recomputeAndSet(get, set, { loadingDirs: nl })
    }
    window.app.listDir(projectPath, path).then(settle, () => settle(null))
  },

  reset: () => {
    set({
      nodes: new Map(),
      expandedDirs: new Set(),
      loadingDirs: new Set(),
      loading: false,
      renamingPath: null,
      dragOverPath: null,
      revealedPath: null,
      draft: null,
      _visibleList: [],
      _visibleVersion: get()._visibleVersion + 1,
      _currentRoot: null,
    })
  },

  setRenamingPath: (path) => set({ renamingPath: path }),
  setDragOverPath: (path) => set({ dragOverPath: path }),

  moveFile: async (projectPath, srcPath, destDirPath) => {
    const result = await window.app.moveFile(projectPath, srcPath, destDirPath)
    if (result.ok) await get().refreshTree(projectPath)
    return result
  },

  copyFilesIn: async (projectPath, destDirPath, absolutePaths) => {
    const result = await window.app.copyFilesIn(projectPath, destDirPath, absolutePaths)
    if (result.ok) await get().refreshTree(projectPath)
    return result
  },

  moveFilesIn: async (projectPath, destDirPath, absolutePaths) => {
    const result = await window.app.moveFilesIn(projectPath, destDirPath, absolutePaths)
    if (result.ok) await get().refreshTree(projectPath)
    return result
  },

  deleteFile: async (projectPath, relPath) => {
    const result = await window.app.deleteFile(projectPath, relPath)
    if (result.ok) await get().refreshTree(projectPath)
    return result
  },

  renameFile: async (projectPath, oldPath, newName) => {
    const result = await window.app.renameFile(projectPath, oldPath, newName)
    if (result.ok) {
      set({ renamingPath: null })
      await get().refreshTree(projectPath)
    }
    return result
  },

  revealPath: async (projectPath, path) => {
    const clean = path.replace(/\/+$/, '')
    if (!clean) return
    let prefix = ''
    for (const seg of clean.split('/')) {
      prefix = prefix ? `${prefix}/${seg}` : seg
      await ensureExpanded(get, set, projectPath, prefix)
    }
    set({ revealedPath: clean })
  },

  clearRevealed: () => set({ revealedPath: null }),

  startDraft: async (projectPath, parentDir, kind) => {
    if (parentDir) await ensureExpanded(get, set, projectPath, parentDir)
    recomputeAndSet(get, set, { draft: { parentDir, kind }, renamingPath: null })
  },

  cancelDraft: () => {
    if (get().draft) recomputeAndSet(get, set, { draft: null })
  },

  createEntry: async (projectPath, name) => {
    const { draft } = get()
    if (!draft) return { ok: false, error: 'No draft entry' }
    const result = await window.app.createEntry(projectPath, draft.parentDir, name, draft.kind)
    if (!result.ok) return result
    const path = draft.parentDir ? `${draft.parentDir}/${name}` : name
    recomputeAndSet(get, set, { draft: null })
    await get().refreshTree(projectPath)
    set({ revealedPath: path })
    return { ok: true, path }
  },
}))
