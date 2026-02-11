import { create } from 'zustand'
import type { RecentFolder, SetupEvent } from '../../../shared/agent-types'

type AppView = 'startup' | 'setup' | 'main' | 'settings'
type InstallStatus = 'idle' | 'installing' | 'success' | 'error'
type SettingsTab = 'skills' | 'mcp' | 'plugins'
export type LayoutMode = 'canvas' | 'coding'

interface AppState {
  view: AppView
  currentFolder: string | null
  tmpFolder: string | null
  recentFolders: RecentFolder[]

  // Setup
  installStatus: InstallStatus
  installOutput: string

  // Settings
  settingsTab: SettingsTab

  // Layout mode
  layoutMode: LayoutMode
  setLayoutMode: (mode: LayoutMode) => void
  showSidebar: boolean
  setShowSidebar: (show: boolean) => void

  fetchRecentFolders: () => Promise<void>
  selectAndOpenFolder: () => Promise<void>
  selectAndSwitchFolder: () => Promise<void>
  openFolder: (folderPath: string) => Promise<void>
  openTmpFolder: () => Promise<void>
  removeRecentFolder: (folderPath: string) => Promise<void>
  startInstall: () => Promise<void>
  handleSetupEvent: (event: SetupEvent) => void
  continueToMain: () => void
  navigateTo: (view: AppView) => void
  setSettingsTab: (tab: SettingsTab) => void

  // Multi-session: switch to a project that already has an agent
  switchToProject: (folderPath: string) => void
}

async function openFolderDirect(folderPath: string, set: (partial: Partial<AppState>) => void): Promise<void> {
  const ok = await window.app.openFolder(folderPath)
  if (!ok) return
  set({ currentFolder: folderPath })
  useAppStore.getState().fetchRecentFolders()
  // Activate this project's session in chat store
  const { useChatStore } = await import('./chat')
  useChatStore.getState().ensureSession(folderPath)
  useChatStore.getState().switchProject(folderPath)
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'setup',
  currentFolder: null,
  tmpFolder: null,
  recentFolders: [],
  installStatus: 'idle',
  installOutput: '',
  settingsTab: 'skills',
  layoutMode: 'coding',
  setLayoutMode: async (mode) => {
    set({ layoutMode: mode })
    if (mode === 'coding' && !get().currentFolder) {
      const folders = get().recentFolders
      if (folders.length > 0) {
        await openFolderDirect(folders[0].path, set)
      } else {
        get().openTmpFolder()
      }
    }
  },
  showSidebar: true,
  setShowSidebar: (show) => set({ showSidebar: show }),

  fetchRecentFolders: async () => {
    const folders = await window.app.getRecentFolders()
    set({ recentFolders: folders })
  },

  selectAndOpenFolder: async () => {
    const folderPath = await window.app.selectFolder()
    if (!folderPath) return
    await openFolderDirect(folderPath, set)
  },

  selectAndSwitchFolder: async () => {
    const folderPath = await window.app.selectFolder()
    if (!folderPath) return
    const ok = await window.app.addRecentFolder(folderPath)
    if (!ok) return
    set({ currentFolder: folderPath })
    await useAppStore.getState().fetchRecentFolders()
    const { useChatStore } = await import('./chat')
    useChatStore.getState().ensureSession(folderPath)
    useChatStore.getState().switchProject(folderPath)
  },

  openFolder: async (folderPath: string) => {
    await openFolderDirect(folderPath, set)
  },

  openTmpFolder: async () => {
    const tmpPath = await window.app.openTmpFolder()
    set({ currentFolder: tmpPath, tmpFolder: tmpPath })
    // Activate tmp project session
    const { useChatStore } = await import('./chat')
    useChatStore.getState().ensureSession(tmpPath)
    useChatStore.getState().switchProject(tmpPath)
  },

  switchToProject: (folderPath: string) => {
    set({ currentFolder: folderPath })
    // Just switch the active session — no IPC call (agent may not be running)
    import('./chat').then(({ useChatStore }) => {
      useChatStore.getState().ensureSession(folderPath)
      useChatStore.getState().switchProject(folderPath)
    })
  },

  removeRecentFolder: async (folderPath: string) => {
    const updated = await window.app.removeRecentFolder(folderPath)
    set({ recentFolders: updated })
  },

  startInstall: async () => {
    set({ installStatus: 'installing', installOutput: '' })
    await window.app.installClaude()
  },

  handleSetupEvent: (event: SetupEvent) => {
    switch (event.type) {
      case 'install_output':
        set((s) => ({ installOutput: s.installOutput + event.data }))
        break
      case 'install_complete':
        set({ installStatus: event.code === 0 ? 'success' : 'error' })
        break
      case 'install_error':
        set((s) => ({
          installStatus: 'error',
          installOutput: s.installOutput + '\nError: ' + event.error,
        }))
        break
    }
  },

  continueToMain: async () => {
    set({ view: 'main' })
    if (get().layoutMode === 'coding' && !get().currentFolder) {
      // Open the most recent project if available, otherwise fall back to tmp
      const folders = get().recentFolders
      if (folders.length > 0) {
        await openFolderDirect(folders[0].path, set)
      } else {
        get().openTmpFolder()
      }
    }
  },

  navigateTo: (view) => set({ view }),

  setSettingsTab: (tab) => set({ settingsTab: tab }),
}))

/** Whether a real project (not tmp) is open */
export function useHasRealProject(): boolean {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const tmpFolder = useAppStore((s) => s.tmpFolder)
  return currentFolder !== null && currentFolder !== tmpFolder
}

// Load recent folders on module init
useAppStore.getState().fetchRecentFolders()
