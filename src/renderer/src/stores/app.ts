import { create } from 'zustand'
import type { RecentFolder, SetupEvent, SettingsProvider } from '../../../shared/agent-types'

type AppView = 'startup' | 'setup' | 'main' | 'settings'
type InstallStatus = 'idle' | 'installing' | 'success' | 'error'
type SettingsTab = 'agents' | 'skills' | 'mcp' | 'plugins'
export type LayoutMode = 'canvas' | 'coding'

interface WorktreeState {
  pendingBaseBranch: string | null   // Base branch to detach from
  activePath: string | null          // Worktree path currently active (agent cwd switched)
}

interface AppState {
  view: AppView
  currentFolder: string | null
  tmpFolder: string | null
  recentFolders: RecentFolder[]

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
  showSidebar: boolean
  setShowSidebar: (show: boolean) => void
  sidebarWidth: number
  setSidebarWidth: (width: number) => void

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

  // Multi-session: switch to a project that already has an agent
  switchToProject: (folderPath: string) => void

  // Worktree management
  setPendingWorktree: (projectPath: string, baseBranch: string) => void
  setActiveWorktree: (projectPath: string, path: string | null) => void
  clearWorktree: (projectPath: string) => Promise<void>
  getWorktreeState: (projectPath: string) => WorktreeState
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

async function refreshResourcesInBackground(): Promise<void> {
  try {
    const result = await window.app.connectClaude()
    const { useChatStore } = await import('./chat')
    useChatStore.getState().setGlobalResources(
      result.models, result.account, result.slashCommands,
      result.userSkills, result.userCommands, result.userAgents,
    )
  } catch (err) {
    console.warn('[refreshResourcesInBackground] Failed:', err)
  }
}

const defaultWorktreeState: WorktreeState = { pendingBaseBranch: null, activePath: null }

export const useAppStore = create<AppState>((set, get) => ({
  view: 'setup',
  currentFolder: null,
  tmpFolder: null,
  recentFolders: [],
  _worktrees: {},
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
  showSidebar: true,
  setShowSidebar: (show) => set({ showSidebar: show }),
  sidebarWidth: 256,
  setSidebarWidth: (width) => set({ sidebarWidth: width }),

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
    // Dispose agent and clean up DB (cascade deletes sessions + messages)
    await window.app.closeProject(folderPath).catch(() => {})
    const updated = await window.app.removeRecentFolder(folderPath)
    // Clean up in-memory worktree state
    set((s) => {
      const { [folderPath]: _, ..._worktrees } = s._worktrees
      return {
        recentFolders: updated,
        _worktrees,
        // If the removed project was the active one, clear it
        ...(s.currentFolder === folderPath ? { currentFolder: null } : {}),
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
    // Load cached resources + user resources from main process
    const startupData = await window.app.getStartupData()
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
      // First launch — no cache, enter main with empty data
      useChatStore.getState().setGlobalResources([], {}, [], startupData.userSkills, startupData.userCommands, startupData.userAgents)
    }

    set({ view: 'main' })

    // Open default folder
    if (get().layoutMode === 'coding' && !get().currentFolder) {
      const folders = get().recentFolders
      if (folders.length > 0) {
        await openFolderDirect(folders[0].path, set)
      } else {
        get().openTmpFolder()
      }
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
    set((s) => ({
      _worktrees: {
        ...s._worktrees,
        [projectPath]: { pendingBaseBranch: baseBranch, activePath: s._worktrees[projectPath]?.activePath ?? null },
      },
    }))
  },

  setActiveWorktree: (projectPath, path) => {
    set((s) => ({
      _worktrees: {
        ...s._worktrees,
        [projectPath]: { pendingBaseBranch: null, activePath: path },
      },
    }))
  },

  clearWorktree: async (projectPath) => {
    const wt = get()._worktrees[projectPath]
    if (wt?.activePath) {
      // Agent cwd was switched — switch back to project root
      await window.app.activateWorktree(projectPath, null)
      // Reset chat session state for the new agent
      const { useChatStore } = await import('./chat')
      useChatStore.getState().resetSessionForWorktreeSwitch(projectPath)
    }
    set((s) => ({
      _worktrees: {
        ...s._worktrees,
        [projectPath]: { pendingBaseBranch: null, activePath: null },
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
