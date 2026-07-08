import { create } from 'zustand'
import type { AppSettings, RecentFolder, RemoteDeviceConfig, SandboxCapability, SandboxProbeResult, SetupEvent, SettingsProvider, UpdateEvent, WorktreeMode } from '@superone/shared/agent-types'
import type { HarnessId } from '@superone/shared/session-types'
import {
  clampA,
  clampBrandHue,
  clampC,
  clampHue,
  clampL,
  type DesignToken,
  type LCHPartial,
  type TokenOverrides,
} from '@superone/shared/harness-brand'
import { useFileTreeStore } from './file-tree'
import { useActivityPanelStore } from './activity-panel'
import { useSourceControlStore } from './source-control'
import { disposeHighlightCache } from '@/lib/highlight-cache'

export type { RemoteDeviceConfig }

type AppView = 'loading' | 'startup' | 'setup' | 'main' | 'settings'
type InstallStatus = 'idle' | 'installing' | 'success' | 'error'
type UpdateStatus = 'idle' | 'checking' | 'preparing' | 'downloading' | 'ready' | 'up-to-date' | 'error'
export type SettingsTab = 'providers' | 'agents' | 'skills' | 'mcp' | 'plugins' | 'hooks' | 'apps' | 'preferences' | 'remote' | 'usage' | 'automations' | 'app-settings' | 'appearance' | 'browser'

const PROVIDER_SETTINGS_TABS: SettingsTab[] = ['agents', 'skills', 'mcp', 'hooks', 'plugins', 'preferences']
const FIRST_SETTINGS_SECTION: SettingsTab = 'providers'
const FIRST_PROVIDER_TAB: SettingsTab = 'agents'
export type LayoutMode = 'canvas' | 'coding'
export type SidebarTab = 'sessions' | 'files'

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
  currentProjectId: string | null
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

  // App
  appVersion: string

  // Sandbox
  sandboxCapability: SandboxCapability | null
  sandboxProbe: SandboxProbeResult | null
  probeSandbox: (force?: boolean) => Promise<SandboxProbeResult>

  // Settings
  settingsProvider: SettingsProvider
  settingsTab: SettingsTab
  settingsProviderTabs: Record<SettingsProvider, SettingsTab>
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

  // Bumped whenever a session is mutated outside the sidebar (e.g. header menu pin/hide/rename)
  // so the sidebar can reload its locally-held session list.
  sessionListNonce: number
  bumpSessionListNonce: () => void

  fetchRecentFolders: () => Promise<void>
  // Unified project-switch entry. Omit folderPath to prompt a system folder picker.
  // Aligns app-level currentFolder with chat-level activeProject.
  selectProject: (folderPath?: string) => Promise<void>
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

  // Remote control
  remoteConfig: RemoteDeviceConfig | null
  loadRemoteConfig: () => Promise<void>
  setRemoteConfig: (config: RemoteDeviceConfig) => void

  // Brand hue (per-harness, light mode only)
  brandHues: Record<HarnessId, number | null>
  loadBrandHues: () => Promise<void>
  setBrandHue: (harness: HarnessId, hue: number | null) => Promise<void>

  // Terminal display settings
  terminalLightPalette: string | null
  terminalDarkPalette: string | null
  terminalFontSize: number
  terminalFontFamily: string | null
  uiFontFamily: string | null
  liquidGlass: boolean
  setTerminalPalette: (scheme: 'light' | 'dark', id: string | null) => Promise<void>
  setTerminalFontSize: (size: number) => Promise<void>
  setTerminalFontFamily: (family: string | null) => Promise<void>
  setUiFontFamily: (family: string | null) => Promise<void>
  setLiquidGlass: (enabled: boolean) => Promise<void>

  // Per-token LCH overrides (per-harness, light mode only)
  tokenOverrides: Record<HarnessId, TokenOverrides>
  setTokenOverride: (harness: HarnessId, token: DesignToken, partial: LCHPartial) => Promise<void>
  resetTokenOverride: (harness: HarnessId, token: DesignToken) => Promise<void>
  resetAllTokenOverrides: (harness: HarnessId) => Promise<void>

  // Worktree management
  setPendingWorktree: (projectPath: string, baseBranch: string) => void
  setPendingMode: (projectPath: string, mode: WorktreeMode) => void
  setPendingBranchName: (projectPath: string, name: string) => void
  setPendingCarryLocalChanges: (projectPath: string, carry: boolean) => void
  setActiveWorktree: (projectPath: string, path: string | null) => void
  switchToExistingWorktree: (projectPath: string, wtPath: string, gitBranch: string | null) => Promise<{ ok: true } | { ok: false; error: string }>
  clearWorktree: (projectPath: string) => Promise<void>
  clearPendingWorktree: (projectPath: string) => void
  getWorktreeState: (projectPath: string) => WorktreeState
}

function prefetchFileTree(folderPath: string): void {
  void useFileTreeStore.getState().fetchTree(folderPath)
}

async function applyProjectSelection(folderPath: string, set: (partial: Partial<AppState>) => void): Promise<boolean> {
  const ok = await window.app.openFolder(folderPath)
  if (!ok) return false
  useAppStore.getState().fetchRecentFolders()
  const { useChatStore } = await import('./chat')
  useChatStore.getState().ensureSession(folderPath)
  // currentFolder / currentProjectId mirror chat.activeProject — see subscription at file end.
  await useChatStore.getState().focusProject(folderPath)
  if (useAppStore.getState().view === 'startup') set({ view: 'main' })
  return true
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
  currentProjectId: null,
  tmpFolder: null,
  recentFolders: [],
  _worktrees: {},
  updateStatus: 'idle',
  updateVersion: null,
  updateProgress: 0,
  installStatus: 'idle',
  installOutput: '',
  appVersion: '',
  sandboxCapability: null,
  sandboxProbe: null,
  probeSandbox: async (force?: boolean) => {
    if (!force) {
      const cached = get().sandboxProbe
      if (cached) return cached
    }
    const result = await window.app.probeSandbox()
    set({ sandboxProbe: result })
    return result
  },
  remoteConfig: null,
  settingsProvider: 'claude',
  settingsTab: FIRST_SETTINGS_SECTION,
  settingsProviderTabs: { claude: FIRST_PROVIDER_TAB, codex: FIRST_PROVIDER_TAB },
  layoutMode: 'coding',
  setLayoutMode: async (mode) => {
    set({ layoutMode: mode })
    if (mode === 'coding' && !get().currentFolder) {
      const folders = get().recentFolders
      if (folders.length > 0) {
        await applyProjectSelection(folders[0].path, set)
      } else {
        get().openTmpFolder()
      }
    }
  },
  sidebarTab: 'sessions',
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  showSidebar: true,
  setShowSidebar: (show) => set({ showSidebar: show }),
  sessionListNonce: 0,
  bumpSessionListNonce: () => set((s) => ({ sessionListNonce: s.sessionListNonce + 1 })),
  sidebarWidth: 320,
  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  fetchRecentFolders: async () => {
    const folders = await window.app.getRecentFolders()
    set({ recentFolders: folders })
  },

  selectProject: async (folderPath?: string) => {
    const path = folderPath ?? await window.app.selectFolder()
    if (!path) return
    await applyProjectSelection(path, set)
  },

  openTmpFolder: async () => {
    const tmpPath = await window.app.openTmpFolder()
    set({ tmpFolder: tmpPath })
    const { useChatStore } = await import('./chat')
    useChatStore.getState().ensureSession(tmpPath)
    await useChatStore.getState().focusProject(tmpPath)
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

  removeRecentFolder: async (folderPath: string) => {
    const wasActive = get().currentFolder === folderPath
    // Dispose agent and clean up DB (cascade deletes sessions + messages)
    await window.app.closeProject(folderPath).catch(() => {})
    disposeHighlightCache(folderPath)
    const updated = await window.app.removeRecentFolder(folderPath)
    // Clean up in-memory worktree state
    set((s) => {
      const { [folderPath]: _, ..._worktrees } = s._worktrees
      return { recentFolders: updated, _worktrees }
    })
    // Clean up chat store in-memory session state; clearing activeProject mirrors to currentFolder.
    const { useChatStore } = await import('./chat')
    useChatStore.setState((s) => {
      const { [folderPath]: _, ...projectSessions } = s.projectSessions
      return {
        projectSessions,
        ...(wasActive ? { activeProject: null } : {}),
      }
    })
    if (wasActive) {
      // Try each remaining folder in turn — a stale entry (deleted/renamed dir) fails to open,
      // so falling back to only updated[0] would leave activeProject null on a 'main' view and
      // blank out the status bar. Mirror continueToMain's loop: select the first that opens,
      // otherwise drop to startup.
      let opened = false
      for (const folder of updated) {
        if (await applyProjectSelection(folder.path, set)) {
          opened = true
          break
        }
      }
      if (!opened) set({ view: 'startup' })
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
    set({ recentFolders: folders, sandboxCapability: startupData.sandboxCapability ?? null, appVersion: startupData.appVersion })
    console.info(
      '[continueToMain] cached: claude=%s codex=%s sandbox=%s',
      startupData.cached.claude ? `${startupData.cached.claude.models?.length ?? 0} models` : 'null',
      startupData.cached.codex ? `${startupData.cached.codex.models?.length ?? 0} models` : 'null',
      startupData.sandboxCapability?.supportLevel ?? 'unknown',
    )
    if (startupData.sandboxCapability) {
      const { invalidateDefaultPermissionModeCache } = await import('./chat')
      invalidateDefaultPermissionModeCache()
    }
    const { useChatStore } = await import('./chat')

    if (startupData.cached.claude) {
      useChatStore.getState().setHarnessResources('claude', startupData.cached.claude)
    }
    if (startupData.cached.codex) {
      useChatStore.getState().setHarnessResources('codex', startupData.cached.codex)
    }

    void useChatStore.getState().initializeHarness('claude')

    if (get().layoutMode === 'coding' && !get().currentFolder) {
      let opened = false
      for (const folder of folders) {
        if (await applyProjectSelection(folder.path, set)) {
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
    set({ view })
  },

  setSettingsProvider: (provider) => {
    const { settingsProvider: prev, settingsTab, settingsProviderTabs } = get()
    if (provider === prev) return
    const nextTabs = { ...settingsProviderTabs }
    if (PROVIDER_SETTINGS_TABS.includes(settingsTab)) nextTabs[prev] = settingsTab
    set({
      settingsProvider: provider,
      settingsTab: nextTabs[provider] ?? FIRST_PROVIDER_TAB,
      settingsProviderTabs: nextTabs,
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

  clearPendingWorktree: (projectPath) => {
    set((s) => {
      const prev = s._worktrees[projectPath] ?? defaultWorktreeState
      return {
        _worktrees: {
          ...s._worktrees,
          [projectPath]: {
            ...prev,
            pendingBaseBranch: null,
            pendingMode: 'branch',
            pendingBranchName: '',
            pendingCarryLocalChanges: false,
          },
        },
      }
    })
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

  brandHues: { claude: null, codex: null },
  tokenOverrides: { claude: {}, codex: {} },
  terminalLightPalette: null,
  terminalDarkPalette: null,
  terminalFontSize: 14,
  terminalFontFamily: null,
  uiFontFamily: null,
  liquidGlass: false,

  loadBrandHues: async () => {
    try {
      const settings = await window.app.getAppSettings()
      set({
        brandHues: {
          claude: settings.agentPreference.claude.brandHue,
          codex: settings.agentPreference.codex.brandHue,
        },
        tokenOverrides: {
          claude: settings.agentPreference.claude.tokenOverrides ?? {},
          codex: settings.agentPreference.codex.tokenOverrides ?? {},
        },
        terminalLightPalette: settings.terminalLightPalette,
        terminalDarkPalette: settings.terminalDarkPalette,
        terminalFontSize: settings.terminalFontSize,
        terminalFontFamily: settings.terminalFontFamily,
        uiFontFamily: settings.uiFontFamily,
        liquidGlass: settings.liquidGlass,
      })
    } catch (err) {
      console.error('[brand-hue] loadBrandHues failed:', err)
    }
  },

  setTerminalFontFamily: async (family) => {
    set({ terminalFontFamily: family })
    void window.app
      .saveAppSettings({ terminalFontFamily: family })
      .catch((err) => console.error('[terminal-font] persist failed:', err))
  },

  setUiFontFamily: async (family) => {
    set({ uiFontFamily: family })
    void window.app
      .saveAppSettings({ uiFontFamily: family })
      .catch((err) => console.error('[ui-font] persist failed:', err))
  },

  setLiquidGlass: async (enabled) => {
    set({ liquidGlass: enabled })
    void window.app
      .saveAppSettings({ liquidGlass: enabled })
      .catch((err) => console.error('[liquid-glass] persist failed:', err))
  },

  setTerminalPalette: async (scheme, id) => {
    set(scheme === 'dark' ? { terminalDarkPalette: id } : { terminalLightPalette: id })
    const patch = scheme === 'dark' ? { terminalDarkPalette: id } : { terminalLightPalette: id }
    void window.app
      .saveAppSettings(patch)
      .catch((err) => console.error('[terminal-palette] persist failed:', err))
  },

  setTerminalFontSize: async (size) => {
    set({ terminalFontSize: size })
    void window.app
      .saveAppSettings({ terminalFontSize: size })
      .catch((err) => console.error('[terminal-font] persist failed:', err))
  },

  setBrandHue: async (harness, hue) => {
    const normalized = hue === null ? null : clampBrandHue(hue)
    set({ brandHues: { ...get().brandHues, [harness]: normalized } })
    schedulePersist(harness, get)
  },

  setTokenOverride: async (harness, token, partial) => {
    const current = get().tokenOverrides[harness]
    const prev = current[token] ?? {}
    const merged: LCHPartial = { ...prev }
    if (partial.l !== undefined) merged.l = clampL(partial.l)
    if (partial.c !== undefined) merged.c = clampC(partial.c)
    if (partial.h !== undefined) merged.h = clampHue(partial.h)
    if (partial.a !== undefined) merged.a = clampA(partial.a)
    const nextHarness: TokenOverrides = { ...current, [token]: merged }
    const nextAll: Record<HarnessId, TokenOverrides> = { ...get().tokenOverrides, [harness]: nextHarness }
    set({ tokenOverrides: nextAll })
    schedulePersist(harness, get)
  },

  resetTokenOverride: async (harness, token) => {
    const current = get().tokenOverrides[harness]
    if (!(token in current)) return
    const nextHarness: TokenOverrides = { ...current }
    delete nextHarness[token]
    const nextAll: Record<HarnessId, TokenOverrides> = { ...get().tokenOverrides, [harness]: nextHarness }
    set({ tokenOverrides: nextAll })
    schedulePersist(harness, get)
  },

  resetAllTokenOverrides: async (harness) => {
    const nextAll: Record<HarnessId, TokenOverrides> = { ...get().tokenOverrides, [harness]: {} }
    set({ tokenOverrides: nextAll })
    schedulePersist(harness, get)
  },
}))

const PERSIST_DELAY_MS = 150
const persistTimers: { claude?: ReturnType<typeof setTimeout>; codex?: ReturnType<typeof setTimeout> } = {}

function schedulePersist(harness: HarnessId, getState: () => AppState): void {
  const existing = persistTimers[harness]
  if (existing) clearTimeout(existing)
  persistTimers[harness] = setTimeout(() => {
    delete persistTimers[harness]
    const state = getState()
    void window.app.saveAppSettings({
      agentPreference: {
        [harness]: {
          brandHue: state.brandHues[harness],
          tokenOverrides: state.tokenOverrides[harness],
        },
      },
    }).catch((err) => console.error('[brand-theme] persist failed:', err))
  }, PERSIST_DELAY_MS)
}

/** Whether a real project (not tmp) is open */
export function useHasRealProject(): boolean {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const tmpFolder = useAppStore((s) => s.tmpFolder)
  return currentFolder !== null && currentFolder !== tmpFolder
}

export function selectEffectiveProjectRoot(s: AppState): string | null {
  const cf = s.currentFolder
  if (!cf) return null
  return s._worktrees[cf]?.activePath ?? cf
}

export function useEffectiveProjectRoot(): string | null {
  return useAppStore(selectEffectiveProjectRoot)
}



// Reset file panel and source-control store when project changes
if (typeof window !== 'undefined') {
  window.app?.onRecentFoldersChanged?.(() => {
    useAppStore.getState().fetchRecentFolders()
  })

  // Sync brand hues / token overrides across BrowserWindows. Main process
  // broadcasts the latest AppSettings after every save; each window mirrors
  // the brand-related slices into its local store so useHarnessTheme reacts.
  window.app?.onAppSettingsChange?.((settings: AppSettings) => {
    const claude = settings.agentPreference.claude
    const codex = settings.agentPreference.codex
    useAppStore.setState({
      brandHues: { claude: claude.brandHue, codex: codex.brandHue },
      tokenOverrides: {
        claude: claude.tokenOverrides ?? {},
        codex: codex.tokenOverrides ?? {},
      },
      terminalLightPalette: settings.terminalLightPalette,
      terminalDarkPalette: settings.terminalDarkPalette,
      terminalFontSize: settings.terminalFontSize,
      terminalFontFamily: settings.terminalFontFamily,
      uiFontFamily: settings.uiFontFamily,
      liquidGlass: settings.liquidGlass,
    })
  })
}

// NOTE: file-tree reset is handled by fetchTree (called from FileTree useEffect on currentFolder change).
// ActivityPanel showPanel is managed per-session by activity-view-state — do not reset here.
let _prevFolder = useAppStore.getState().currentFolder
useAppStore.subscribe((state) => {
  if (state.currentFolder === _prevFolder) return
  _prevFolder = state.currentFolder
  useSourceControlStore.getState().reset()
})

// currentFolder / currentProjectId mirror chat.activeProject — chat is the single source of
// truth for "which project". activeProject's only writers are focusProject + removeRecentFolder.
// Wired once at app boot (App.tsx / MiniWindowApp) via startProjectMirror — not at module load,
// to avoid a store-init circular-import race.
interface ChatStoreMirror {
  getState: () => { activeProject: string | null }
  subscribe: (listener: () => void) => () => void
}

let _projectMirrorStarted = false

export function startProjectMirror(chatStore: ChatStoreMirror): void {
  if (_projectMirrorStarted) return
  _projectMirrorStarted = true
  // Seed with a value that can never equal activeProject so the first sync always runs —
  // subscribe() never replays the current value, so if activeProject is already set when the
  // mirror starts (HMR store re-create, late wire-up), currentFolder would stay stale otherwise.
  let prevActiveProject: string | null | undefined = undefined
  const sync = () => {
    const projectPath = chatStore.getState().activeProject
    if (projectPath === prevActiveProject) return
    prevActiveProject = projectPath
    useAppStore.setState({ currentFolder: projectPath })
    if (!projectPath) {
      useAppStore.setState({ currentProjectId: null })
      return
    }
    prefetchFileTree(projectPath)
    void Promise.resolve()
      .then(() => window.app.getProjectId(projectPath))
      .then((projectId) => {
        if (chatStore.getState().activeProject === projectPath) {
          useAppStore.setState({ currentProjectId: projectId })
        }
      })
      .catch(() => {})
  }
  sync()
  chatStore.subscribe(sync)
}
