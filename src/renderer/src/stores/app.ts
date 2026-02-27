import { create } from 'zustand'
import type { RecentFolder, SetupEvent, SettingsProvider, UpdateEvent } from '../../../shared/agent-types'

type AppView = 'startup' | 'setup' | 'main' | 'settings'
type InstallStatus = 'idle' | 'installing' | 'success' | 'error'
type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'
type SettingsTab = 'agents' | 'skills' | 'mcp' | 'plugins'
export type LayoutMode = 'canvas' | 'coding'
export type SidebarTab = 'sessions' | 'files'
export type FilePanelView = 'file' | 'history'

interface WorktreeState {
  pendingBaseBranch: string | null
  activePath: string | null
  carryLocalChanges: boolean
}

interface AppState {
  view: AppView
  currentFolder: string | null
  tmpFolder: string | null
  recentFolders: RecentFolder[]

  // Update
  updateStatus: UpdateStatus
  updateVersion: string | null
  updateProgress: number

  // Per-project worktree state
  _worktrees: Record<string, WorktreeState>

  // Setup
  installStatus: InstallStatus
  installOutput: string

  // Settings
  settingsProvider: SettingsProvider
  settingsTab: SettingsTab
  setSettingsProvider: (provider: SettingsProvider) => void

  // Layout mode
  layoutMode: LayoutMode
  setLayoutMode: (mode: LayoutMode) => void
  sidebarTab: SidebarTab
  setSidebarTab: (tab: SidebarTab) => void
  showSidebar: boolean
  setShowSidebar: (show: boolean) => void
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
  showFilePanel: boolean
  setShowFilePanel: (show: boolean) => void
  filePanelView: FilePanelView
  setFilePanelView: (view: FilePanelView) => void
  filePanelWidth: number
  setFilePanelWidth: (width: number) => void

  fetchRecentFolders: () => Promise<void>
  selectAndOpenFolder: () => Promise<void>
  selectAndSwitchFolder: () => Promise<void>
  openFolder: (folderPath: string) => Promise<void>
  openTmpFolder: () => Promise<void>
  removeRecentFolder: (folderPath: string) => Promise<void>
  startInstall: () => Promise<void>
  handleSetupEvent: (event: SetupEvent) => void
  continueToMain: () => Promise<void>
  navigateTo: (view: AppView) => void
  setSettingsTab: (tab: SettingsTab) => void

  // Update
  handleUpdateEvent: (event: UpdateEvent) => void
  installUpdate: () => void
  dismissUpdate: () => void

  // Multi-session: switch to a project that already has an agent
  switchToProject: (folderPath: string) => void

  // Worktree management
  setPendingWorktree: (projectPath: string, baseBranch: string) => void
  setCarryLocalChanges: (projectPath: string, carry: boolean) => void
  setActiveWorktree: (projectPath: string, path: string | null) => void
  clearWorktree: (projectPath: string) => Promise<void>
  getWorktreeState: (projectPath: string) => WorktreeState
}

async function openFolderDirect(folderPath: string, set: (partial: Partial<AppState>) => void): Promise<void> {
  const ok = await window.app.openFolder(folderPath)
  if (!ok) return
  set({ currentFolder: folderPath })
  useAppStore.getState().fetchRecentFolders()
  const { useChatStore } = await import('./chat')
  useChatStore.getState().ensureSession(folderPath)
  await useChatStore.getState().switchProject(folderPath)
  if (useAppStore.getState().view === 'startup') set({ view: 'main' })
}

async function refreshResourcesInBackground(): Promise<void> {
  try {
    console.info('[refreshResources] Calling connectClaude...')
    const result = await window.app.connectClaude()
    console.info('[refreshResources] Done:', result.models?.length, 'models')
    const { useChatStore } = await import('./chat')
    useChatStore.getState().setGlobalResources(
      result.models, result.account, result.slashCommands,
      result.userSkills, result.userCommands, result.userAgents,
    )
  } catch (err) {
    console.error('[refreshResources] Failed:', err)
  }
}

const defaultWorktreeState: WorktreeState = { pendingBaseBranch: null, activePath: null, carryLocalChanges: false }

export const useAppStore = create<AppState>((set, get) => ({
  view: 'setup',
  currentFolder: null,
  tmpFolder: null,
  recentFolders: [],
  _worktrees: {},
  updateStatus: 'idle',
  updateVersion: null,
  updateProgress: 0,
  installStatus: 'idle',
  installOutput: '',
  settingsProvider: 'claude',
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
  sidebarTab: 'sessions',
  setSidebarTab: (tab) => {
    set({ sidebarTab: tab })
    if (tab === 'sessions') {
      set({ showFilePanel: false, filePanelView: 'file' as FilePanelView })
    } else {
      import('./source-control').then(({ useSourceControlStore }) => {
        if (useSourceControlStore.getState().selectedFile) set({ showFilePanel: true, filePanelView: 'file' as FilePanelView })
      })
    }
  },
  showSidebar: true,
  setShowSidebar: (show) => set({ showSidebar: show }),
  sidebarWidth: 320,
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  showFilePanel: false,
  setShowFilePanel: (show) => set({ showFilePanel: show, ...(!show && { filePanelView: 'file' as FilePanelView }) }),
  filePanelView: 'file' as FilePanelView,
  setFilePanelView: (view) => set({ filePanelView: view }),
  filePanelWidth: 560,
  setFilePanelWidth: (width) => set({ filePanelWidth: width }),

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
    await useChatStore.getState().switchProject(folderPath)
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
    await useChatStore.getState().switchProject(tmpPath)
  },

  handleUpdateEvent: (event: UpdateEvent) => {
    switch (event.type) {
      case 'checking':
        set({ updateStatus: 'checking' })
        break
      case 'available':
        set({ updateStatus: 'available', updateVersion: event.version })
        break
      case 'not-available':
        set({ updateStatus: 'up-to-date' })
        setTimeout(() => {
          if (get().updateStatus === 'up-to-date') set({ updateStatus: 'idle' })
        }, 3000)
        break
      case 'download-progress':
        set({ updateStatus: 'downloading', updateProgress: event.percent })
        break
      case 'downloaded':
        set({ updateStatus: 'ready', updateVersion: event.version })
        break
      case 'error':
        set({ updateStatus: 'error' })
        break
    }
  },

  installUpdate: () => {
    window.app.installUpdate()
  },

  dismissUpdate: () => {
    set({ updateStatus: 'idle' })
  },

  switchToProject: async (folderPath: string) => {
    set({ currentFolder: folderPath })
    const { useChatStore } = await import('./chat')
    useChatStore.getState().ensureSession(folderPath)
    await useChatStore.getState().switchProject(folderPath)
  },

  removeRecentFolder: async (folderPath: string) => {
    const wasActive = get().currentFolder === folderPath
    // Dispose agent and clean up DB (cascade deletes sessions + messages)
    await window.app.closeProject(folderPath).catch(() => {})
    const updated = await window.app.removeRecentFolder(folderPath)
    // Clean up in-memory worktree state
    set((s) => {
      const { [folderPath]: _, ..._worktrees } = s._worktrees
      return {
        recentFolders: updated,
        _worktrees,
        ...(wasActive ? { currentFolder: null } : {}),
      }
    })
    // Clean up chat store in-memory session state
    const { useChatStore } = await import('./chat')
    useChatStore.setState((s) => {
      const { [folderPath]: _, ...projectSessions } = s.projectSessions
      return {
        projectSessions,
        ...(s.activeProject === folderPath ? { activeProject: null } : {}),
      }
    })
    if (wasActive) {
      if (updated.length > 0) {
        await openFolderDirect(updated[0].path, set)
      } else {
        set({ view: 'startup' })
      }
    }
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
    const startupData = await window.app.getStartupData()
    console.info('[continueToMain] cached:', startupData.cached ? `${startupData.cached.models?.length} models` : 'null')
    const { useChatStore } = await import('./chat')

    if (startupData.cached) {
      useChatStore.getState().setGlobalResources(
        startupData.cached.models,
        startupData.cached.account,
        startupData.cached.slashCommands,
        startupData.userSkills,
        startupData.userCommands,
        startupData.userAgents,
      )
    } else {
      console.info('[continueToMain] No cache, using empty models')
      useChatStore.getState().setGlobalResources([], {}, [], startupData.userSkills, startupData.userCommands, startupData.userAgents)
    }

    // Open default folder or show startup page
    if (get().layoutMode === 'coding' && !get().currentFolder) {
      const folders = get().recentFolders
      if (folders.length > 0) {
        set({ view: 'main' })
        await openFolderDirect(folders[0].path, set)
      } else {
        set({ view: 'startup' })
        return
      }
    } else {
      set({ view: 'main' })
    }

    // Refresh resources in background (connect to Claude SDK, update cache + store)
    refreshResourcesInBackground()
  },

  navigateTo: (view) => set({ view }),

  setSettingsProvider: (provider) => {
    const currentTab = get().settingsTab
    // Codex only supports 'skills' and 'mcp' tabs
    const needsTabSwitch = provider === 'codex' && (currentTab === 'agents' || currentTab === 'plugins')
    set({
      settingsProvider: provider,
      ...(needsTabSwitch ? { settingsTab: 'skills' } : {}),
    })
  },
  setSettingsTab: (tab) => set({ settingsTab: tab }),

  // Worktree management
  setPendingWorktree: (projectPath, baseBranch) => {
    set((s) => {
      const prev = s._worktrees[projectPath]
      return {
        _worktrees: {
          ...s._worktrees,
          [projectPath]: { pendingBaseBranch: baseBranch, activePath: prev?.activePath ?? null, carryLocalChanges: prev?.carryLocalChanges ?? false },
        },
      }
    })
  },

  setCarryLocalChanges: (projectPath, carry) => {
    set((s) => {
      const prev = s._worktrees[projectPath] ?? defaultWorktreeState
      return {
        _worktrees: {
          ...s._worktrees,
          [projectPath]: { ...prev, carryLocalChanges: carry },
        },
      }
    })
  },

  setActiveWorktree: (projectPath, path) => {
    set((s) => ({
      _worktrees: {
        ...s._worktrees,
        [projectPath]: { pendingBaseBranch: null, activePath: path, carryLocalChanges: false },
      },
    }))
  },

  clearWorktree: async (projectPath) => {
    const wt = get()._worktrees[projectPath]
    if (wt?.activePath) {
      await window.app.activateWorktree(projectPath, null)
      const { useChatStore } = await import('./chat')
      useChatStore.getState().resetSessionForWorktreeSwitch(projectPath)
    }
    set((s) => ({
      _worktrees: {
        ...s._worktrees,
        [projectPath]: { pendingBaseBranch: null, activePath: null, carryLocalChanges: false },
      },
    }))
  },

  getWorktreeState: (projectPath) => {
    return get()._worktrees[projectPath] ?? defaultWorktreeState
  },
}))

/** Whether a real project (not tmp) is open */
export function useHasRealProject(): boolean {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const tmpFolder = useAppStore((s) => s.tmpFolder)
  return currentFolder !== null && currentFolder !== tmpFolder
}

// Load recent folders on module init
useAppStore.getState().fetchRecentFolders()

// Reset file panel and source-control store when project changes
// NOTE: file-tree reset is handled by fetchTree (called from FileTree useEffect on currentFolder change)
let _prevFolder = useAppStore.getState().currentFolder
useAppStore.subscribe((state) => {
  if (state.currentFolder === _prevFolder) return
  _prevFolder = state.currentFolder
  useAppStore.setState({ showFilePanel: false })
  import('./source-control').then(({ useSourceControlStore }) => {
    useSourceControlStore.getState().reset()
  })
})
