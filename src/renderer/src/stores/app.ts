import { create } from 'zustand'
import type { RecentFolder, RemoteDeviceConfig, SetupEvent, SettingsProvider, UpdateEvent, WorktreeMode } from '../../../shared/agent-types'
import { useFileTreeStore } from './file-tree'
import { perfEvent } from '@/lib/perf-trace'
import { disposeHighlightCache } from '@/lib/highlight-cache'

export type { RemoteDeviceConfig }

type AppView = 'loading' | 'startup' | 'setup' | 'main' | 'settings'
type InstallStatus = 'idle' | 'installing' | 'success' | 'error'
type UpdateStatus = 'idle' | 'checking' | 'preparing' | 'downloading' | 'ready' | 'up-to-date' | 'error'
export type SettingsTab = 'providers' | 'agents' | 'skills' | 'mcp' | 'plugins' | 'apps' | 'preferences' | 'remote' | 'automations' | 'app-settings'
export type LayoutMode = 'canvas' | 'coding'
export type SidebarTab = 'sessions' | 'files' | `miniapp:${string}`

interface WorktreeState {
  pendingBaseBranch: string | null
  pendingMode: WorktreeMode
  pendingBranchName: string
  pendingCarryLocalChanges: boolean
  activePath: string | null
}

function createRemoteDeviceConfig(): RemoteDeviceConfig {
  return {
    enabled: false,
    masterSecret: Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    deviceId: crypto.randomUUID(),
    preventSleep: false,
    relayUrl: '',
  }
}

function normalizeRemoteDeviceConfig(config: RemoteDeviceConfig): RemoteDeviceConfig {
  return {
    ...config,
    preventSleep: config.preventSleep ?? false,
    relayUrl: config.relayUrl ?? '',
  }
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

  // Remote control
  remoteConfig: RemoteDeviceConfig | null
  loadRemoteConfig: () => Promise<void>
  setRemoteConfig: (config: RemoteDeviceConfig) => void

  // Worktree management
  setPendingWorktree: (projectPath: string, baseBranch: string) => void
  setPendingMode: (projectPath: string, mode: WorktreeMode) => void
  setPendingBranchName: (projectPath: string, name: string) => void
  setPendingCarryLocalChanges: (projectPath: string, carry: boolean) => void
  setActiveWorktree: (projectPath: string, path: string | null) => void
  switchToExistingWorktree: (projectPath: string, wtPath: string, gitBranch: string | null) => Promise<{ ok: true } | { ok: false; error: string }>
  clearWorktree: (projectPath: string) => Promise<void>
  getWorktreeState: (projectPath: string) => WorktreeState
}

function prefetchFileTree(folderPath: string): void {
  void useFileTreeStore.getState().fetchTree(folderPath)
}

async function openFolderDirect(folderPath: string, set: (partial: Partial<AppState>) => void): Promise<boolean> {
  const ok = await window.app.openFolder(folderPath)
  if (!ok) return false
  set({ currentFolder: folderPath })
  prefetchFileTree(folderPath)
  useAppStore.getState().fetchRecentFolders()
  const { useChatStore } = await import('./chat')
  useChatStore.getState().ensureSession(folderPath)
  await useChatStore.getState().switchProject(folderPath)
  if (useAppStore.getState().view === 'startup') set({ view: 'main' })
  return true
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
      undefined, result.availableOutputStyles,
    )
  } catch (err) {
    console.error('[refreshResources] Failed:', err)
  }
}

const defaultWorktreeState: WorktreeState = {
  pendingBaseBranch: null,
  pendingMode: 'branch',
  pendingBranchName: '',
  pendingCarryLocalChanges: false,
  activePath: null,
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'loading',
  currentFolder: null,
  tmpFolder: null,
  recentFolders: [],
  _worktrees: {},
  updateStatus: 'idle',
  updateVersion: null,
  updateProgress: 0,
  installStatus: 'idle',
  installOutput: '',
  remoteConfig: null,
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
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  showSidebar: true,
  setShowSidebar: (show) => set({ showSidebar: show }),
  sidebarWidth: 320,
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
    prefetchFileTree(folderPath)
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
    prefetchFileTree(tmpPath)
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
        set({ updateStatus: 'preparing', updateVersion: event.version, updateProgress: 0 })
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
    prefetchFileTree(folderPath)
    const { useChatStore } = await import('./chat')
    useChatStore.getState().ensureSession(folderPath)
    await useChatStore.getState().switchProject(folderPath)
  },

  removeRecentFolder: async (folderPath: string) => {
    const wasActive = get().currentFolder === folderPath
    // Dispose agent and clean up DB (cascade deletes sessions + messages)
    await window.app.closeProject(folderPath).catch(() => {})
    disposeHighlightCache(folderPath)
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
    const [startupData, folders] = await Promise.all([
      window.app.getStartupData(),
      window.app.getRecentFolders(),
    ])
    set({ recentFolders: folders })
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
        startupData.cached.codexModels,
      )
    } else {
      console.info('[continueToMain] No cache, using empty models')
      useChatStore.getState().setGlobalResources([], {}, [], startupData.userSkills, startupData.userCommands, startupData.userAgents)
    }

    refreshResourcesInBackground()

    if (get().layoutMode === 'coding' && !get().currentFolder) {
      let opened = false
      for (const folder of folders) {
        if (await openFolderDirect(folder.path, set)) {
          opened = true
          break
        }
      }
      if (!opened) {
        set({ view: 'startup' })
        return
      }
      set({ view: 'main' })
    } else {
      set({ view: 'main' })
    }
  },

  navigateTo: (view) => {
    perfEvent('navigate', { from: get().view, to: view })
    set({ view })
  },

  setSettingsProvider: (provider) => {
    const currentTab = get().settingsTab
    const needsTabSwitch = provider === 'codex' && (currentTab === 'providers' || currentTab === 'agents' || currentTab === 'preferences')
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
        [projectPath]: {
          pendingBaseBranch: baseBranch,
          pendingMode: 'branch',
          pendingBranchName: '',
          pendingCarryLocalChanges: false,
          activePath: null,
        },
      },
    }))
  },

  setPendingMode: (projectPath, mode) => {
    set((s) => {
      const prev = s._worktrees[projectPath] ?? defaultWorktreeState
      return {
        _worktrees: {
          ...s._worktrees,
          [projectPath]: { ...prev, pendingMode: mode },
        },
      }
    })
  },

  setPendingBranchName: (projectPath, name) => {
    set((s) => {
      const prev = s._worktrees[projectPath] ?? defaultWorktreeState
      return {
        _worktrees: {
          ...s._worktrees,
          [projectPath]: { ...prev, pendingBranchName: name },
        },
      }
    })
  },

  setPendingCarryLocalChanges: (projectPath, carry) => {
    set((s) => {
      const prev = s._worktrees[projectPath] ?? defaultWorktreeState
      return {
        _worktrees: {
          ...s._worktrees,
          [projectPath]: { ...prev, pendingCarryLocalChanges: carry },
        },
      }
    })
  },

  setActiveWorktree: (projectPath, path) => {
    set((s) => ({
      _worktrees: {
        ...s._worktrees,
        [projectPath]: {
          pendingBaseBranch: null,
          pendingMode: 'branch',
          pendingBranchName: '',
          pendingCarryLocalChanges: false,
          activePath: path,
        },
      },
    }))
  },

  switchToExistingWorktree: async (projectPath, wtPath, gitBranch) => {
    const result = await window.app.switchToExistingWorktree(projectPath, wtPath, gitBranch)
    if (!result.ok) return result
    const { useChatStore } = await import('./chat')
    useChatStore.getState().resetSessionForWorktreeSwitch(projectPath, { wtPath, gitBranch })
    set((s) => ({
      _worktrees: {
        ...s._worktrees,
        [projectPath]: {
          pendingBaseBranch: null,
          pendingMode: 'branch',
          pendingBranchName: '',
          pendingCarryLocalChanges: false,
          activePath: wtPath,
        },
      },
    }))
    return { ok: true as const }
  },

  clearWorktree: async (projectPath) => {
    await window.app.activateWorktree(projectPath, null)
    const { useChatStore } = await import('./chat')
    useChatStore.getState().resetSessionForWorktreeSwitch(projectPath)
    set((s) => ({
      _worktrees: {
        ...s._worktrees,
        [projectPath]: {
          pendingBaseBranch: null,
          pendingMode: 'branch',
          pendingBranchName: '',
          pendingCarryLocalChanges: false,
          activePath: null,
        },
      },
    }))
  },

  getWorktreeState: (projectPath) => {
    return get()._worktrees[projectPath] ?? defaultWorktreeState
  },

  loadRemoteConfig: async () => {
    const initial = get().remoteConfig ?? createRemoteDeviceConfig()
    if (!get().remoteConfig) set({ remoteConfig: initial })
    try {
      const saved = await window.app.getRemoteConfig()
      if (saved) {
        set({ remoteConfig: normalizeRemoteDeviceConfig(saved) })
        return
      }
      await window.app.saveRemoteConfig(initial)
    } catch (err) {
      console.error('[remote] loadRemoteConfig failed:', err)
    }
  },

  setRemoteConfig: (config) => {
    set({ remoteConfig: config })
    window.app.saveRemoteConfig(config)
  },
}))

/** Whether a real project (not tmp) is open */
export function useHasRealProject(): boolean {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const tmpFolder = useAppStore((s) => s.tmpFolder)
  return currentFolder !== null && currentFolder !== tmpFolder
}



// Reset file panel and source-control store when project changes
if (typeof window !== 'undefined') {
  window.app?.onRecentFoldersChanged?.(() => {
    useAppStore.getState().fetchRecentFolders()
  })
}

// NOTE: file-tree reset is handled by fetchTree (called from FileTree useEffect on currentFolder change)
let _prevFolder = useAppStore.getState().currentFolder
useAppStore.subscribe((state) => {
  if (state.currentFolder === _prevFolder) return
  _prevFolder = state.currentFolder
  import('./activity-panel').then(({ useActivityPanelStore }) => {
    useActivityPanelStore.getState().setShowPanel(false)
  })
  import('./source-control').then(({ useSourceControlStore }) => {
    useSourceControlStore.getState().reset()
  })
})
