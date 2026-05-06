import { create } from 'zustand'
import type { GitStatusFile, GitFileDiff, GitFileContent } from '@superone/shared/agent-types'
import { parseFileLinkTarget } from '@/lib/file-link'

interface SourceControlState {
  files: GitStatusFile[]
  loading: boolean
  selectedFile: string | null
  fileDiff: GitFileDiff | null
  fileContent: GitFileContent | null
  activeTab: 'changes' | 'file' | 'preview'
  scrollToLine: { line: number; seq: number } | null
  setActiveTab: (tab: 'changes' | 'file' | 'preview') => void
  fetchFiles: (projectPath: string) => Promise<void>
  selectFile: (projectPath: string, path: string, lineNumber?: number) => Promise<void>
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
  scrollToLine: null,

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

  selectFile: async (projectPath, path, lineNumber) => {
    const parsed = parseFileLinkTarget(path)
    const targetPath = parsed.filePath
    const targetLineNumber = lineNumber ?? parsed.lineNumber
    const file = get().files.find((f) => f.path === targetPath)
    const isSameFile = get().selectedFile === targetPath
    set({ selectedFile: targetPath, ...(targetLineNumber != null ? { scrollToLine: { line: targetLineNumber, seq: Date.now() } } : isSameFile ? {} : { scrollToLine: null }) })
    try {
      const [diff, content] = await Promise.all([
        window.app.getGitDiffFile(projectPath, targetPath, file?.staged ?? false),
        window.app.getGitReadFile(projectPath, targetPath),
      ])
      if (get().selectedFile !== targetPath) return
      const isMd = /\.(?:md|mdx|markdown)$/i.test(targetPath)
      const isBinaryPreview = content.language === 'image' || content.language === 'pdf' || content.language === 'video' || content.language === 'audio'
      const isSvg = content.language === 'svg'
      const autoTab = targetLineNumber ? 'file' : isBinaryPreview ? 'preview' : diff.diff ? 'changes' : (isMd || isSvg) ? 'preview' : 'file'
      set({ fileDiff: diff, fileContent: content, ...(isSameFile && !targetLineNumber ? {} : { activeTab: autoTab }) })
    } catch {
      if (get().selectedFile !== targetPath) return
      set({ fileDiff: null, fileContent: null })
    }
  },

  clearSelection: () => set({ selectedFile: null, fileDiff: null, fileContent: null, scrollToLine: null }),

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
    scrollToLine: null,
  }),
}))
