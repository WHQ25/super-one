import { create } from 'zustand'
import type { FileTreeEntry } from '../../../shared/agent-types'

function mergeChildren(tree: FileTreeEntry[], dirPath: string, children: FileTreeEntry[]): FileTreeEntry[] {
  return tree.map(entry => {
    if (entry.path === dirPath) return { ...entry, children }
    if (entry.children && dirPath.startsWith(entry.path + '/')) {
      return { ...entry, children: mergeChildren(entry.children, dirPath, children) }
    }
    return entry
  })
}

function collectUnloadedNonIgnored(entries: FileTreeEntry[], changed: string[], clean: string[]): void {
  for (const e of entries) {
    if (e.isDirectory && e.gitStatus !== '!' && e.children === undefined) {
      ;(e.gitStatus ? changed : clean).push(e.path)
    }
    if (e.children) collectUnloadedNonIgnored(e.children, changed, clean)
  }
}

interface ExplorerState {
  tree: FileTreeEntry[]
  loading: boolean
  loadingDirs: Set<string>
  expandedDirs: Set<string>
  _bgAbort: AbortController | null
  fetchTree: (projectPath: string) => Promise<void>
  refreshTree: (projectPath: string) => Promise<void>
  toggleDir: (projectPath: string, path: string) => void
  reset: () => void
}

async function loadNonIgnoredDirs(projectPath: string, get: () => ExplorerState, set: (fn: (s: ExplorerState) => Partial<ExplorerState>) => void, signal: AbortSignal) {
  while (!signal.aborted) {
    const changed: string[] = []
    const clean: string[] = []
    collectUnloadedNonIgnored(get().tree, changed, clean)
    const dirs = [...changed, ...clean]
    if (dirs.length === 0) break
    const results = await Promise.all(
      dirs.map(async (dir) => {
        try {
          return { dir, children: await window.app.listDir(projectPath, dir) }
        } catch {
          return { dir, children: [] as FileTreeEntry[] }
        }
      })
    )
    if (signal.aborted) break
    set((s) => {
      let updated = s.tree
      for (const { dir, children } of results) {
        updated = mergeChildren(updated, dir, children)
      }
      return { tree: updated }
    })
  }
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  tree: [],
  loading: false,
  loadingDirs: new Set(),
  expandedDirs: new Set(),
  _bgAbort: null,

  fetchTree: async (projectPath) => {
    get()._bgAbort?.abort()
    set({ loading: true })
    try {
      const tree = await window.app.listDir(projectPath, '')
      const abort = new AbortController()
      set({ tree, loading: false, _bgAbort: abort })
      loadNonIgnoredDirs(projectPath, get, set, abort.signal)
    } catch {
      set({ tree: [], loading: false })
    }
  },

  refreshTree: async (projectPath) => {
    get()._bgAbort?.abort()
    set({ loading: true })
    try {
      const tree = await window.app.listDir(projectPath, '')
      const abort = new AbortController()
      set({ tree, loading: false, _bgAbort: abort })
      const { expandedDirs } = get()
      if (expandedDirs.size > 0) {
        const results = await Promise.all(
          [...expandedDirs].map(async (dir) => {
            try {
              return { dir, children: await window.app.listDir(projectPath, dir) }
            } catch {
              return { dir, children: [] as FileTreeEntry[] }
            }
          })
        )
        if (!abort.signal.aborted) {
          const sorted = results.sort((a, b) => a.dir.split('/').length - b.dir.split('/').length)
          set((s) => {
            let updated = s.tree
            for (const { dir, children } of sorted) {
              updated = mergeChildren(updated, dir, children)
            }
            return { tree: updated }
          })
        }
      }
      loadNonIgnoredDirs(projectPath, get, set, abort.signal)
    } catch {
      set({ tree: [], loading: false })
    }
  },

  toggleDir: (projectPath, path) => {
    const { expandedDirs, loadingDirs, tree } = get()
    if (expandedDirs.has(path)) {
      const next = new Set(expandedDirs)
      next.delete(path)
      set({ expandedDirs: next })
      return
    }

    const next = new Set(expandedDirs)
    next.add(path)
    set({ expandedDirs: next })

    const findEntry = (entries: FileTreeEntry[], target: string): FileTreeEntry | undefined => {
      for (const e of entries) {
        if (e.path === target) return e
        if (e.children && target.startsWith(e.path + '/')) {
          const found = findEntry(e.children, target)
          if (found) return found
        }
      }
    }

    const entry = findEntry(tree, path)
    if (entry?.children !== undefined) return
    if (loadingDirs.has(path)) return

    set({ loadingDirs: new Set([...loadingDirs, path]) })
    window.app.listDir(projectPath, path).then((children) => {
      set((s) => ({
        tree: mergeChildren(s.tree, path, children),
        loadingDirs: (() => { const n = new Set(s.loadingDirs); n.delete(path); return n })(),
      }))
    }).catch(() => {
      set((s) => ({
        tree: mergeChildren(s.tree, path, []),
        loadingDirs: (() => { const n = new Set(s.loadingDirs); n.delete(path); return n })(),
      }))
    })
  },

  reset: () => {
    get()._bgAbort?.abort()
    set({ tree: [], loading: false, loadingDirs: new Set(), expandedDirs: new Set(), _bgAbort: null })
  },
}))
