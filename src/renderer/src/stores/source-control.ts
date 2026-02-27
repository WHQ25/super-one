import { create } from 'zustand'
import type { GitStatusFile, GitFileDiff, GitFileContent } from '../../../shared/agent-types'

interface SourceControlState {
  files: GitStatusFile[]
  loading: boolean
  selectedFile: string | null
  fileDiff: GitFileDiff | null
  fileContent: GitFileContent | null
  activeTab: 'changes' | 'file' | 'preview'
  setActiveTab: (tab: 'changes' | 'file' | 'preview') => void
  fetchFiles: (projectPath: string) => Promise<void>
  selectFile: (projectPath: string, path: string) => Promise<void>
  clearSelection: () => void
  refresh: (projectPath: string) => Promise<void>
  reset: () => void
}

export const useSourceControlStore = create<SourceControlState>((set, get) => ({
  files: [],
  loading: false,
  selectedFile: null,
  fileDiff: null,
  fileContent: null,
  activeTab: 'changes',

  setActiveTab: (tab) => set({ activeTab: tab }),

  fetchFiles: async (projectPath) => {
    set({ loading: true })
    try {
      const files = await window.app.getGitStatusFiles(projectPath)
      set({ files, loading: false })
    } catch {
      set({ files: [], loading: false })
    }
  },

  selectFile: async (projectPath, path) => {
    const file = get().files.find((f) => f.path === path)
    const isSameFile = get().selectedFile === path
    set({ selectedFile: path })
    try {
      const [diff, content] = await Promise.all([
        window.app.getGitDiffFile(projectPath, path, file?.staged ?? false),
        window.app.getGitReadFile(projectPath, path),
      ])
      if (get().selectedFile !== path) return
      const isMd = /\.(?:md|mdx|markdown)$/i.test(path)
      const isBinaryPreview = content.language === 'image' || content.language === 'pdf' || content.language === 'video' || content.language === 'audio'
      const isSvg = content.language === 'svg'
      set({ fileDiff: diff, fileContent: content, ...(isSameFile ? {} : { activeTab: isBinaryPreview ? 'preview' : diff.diff ? 'changes' : (isMd || isSvg) ? 'preview' : 'file' }) })
    } catch {
      if (get().selectedFile !== path) return
      set({ fileDiff: null, fileContent: null })
    }
  },

  clearSelection: () => set({ selectedFile: null, fileDiff: null, fileContent: null }),

  refresh: async (projectPath) => {
    await get().fetchFiles(projectPath)
    const selected = get().selectedFile
    if (selected) {
      await get().selectFile(projectPath, selected)
    }
  },

  reset: () => set({
    files: [],
    loading: false,
    selectedFile: null,
    fileDiff: null,
    fileContent: null,
    activeTab: 'changes',
  }),
}))
