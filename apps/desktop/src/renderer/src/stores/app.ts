import { create } from 'zustand'
import type { AppSettings, RecentFolder, RemoteDeviceConfig, SandboxCapability, SandboxProbeResult, SetupEvent, SettingsProvider, StartupData, UpdateChannel, UpdateEvent, WorktreeMode } from '@superone/shared/agent-types'
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
import { resolveProvider } from './chat-store/helpers/provider-routing'
import type { HarnessCatalogStatus } from '@/lib/harness-visibility'
import { useFileTreeStore } from './file-tree'
import { useActivityPanelStore } from './activity-panel'
import { useSourceControlStore } from './source-control'
import { disposeHighlightCache } from '@/lib/highlight-cache'
import {
  parseRemoteProjectKey,
  projectBelongsToHost,
  remoteProjectKey,
} from '@/lib/remote-project-key'

export {
  parseRemoteProjectKey,
  projectBelongsToHost,
  remoteProjectKey,
} from '@/lib/remote-project-key'

export type { RemoteDeviceConfig }

type AppView =
  | 'loading'
  | 'onboarding'
  | 'harness-align'
  | 'startup'
  | 'setup'
  | 'main'
  | 'settings'

export type OnboardingStep = 'welcome' | 'discover'
type InstallStatus = 'idle' | 'installing' | 'success' | 'error'
type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'preparing'
  | 'downloading'
  | 'downloading-harness'
  | 'harness-error'
  | 'ready'
  | 'up-to-date'
  | 'error'
export type SettingsTab = 'providers' | 'agents' | 'skills' | 'mcp' | 'plugins' | 'hooks' | 'apps' | 'preferences' | 'remote' | 'usage' | 'automations' | 'app-settings' | 'appearance' | 'browser' | 'computer-use' | 'harnesses'

/** Nested config pages opened from Settings → Harnesses (reuse existing page components). */
export type HarnessConfigSection =
  | 'agents'
  | 'skills'
  | 'mcp'
  | 'hooks'
  | 'plugins'
  | 'preferences'
  | 'account'
  | 'cloud'
  | 'models'

const PROVIDER_SETTINGS_TABS: SettingsTab[] = ['agents', 'skills', 'mcp', 'hooks', 'plugins', 'preferences']
/** Cursor-only nested sections — not legacy sidebar deep-links. */
const CURSOR_HARNESS_SECTIONS: HarnessConfigSection[] = ['account', 'cloud', 'models']
const FIRST_SETTINGS_SECTION: SettingsTab = 'app-settings'
const FIRST_PROVIDER_TAB: SettingsTab = 'agents'

function isHarnessConfigSection(tab: string): tab is HarnessConfigSection {
  return (
    (PROVIDER_SETTINGS_TABS as string[]).includes(tab)
    || (CURSOR_HARNESS_SECTIONS as string[]).includes(tab)
  )
}
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
    relayUrl: '',
  }
}

function normalizeRemoteDeviceConfig(config: RemoteDeviceConfig): RemoteDeviceConfig {
  return {
    ...config,
    relayUrl: config.relayUrl ?? '',
  }
}

interface AppState {
  view: AppView
  currentFolder: string | null
  currentProjectId: string | null
  tmpFolder: string | null
  recentFolders: RecentFolder[]

  /**
   * Sidebar host filter: `local` or a remote environment connectionId.
   * Projects list reflects this host only.
   */
  selectedHostConnectionId: string
  isSwitchingHostProject: boolean
  setSelectedHostConnectionId: (connectionId: string) => void

  // Update
  updateStatus: UpdateStatus
  updateVersion: string | null
  updateProgress: number
  /** Which phase is producing updateProgress (app binary vs harness pre-fetch). */
  updatePhase: 'app' | 'harness' | null
  updateHarnessId: string | null
  updateErrorMessage: string | null

  // Per-project worktree state
  _worktrees: Record<string, WorktreeState>

  // Setup
  installStatus: InstallStatus
  installOutput: string

  // First-run harness onboarding
  onboardingStep: OnboardingStep
  goToOnboardingStep: (step: OnboardingStep) => void
  completeOnboarding: () => Promise<void>
  /** After pin-align gate succeeds, open main/startup. */
  finishHarnessAlign: () => Promise<void>

  // App
  appVersion: string
  appVariant: UpdateChannel

  // Sandbox
  sandboxCapability: SandboxCapability | null
  sandboxProbe: SandboxProbeResult | null
  probeSandbox: (force?: boolean) => Promise<SandboxProbeResult>

  // Settings
  settingsProvider: SettingsProvider
  settingsTab: SettingsTab
  settingsProviderTabs: Record<SettingsProvider, SettingsTab>
  /** When on harnesses tab, optional nested page (preferences / mcp / …). */
  harnessConfigSection: HarnessConfigSection | null
  setSettingsProvider: (provider: SettingsProvider) => void
  setHarnessConfigSection: (section: HarnessConfigSection | null) => void

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
  // `connectionId` defaults to selectedHostConnectionId; remote skips local openFolder.
  selectProject: (
    folderPath?: string,
    options?: { connectionId?: string; projectId?: string; carryOpenDraft?: boolean },
  ) => Promise<void>
  openTmpFolder: () => Promise<void>
  removeRecentFolder: (folderPath: string) => Promise<void>
  startInstall: () => Promise<void>
  handleSetupEvent: (event: SetupEvent) => void
  continueToMain: () => Promise<void>
  navigateTo: (view: AppView) => void
  setSettingsTab: (tab: SettingsTab) => void

  // Update
  handleUpdateEvent: (event: UpdateEvent) => void
  /** Pull the updater state pushed before this renderer had a listener. */
  syncUpdateState: () => Promise<void>
  downloadUpdate: () => void
  installUpdate: () => void
  /** Retry harness pre-fetch after harness-error (app binary already local). */
  retryUpdateHarness: () => void
  dismissUpdate: () => void

  // Remote control
  remoteConfig: RemoteDeviceConfig | null
  loadRemoteConfig: () => Promise<void>
  setRemoteConfig: (config: RemoteDeviceConfig) => void

  // Brand hue (per-harness, light mode only)
  brandHues: Record<HarnessId, number | null>
  loadBrandHues: () => Promise<void>
  setBrandHue: (harness: HarnessId, hue: number | null) => Promise<void>

  experimentalAgentsEnabled: boolean
  setExperimentalAgentsEnabled: (enabled: boolean) => Promise<void>
  /** Non-Grok ACP agent ids enabled from Settings → Harnesses. */
  enabledExperimentalAgents: string[]
  setEnabledExperimentalAgents: (ids: string[]) => Promise<void>
  /**
   * Installation catalog from `listHarnesses`. `null` until the first successful
   * fetch — consumers must treat unknown as "not disabled" so session composers
   * do not flash read-only on launch.
   */
  harnessCatalog: HarnessCatalogStatus[] | null
  refreshHarnessCatalog: () => Promise<void>
  /**
   * When set, Settings → Harnesses selects this list key (catalog id or
   * `acp:…`) on open, then clears. Used by "Re-enable" deep links from chat.
   */
  harnessListFocusKey: string | null
  /** Open Settings → Harnesses with a specific row selected. */
  openHarnessSettings: (listKey: string) => void
  experimentalClaudeOpenAiChatEnabled: boolean
  setExperimentalClaudeOpenAiChatEnabled: (enabled: boolean) => Promise<void>
  /** Remote execution environments (Other Devices + sidebar host switcher). */
  experimentalRemoteNodesEnabled: boolean
  setExperimentalRemoteNodesEnabled: (enabled: boolean) => Promise<void>

  // Terminal display settings
  terminalLightPalette: string | null
  terminalDarkPalette: string | null
  terminalFontSize: number
  terminalFontFamily: string | null
  // Mermaid diagram themes (per light/dark app chrome)
  mermaidLightTheme: string | null
  mermaidDarkTheme: string | null
  uiFontFamily: string | null
  liquidGlass: boolean
  autoExpandFileDiffs: boolean
  detailChatMode: boolean
  setTerminalPalette: (scheme: 'light' | 'dark', id: string | null) => Promise<void>
  setMermaidTheme: (scheme: 'light' | 'dark', id: string | null) => Promise<void>
  setTerminalFontSize: (size: number) => Promise<void>
  setTerminalFontFamily: (family: string | null) => Promise<void>
  setUiFontFamily: (family: string | null) => Promise<void>
  setLiquidGlass: (enabled: boolean) => Promise<void>
  setAutoExpandFileDiffs: (enabled: boolean) => Promise<void>
  setDetailChatMode: (enabled: boolean) => Promise<void>

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

/** Cached across onboarding → align so we do not re-fetch startup data. */
let pendingStartup: {
  startupData: StartupData
  folders: RecentFolder[]
} | null = null

async function runContinueToMain(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
): Promise<void> {
  const [startupData, folders, settings] = await Promise.all([
    window.app.getStartupData(),
    window.app.getRecentFolders(),
    window.app.getAppSettings(),
  ])
  set({
    recentFolders: folders,
    sandboxCapability: startupData.sandboxCapability ?? null,
    appVersion: startupData.appVersion,
    appVariant: startupData.variant,
  })
  console.info(
    '[continueToMain] cached: claude=%s codex=%s opencode=%s cursor=%s sandbox=%s',
    startupData.cached.claude ? `${startupData.cached.claude.models?.length ?? 0} models` : 'null',
    startupData.cached.codex ? `${startupData.cached.codex.models?.length ?? 0} models` : 'null',
    startupData.cached.opencode ? `${startupData.cached.opencode.models?.length ?? 0} models` : 'null',
    startupData.cached.cursor ? `${startupData.cached.cursor.models?.length ?? 0} models` : 'null',
    startupData.sandboxCapability?.supportLevel ?? 'unknown',
  )

  // Stash startup payload for post-align entry (avoid double getStartupData).
  pendingStartup = {
    startupData,
    folders,
  }

  const { CURRENT_ONBOARDING_EPOCH } = await import('@superone/shared/onboarding')
  const epoch = settings.onboardingEpoch ?? 0
  const forceOnboarding =
    import.meta.env.DEV && import.meta.env.RENDERER_VITE_FORCE_ONBOARDING === '1'
  if (forceOnboarding || epoch < CURRENT_ONBOARDING_EPOCH) {
    set({ view: 'onboarding', onboardingStep: 'welcome' })
    return
  }

  // Fallback only: pin-align when an enabled harness is not at the process pin.
  // Happy path pre-fetches during app update so this is usually a no-op skip.
  const needsAlign = await window.app.needsHarnessAlign().catch(() => true)
  if (needsAlign) {
    set({ view: 'harness-align' })
    return
  }
  await enterMainAfterGates(get, set)
}

async function enterMainAfterGates(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
): Promise<void> {
  const pending = pendingStartup
  const startupData =
    pending?.startupData ??
    (await window.app.getStartupData())
  const folders = pending?.folders ?? (await window.app.getRecentFolders())
  pendingStartup = null

  set({
    recentFolders: folders,
    sandboxCapability: startupData.sandboxCapability ?? get().sandboxCapability,
    appVersion: startupData.appVersion ?? get().appVersion,
    appVariant: startupData.variant ?? get().appVariant,
  })

  if (startupData.sandboxCapability) {
    const { invalidateDefaultPermissionModeCache } = await import('./chat')
    await invalidateDefaultPermissionModeCache()
  }
  const { useChatStore } = await import('./chat')

  if (startupData.cached?.claude) {
    useChatStore.getState().setHarnessResources('claude', startupData.cached.claude)
  }
  if (startupData.cached?.codex) {
    useChatStore.getState().setHarnessResources('codex', startupData.cached.codex)
  }
  if (startupData.cached?.opencode) {
    useChatStore.getState().setHarnessResources('opencode', startupData.cached.opencode)
  }
  if (startupData.cached?.cursor) {
    useChatStore.getState().setHarnessResources('cursor', startupData.cached.cursor)
  }

  // Catalog drives session read-only when a harness is disabled. Fire-and-forget:
  // null stays "unknown" (composer stays open) until the first successful fetch.
  void get().refreshHarnessCatalog()

  if (!get().currentFolder) {
    let opened = false
    for (const folder of folders) {
      if (folder.missing) continue
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

  await prewarmActiveSessionHarness()
}

/**
 * Prewarm the harness the restored session actually uses — and only that one.
 *
 * This used to be an unconditional `initializeHarness('claude')` from back when
 * Claude was the only harness. Under on-demand harness installs that probes a
 * runtime which users who never enabled Claude do not have on disk, so every
 * launch paid for a doomed round-trip.
 *
 * Runs after project selection because the session (and therefore its provider)
 * does not exist before it.
 */
async function prewarmActiveSessionHarness(): Promise<void> {
  const { useChatStore } = await import('./chat')
  const chat = useChatStore.getState()
  const projectPath = chat.activeProject
  if (!projectPath) return
  // Remote projects run their harnesses on the node — nothing local to warm.
  if (parseRemoteProjectKey(projectPath)) return

  const project = chat.projectSessions[projectPath]
  const sessionId = project?._activeSessionId
  const session = sessionId ? project._sessions[sessionId] : undefined
  if (!session) return

  void chat.initializeHarness(resolveProvider(session))
}

async function applyProjectSelection(
  folderPath: string,
  set: (partial: Partial<AppState>) => void,
  options?: { connectionId?: string; projectId?: string; carryOpenDraft?: boolean },
): Promise<boolean> {
  const connectionId =
    options?.connectionId ?? useAppStore.getState().selectedHostConnectionId ?? 'local'

  if (connectionId !== 'local') {
    // Remote host: do not call local openFolder (path is not on this machine).
    // Ensure the project is registered on the node, then bind chat to a host-scoped key.
    try {
      const parsed = parseRemoteProjectKey(folderPath)
      const hostPath = parsed?.path ?? folderPath
      const project = await window.environment.openProject(connectionId, hostPath)
      const { useChatStore } = await import('./chat')
      const { useSettingsStore } = await import('./settings')
      // Chat suggestions + model selector read settings.credentials for "powered by".
      useSettingsStore.getState().setProviderScope(connectionId)
      const projectKey = remoteProjectKey(connectionId, project.path || hostPath)
      const projectId = options?.projectId ?? project.projectId
      // Match local: ensureSession seeds a draft "New session" row. Do not
      // auto-switch to the latest node history entry — sidebar history /
      // explicit New session owns that. First send materializes a real node
      // session via resolveNodeSessionId.
      // focusProject (not bare activeProject set) so an open unsent draft is
      // carried across projects instead of left behind as a blank session.
      useChatStore.getState().ensureSession(projectKey)
      // Hydrate before any session can mount: a send composed without these
      // would read as a *removal* against the previous set and cost a running
      // Claude backend a needless rebuild.
      void useChatStore.getState().refreshProjectExtraDirs(projectKey)
      await useChatStore.getState().focusProject(projectKey, {
        carryOpenDraft: options?.carryOpenDraft === true,
      })
      set({
        currentFolder: projectKey,
        currentProjectId: projectId,
        selectedHostConnectionId: connectionId,
        view: useAppStore.getState().view === 'startup' ? 'main' : useAppStore.getState().view,
      })
      return true
    } catch (error) {
      console.error('[app] failed to select remote project', {
        connectionId,
        folderPath,
        error,
      })
      return false
    }
  }

  const ok = await window.app.openFolder(folderPath)
  if (!ok) return false
  useAppStore.getState().fetchRecentFolders()
  const { useChatStore } = await import('./chat')
  const { useSettingsStore } = await import('./settings')
  useSettingsStore.getState().setProviderScope('local')
  useChatStore.getState().ensureSession(folderPath)
  void useChatStore.getState().refreshProjectExtraDirs(folderPath)
  // currentFolder / currentProjectId mirror chat.activeProject — see subscription at file end.
  await useChatStore.getState().focusProject(folderPath, {
    carryOpenDraft: options?.carryOpenDraft === true,
  })
  if (useAppStore.getState().view === 'startup') set({ view: 'main' })
  return true
}

/** Bumped on every host switch so stale auto-open work is dropped. */
let hostSwitchGeneration = 0

/**
 * Open the host's default project (most recently active). Used after switching
 * hosts so chat suggestions immediately show that project instead of an empty state.
 */
async function openDefaultProjectForHost(
  connectionId: string,
  set: (partial: Partial<AppState>) => void,
  generation: number,
): Promise<void> {
  if (generation !== hostSwitchGeneration) return
  if (useAppStore.getState().selectedHostConnectionId !== connectionId) return
  // User (or another path) already picked something on this host.
  if (projectBelongsToHost(useAppStore.getState().currentFolder, connectionId)
    && useAppStore.getState().currentFolder) {
    return
  }

  if (connectionId === 'local') {
    const folders = useAppStore.getState().recentFolders.filter((f) => !f.missing)
    const first = folders[0]
    if (!first) return
    if (generation !== hostSwitchGeneration) return
    await applyProjectSelection(first.path, set, { connectionId: 'local', projectId: first.id })
    return
  }

  try {
    const items = await window.environment.listItems()
    if (generation !== hostSwitchGeneration) return
    const host = items.find((h) => h.connectionId === connectionId)
    const live = host?.state === 'connected' || host?.state === 'synchronizing'
    if (!live) {
      await window.environment.connect(connectionId)
    }
    if (generation !== hostSwitchGeneration) return
    const projects = await window.environment.listProjects(connectionId)
    if (generation !== hostSwitchGeneration) return
    // Node orders by last_active_at DESC; stale registry entries are not selectable.
    const first = projects.find((project) => !project.missing)
    if (!first) return
    await applyProjectSelection(remoteProjectKey(connectionId, first.path), set, {
      connectionId,
      projectId: first.projectId,
    })
  } catch {
    // Leave empty state; sidebar / Add Project still work.
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
  currentProjectId: null,
  tmpFolder: null,
  recentFolders: [],
  selectedHostConnectionId: 'local',
  isSwitchingHostProject: false,
  setSelectedHostConnectionId: (connectionId) => {
    // Remote hosts require the experimental remote-nodes flag.
    const next =
      connectionId && connectionId !== 'local' && !get().experimentalRemoteNodesEnabled
        ? 'local'
        : connectionId || 'local'
    const prev = get().selectedHostConnectionId
    if (prev === next && (get().currentFolder || get().isSwitchingHostProject)) return

    // Provider Settings + chat model selector follow the selected host store.
    const providerScope = next === 'local' ? 'local' : next
    void import('./settings').then(({ useSettingsStore }) => {
      useSettingsStore.getState().setProviderScope(providerScope)
    })

    // Host filter changed: drop a project that lives on another host so chat
    // suggestions / ProjectSelector don't keep showing the previous default.
    const folder = get().currentFolder
    if (folder && projectBelongsToHost(folder, next)) {
      set({ selectedHostConnectionId: next, isSwitchingHostProject: false })
      return
    }

    const generation = ++hostSwitchGeneration
    // Keep the transition explicit until the target host's default project has
    // opened or the host has been confirmed empty.
    set({
      selectedHostConnectionId: next,
      isSwitchingHostProject: true,
      currentFolder: null,
      currentProjectId: null,
    })
    void (async () => {
      try {
        const { useChatStore } = await import('./chat')
        if (generation !== hostSwitchGeneration) return
        if (!projectBelongsToHost(useChatStore.getState().activeProject, next)) {
          useChatStore.setState(() => ({ activeProject: null }))
        }
        await openDefaultProjectForHost(next, set, generation)
      } finally {
        if (
          generation === hostSwitchGeneration
          && useAppStore.getState().selectedHostConnectionId === next
        ) {
          set({ isSwitchingHostProject: false })
        }
      }
    })()
  },
  _worktrees: {},
  updateStatus: 'idle',
  updateVersion: null,
  updateProgress: 0,
  updatePhase: null,
  updateHarnessId: null,
  updateErrorMessage: null,
  installStatus: 'idle',
  installOutput: '',
  onboardingStep: 'welcome',
  goToOnboardingStep: (step) => set({ onboardingStep: step }),
  completeOnboarding: async () => {
    const { CURRENT_ONBOARDING_EPOCH } = await import('@superone/shared/onboarding')
    await window.app.saveAppSettings({
      onboardingCompletedAt: Date.now(),
      onboardingEpoch: CURRENT_ONBOARDING_EPOCH,
    })
    set({ onboardingStep: 'welcome' })
    // First enable may already have installed pins; only block when still misaligned.
    const needsAlign = await window.app.needsHarnessAlign().catch(() => true)
    if (needsAlign) {
      set({ view: 'harness-align' })
      return
    }
    await enterMainAfterGates(get, set)
  },
  finishHarnessAlign: async () => {
    await enterMainAfterGates(get, set)
  },
  appVersion: '',
  appVariant: 'stable',
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
  settingsProviderTabs: {
    claude: FIRST_PROVIDER_TAB,
    codex: FIRST_PROVIDER_TAB,
    cursor: FIRST_PROVIDER_TAB,
    dsh: 'mcp',
  },
  harnessConfigSection: null,
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

  selectProject: async (folderPath?: string, options?: { connectionId?: string; projectId?: string }) => {
    const connectionId = options?.connectionId ?? get().selectedHostConnectionId ?? 'local'
    // System folder picker is local-only.
    if (!folderPath && connectionId !== 'local') return
    const path = folderPath ?? (await window.app.selectFolder())
    if (!path) return
    await applyProjectSelection(path, set, { ...options, connectionId })
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
        set({
          updateStatus: 'checking',
          updatePhase: null,
          updateHarnessId: null,
          updateErrorMessage: null,
        })
        break
      case 'available':
        // Stay here until the user explicitly clicks Download/Update.
        set({
          updateStatus: 'available',
          updateVersion: event.version,
          updateProgress: 0,
          updatePhase: null,
          updateHarnessId: null,
          updateErrorMessage: null,
        })
        break
      case 'not-available':
        set({ updateStatus: 'up-to-date', updatePhase: null, updateHarnessId: null })
        setTimeout(() => {
          if (get().updateStatus === 'up-to-date') set({ updateStatus: 'idle' })
        }, 3000)
        break
      case 'download-progress': {
        const phase = event.phase ?? 'app'
        set({
          updateStatus: phase === 'harness' ? 'downloading-harness' : 'downloading',
          updateProgress: event.percent,
          updatePhase: phase,
          updateHarnessId: event.harnessId ?? null,
          updateErrorMessage: null,
        })
        break
      }
      case 'downloaded':
        set({
          updateStatus: 'ready',
          updateVersion: event.version,
          updateProgress: 100,
          updatePhase: null,
          updateHarnessId: null,
          updateErrorMessage: null,
        })
        break
      case 'harness-error':
        set({
          updateStatus: 'harness-error',
          updateVersion: event.version,
          updatePhase: 'harness',
          updateErrorMessage: event.message,
        })
        break
      case 'error':
        set({
          updateStatus: 'error',
          updateErrorMessage: event.message,
          updatePhase: null,
        })
        break
    }
  },

  syncUpdateState: async () => {
    // The startup check normally resolves before the renderer has mounted its
    // listener, and that push is dropped for good (checks are startup-only).
    // Replay the last event so the sidebar pill still appears.
    const snapshot = await window.app.getUpdateState()
    if (!snapshot) return
    // A live event that landed while the invoke was in flight is newer — and any
    // non-idle status already reflects one, so never clobber it with the replay.
    if (get().updateStatus !== 'idle') return
    get().handleUpdateEvent(snapshot)
  },

  downloadUpdate: () => {
    // Optimistic feedback before the first download-progress event arrives.
    if (get().updateStatus === 'available') {
      set({
        updateStatus: 'preparing',
        updateProgress: 0,
        updatePhase: 'app',
        updateErrorMessage: null,
      })
    }
    void window.app.downloadUpdate()
  },

  installUpdate: () => {
    window.app.installUpdate()
  },

  retryUpdateHarness: () => {
    if (get().updateStatus !== 'harness-error') return
    set({
      updateStatus: 'downloading-harness',
      updateProgress: 0,
      updatePhase: 'harness',
      updateErrorMessage: null,
    })
    void window.app.retryUpdateHarness()
  },

  dismissUpdate: () => {
    set({
      updateStatus: 'idle',
      updatePhase: null,
      updateHarnessId: null,
      updateErrorMessage: null,
    })
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
    const boot = runContinueToMain(get, set)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = await Promise.race([
      boot.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), 15_000)
      }),
    ])
    if (timer) clearTimeout(timer)
    if (timedOut) {
      void boot.catch((err) => console.error('[continueToMain] failed after timeout', err))
      if (get().view === 'loading') {
        console.error('[continueToMain] timed out still on loading view')
        set({ view: 'startup' })
      }
    }
  },

  navigateTo: (view) => {
    set({ view })
  },

  setSettingsProvider: (provider) => {
    // Provider only selects which harness's config pages to show.
    // Does not switch the active settings tab — config lives under Harnesses.
    set({ settingsProvider: provider })
  },
  setHarnessConfigSection: (section) => set({ harnessConfigSection: section }),
  setSettingsTab: (tab) => {
    // Former standalone Environments tab lives under Remote Control → Other devices.
    if ((tab as string) === 'environments') {
      set({ settingsTab: 'remote', harnessConfigSection: null })
      return
    }
    // Legacy deep links (MCP popup, sandbox settings) open the nested page
    // inside Harnesses instead of the removed sidebar provider tabs.
    if (isHarnessConfigSection(tab)) {
      set({ settingsTab: 'harnesses', harnessConfigSection: tab })
      return
    }
    // Switching any top-level settings section clears nested harness config.
    set({ settingsTab: tab, harnessConfigSection: null })
  },

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
    // Remote: store activePath as remote:<conn>:<hostWt> so git status IPC stays remote.
    let uiWtPath = wtPath
    const remoteProj = parseRemoteProjectKey(projectPath)
    if (remoteProj && !parseRemoteProjectKey(wtPath)) {
      const { remoteProjectKey } = await import('@/lib/remote-project-key')
      uiWtPath = remoteProjectKey(remoteProj.connectionId, wtPath)
    }
    useChatStore.getState().resetSessionForWorktreeSwitch(projectPath, {
      wtPath: uiWtPath,
      gitBranch,
    })
    set((s) => ({
      _worktrees: {
        ...s._worktrees,
        [projectPath]: {
          pendingBaseBranch: null,
          pendingMode: 'branch',
          pendingBranchName: '',
          pendingCarryLocalChanges: false,
          activePath: uiWtPath,
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

  brandHues: { claude: null, codex: null, acp: null, opencode: null, cursor: null, dsh: null },
  tokenOverrides: { claude: {}, codex: {}, acp: {}, opencode: {}, cursor: {}, dsh: {} },
  harnessCatalog: null,
  refreshHarnessCatalog: async () => {
    try {
      const list = await window.app.listHarnesses?.()
      if (!Array.isArray(list)) {
        set({ harnessCatalog: null })
        return
      }
      set({
        harnessCatalog: list.map((row) => ({
          id: row.id,
          enabled: Boolean(row.enabled),
          state: String(row.state ?? ''),
        })),
      })
    } catch {
      // Keep previous snapshot on transient IPC failure — better a stale catalog
      // than flashing every open session into read-only.
    }
  },
  harnessListFocusKey: null,
  openHarnessSettings: (listKey) => {
    const patch: Partial<AppState> = {
      harnessListFocusKey: listKey,
      settingsTab: 'harnesses',
      harnessConfigSection: null,
      view: 'settings',
    }
    // Nested config panes key off settingsProvider — keep them aligned.
    if (listKey === 'claude' || listKey === 'codex' || listKey === 'cursor' || listKey === 'dsh') {
      patch.settingsProvider = listKey
    }
    set(patch)
  },
  experimentalAgentsEnabled: false,
  enabledExperimentalAgents: [],
  experimentalClaudeOpenAiChatEnabled: false,
  experimentalRemoteNodesEnabled: false,
  terminalLightPalette: null,
  terminalDarkPalette: null,
  terminalFontSize: 14,
  terminalFontFamily: null,
  mermaidLightTheme: null,
  mermaidDarkTheme: null,
  uiFontFamily: null,
  liquidGlass: false,
  autoExpandFileDiffs: false,
  detailChatMode: false,

  loadBrandHues: async () => {
    try {
      const settings = await window.app.getAppSettings()
      set({
        brandHues: {
          claude: settings.agentPreference.claude.brandHue,
          codex: settings.agentPreference.codex.brandHue,
          acp: settings.agentPreference.acp?.brandHue ?? null,
          cursor: settings.agentPreference.cursor?.brandHue ?? null,
          dsh: settings.agentPreference.dsh?.brandHue ?? null,
          opencode: settings.agentPreference.opencode?.brandHue ?? null,
        },
        tokenOverrides: {
          claude: settings.agentPreference.claude.tokenOverrides ?? {},
          codex: settings.agentPreference.codex.tokenOverrides ?? {},
          acp: settings.agentPreference.acp?.tokenOverrides ?? {},
          cursor: settings.agentPreference.cursor?.tokenOverrides ?? {},
          dsh: settings.agentPreference.dsh?.tokenOverrides ?? {},
          opencode: settings.agentPreference.opencode?.tokenOverrides ?? {},
        },
        experimentalAgentsEnabled: settings.experimentalAgentsEnabled,
        enabledExperimentalAgents: settings.enabledExperimentalAgents ?? [],
        experimentalClaudeOpenAiChatEnabled: settings.experimentalClaudeOpenAiChatEnabled ?? false,
        experimentalRemoteNodesEnabled: settings.experimentalRemoteNodesEnabled ?? false,
        terminalLightPalette: settings.terminalLightPalette,
        terminalDarkPalette: settings.terminalDarkPalette,
        terminalFontSize: settings.terminalFontSize,
        terminalFontFamily: settings.terminalFontFamily,
        mermaidLightTheme: settings.mermaidLightTheme,
        mermaidDarkTheme: settings.mermaidDarkTheme,
        uiFontFamily: settings.uiFontFamily,
        liquidGlass: settings.liquidGlass,
        autoExpandFileDiffs: settings.autoExpandFileDiffs,
        detailChatMode: settings.detailChatMode,
      })
    } catch (err) {
      console.error('[brand-hue] loadBrandHues failed:', err)
    }
  },

  setExperimentalAgentsEnabled: async (enabled) => {
    set({ experimentalAgentsEnabled: enabled })
    try {
      const result = await window.app.saveAppSettings({ experimentalAgentsEnabled: enabled })
      set({ experimentalAgentsEnabled: result.experimentalAgentsEnabled })
    } catch (err) {
      console.error('[experimental-agents] persist enabled failed:', err)
      throw err
    }
  },

  setEnabledExperimentalAgents: async (ids) => {
    set({ enabledExperimentalAgents: ids })
    try {
      const result = await window.app.saveAppSettings({
        enabledExperimentalAgents: ids,
        experimentalAgentsEnabled: false,
      })
      set({
        enabledExperimentalAgents: result.enabledExperimentalAgents ?? ids,
        experimentalAgentsEnabled: result.experimentalAgentsEnabled,
      })
    } catch (err) {
      console.error('[experimental-agents] persist per-agent list failed:', err)
      throw err
    }
  },

  setExperimentalClaudeOpenAiChatEnabled: async (enabled) => {
    set({ experimentalClaudeOpenAiChatEnabled: enabled })
    try {
      const result = await window.app.saveAppSettings({ experimentalClaudeOpenAiChatEnabled: enabled })
      set({ experimentalClaudeOpenAiChatEnabled: result.experimentalClaudeOpenAiChatEnabled })
    } catch (err) {
      console.error('[claude-openai-chat] persist enabled failed:', err)
      throw err
    }
  },

  setExperimentalRemoteNodesEnabled: async (enabled) => {
    set({ experimentalRemoteNodesEnabled: enabled })
    // Turning the experiment off must not leave the UI on a remote host.
    if (!enabled && useAppStore.getState().selectedHostConnectionId !== 'local') {
      useAppStore.getState().setSelectedHostConnectionId('local')
    }
    try {
      const result = await window.app.saveAppSettings({ experimentalRemoteNodesEnabled: enabled })
      set({ experimentalRemoteNodesEnabled: result.experimentalRemoteNodesEnabled })
    } catch (err) {
      console.error('[remote-nodes] persist enabled failed:', err)
      throw err
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

  setAutoExpandFileDiffs: async (enabled) => {
    set({ autoExpandFileDiffs: enabled })
    void window.app
      .saveAppSettings({ autoExpandFileDiffs: enabled })
      .catch((err) => console.error('[auto-expand-file-diffs] persist failed:', err))
  },

  setDetailChatMode: async (enabled) => {
    set({ detailChatMode: enabled })
    void window.app
      .saveAppSettings({ detailChatMode: enabled })
      .catch((err) => console.error('[detail-chat-mode] persist failed:', err))
  },

  setTerminalPalette: async (scheme, id) => {
    set(scheme === 'dark' ? { terminalDarkPalette: id } : { terminalLightPalette: id })
    const patch = scheme === 'dark' ? { terminalDarkPalette: id } : { terminalLightPalette: id }
    void window.app
      .saveAppSettings(patch)
      .catch((err) => console.error('[terminal-palette] persist failed:', err))
  },

  setMermaidTheme: async (scheme, id) => {
    set(scheme === 'dark' ? { mermaidDarkTheme: id } : { mermaidLightTheme: id })
    const patch = scheme === 'dark' ? { mermaidDarkTheme: id } : { mermaidLightTheme: id }
    void window.app
      .saveAppSettings(patch)
      .catch((err) => console.error('[mermaid-theme] persist failed:', err))
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
const persistTimers: Partial<Record<HarnessId, ReturnType<typeof setTimeout>>> = {}

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
    const acp = settings.agentPreference.acp
    useAppStore.setState({
      brandHues: {
        claude: claude.brandHue,
        codex: codex.brandHue,
        acp: acp?.brandHue ?? null,
        cursor: settings.agentPreference.cursor?.brandHue ?? null,
        dsh: settings.agentPreference.dsh?.brandHue ?? null,
        opencode: settings.agentPreference.opencode?.brandHue ?? null,
      },
      tokenOverrides: {
        claude: claude.tokenOverrides ?? {},
        codex: codex.tokenOverrides ?? {},
        acp: acp?.tokenOverrides ?? {},
        cursor: settings.agentPreference.cursor?.tokenOverrides ?? {},
        dsh: settings.agentPreference.dsh?.tokenOverrides ?? {},
        opencode: settings.agentPreference.opencode?.tokenOverrides ?? {},
      },
      experimentalAgentsEnabled: settings.experimentalAgentsEnabled,
      enabledExperimentalAgents: settings.enabledExperimentalAgents ?? [],
      experimentalClaudeOpenAiChatEnabled: settings.experimentalClaudeOpenAiChatEnabled ?? false,
      experimentalRemoteNodesEnabled: settings.experimentalRemoteNodesEnabled ?? false,
      terminalLightPalette: settings.terminalLightPalette,
      terminalDarkPalette: settings.terminalDarkPalette,
      terminalFontSize: settings.terminalFontSize,
      terminalFontFamily: settings.terminalFontFamily,
      mermaidLightTheme: settings.mermaidLightTheme,
      mermaidDarkTheme: settings.mermaidDarkTheme,
      uiFontFamily: settings.uiFontFamily,
      liquidGlass: settings.liquidGlass,
      autoExpandFileDiffs: settings.autoExpandFileDiffs,
      detailChatMode: settings.detailChatMode,
    })
    if (
      settings.experimentalRemoteNodesEnabled === false
      && useAppStore.getState().selectedHostConnectionId !== 'local'
    ) {
      useAppStore.getState().setSelectedHostConnectionId('local')
    }
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
    // Remote projects carry their own node projectId (set by applyProjectSelection).
    // Local getProjectId only knows desktop recents — don't clobber remote ids.
    if (parseRemoteProjectKey(projectPath)) {
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
