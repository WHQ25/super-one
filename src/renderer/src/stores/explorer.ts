import { create } from 'zustand'
import type { FileTreeEntry } from '../../../shared/agent-types'

interface ExplorerState {
  tree: FileTreeEntry[]
  loading: boolean
  expandedDirs: Set<string>
  fetchTree: (projectPath: string) => Promise<void>
  toggleDir: (path: string) => void
  reset: () => void
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  tree: [],
  loading: false,
  expandedDirs: new Set(),

  fetchTree: async (projectPath) => {
    set({ loading: true })
    try {
      const tree = await window.app.getFileTree(projectPath)
      set({ tree, loading: false })
    } catch {
      set({ tree: [], loading: false })
    }
  },

  toggleDir: (path) => {
    set((s) => {
      const next = new Set(s.expandedDirs)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { expandedDirs: next }
    })
  },

  reset: () => set({ tree: [], loading: false, expandedDirs: new Set() }),
}))
