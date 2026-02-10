import { create } from 'zustand'
import type { RecentFolder, SetupEvent } from '../../../shared/agent-types'

type AppView = 'startup' | 'setup' | 'main'
type InstallStatus = 'idle' | 'installing' | 'success' | 'error'

interface AppState {
  view: AppView
  currentFolder: string | null
  recentFolders: RecentFolder[]

  // Setup
  installStatus: InstallStatus
  installOutput: string

  fetchRecentFolders: () => Promise<void>
  selectAndOpenFolder: () => Promise<void>
  openFolder: (folderPath: string) => Promise<void>
  removeRecentFolder: (folderPath: string) => Promise<void>
  startInstall: () => Promise<void>
  handleSetupEvent: (event: SetupEvent) => void
  continueToMain: () => void
}

async function openFolderWithCheck(folderPath: string, set: (partial: Partial<AppState>) => void): Promise<void> {
  const ok = await window.app.openFolder(folderPath)
  if (!ok) return
  const hasClaude = await window.app.checkClaude()
  if (hasClaude) {
    set({ view: 'main', currentFolder: folderPath })
  } else {
    set({ view: 'setup', currentFolder: folderPath })
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'startup',
  currentFolder: null,
  recentFolders: [],
  installStatus: 'idle',
  installOutput: '',

  fetchRecentFolders: async () => {
    const folders = await window.app.getRecentFolders()
    set({ recentFolders: folders })
  },

  selectAndOpenFolder: async () => {
    const folderPath = await window.app.selectFolder()
    if (!folderPath) return
    await openFolderWithCheck(folderPath, set)
  },

  openFolder: async (folderPath: string) => {
    await openFolderWithCheck(folderPath, set)
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

  continueToMain: () => {
    const { currentFolder } = get()
    if (currentFolder) {
      set({ view: 'main' })
    }
  },
}))

// Load recent folders on module init
useAppStore.getState().fetchRecentFolders()
