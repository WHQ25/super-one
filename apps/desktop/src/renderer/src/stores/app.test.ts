import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HarnessId } from '@superone/shared/agent-types'

const mockSourceControlReset = vi.fn()
vi.mock('./source-control', () => ({
  useSourceControlStore: {
    getState: () => ({ reset: mockSourceControlReset }),
  },
}))

const mockSetShowPanel = vi.fn()
vi.mock('./activity-panel', () => ({
  useActivityPanelStore: {
    getState: () => ({ setShowPanel: mockSetShowPanel }),
  },
}))

vi.mock('@/components/activity/activity-panel-api', () => ({
  openFileTab: vi.fn(),
  setDockApi: vi.fn(),
  setOnDockReady: vi.fn(),
  applyDockSnapshot: vi.fn(),
  getDockSnapshot: vi.fn(),
  isDockReady: () => false,
  closeGhostMiniAppPanels: vi.fn(),
  openMiniAppTab: vi.fn(),
  closeMiniAppTab: vi.fn(),
}))

vi.mock('./activity-view-state', () => ({
  useActivityViewStateStore: {
    getState: () => ({
      perSession: {},
      park: vi.fn(),
      restore: vi.fn(),
      seedFromCurrent: vi.fn(),
      clearForSession: vi.fn(),
      flushPending: vi.fn(),
    }),
  },
  isInstanceReferencedInSavedSessions: () => false,
}))

const {
  mockInitializeHarness,
  mockSetHarnessResources,
  mockEnsureSession,
  mockSwitchSession,
} = vi.hoisted(() => ({
  mockInitializeHarness: vi.fn().mockResolvedValue(undefined),
  mockSetHarnessResources: vi.fn(),
  mockEnsureSession: vi.fn(),
  mockSwitchSession: vi.fn(async (_sessionId: string) => {}),
}))

vi.mock('./chat', () => {
  const state = { projectSessions: {} as Record<string, unknown>, activeProject: null as string | null }
  const listeners = new Set<(s: typeof state) => void>()
  const notify = (): void => { for (const listener of [...listeners]) listener(state) }
  const resetSessionForWorktreeSwitch = vi.fn()
  return {
    useChatStore: Object.assign(
      () => state,
      {
        getState: () => ({
          setHarnessResources: mockSetHarnessResources,
          initializeHarness: mockInitializeHarness,
          ensureSession: mockEnsureSession,
          switchSession: mockSwitchSession,
          focusProject: vi.fn(async (projectPath: string) => {
            state.activeProject = projectPath
            notify()
          }),
          resetSessionForWorktreeSwitch,
          activeProject: state.activeProject,
          projectSessions: state.projectSessions,
        }),
        setState: (partial: Partial<typeof state> | ((s: typeof state) => Partial<typeof state>)) => {
          const next = typeof partial === 'function' ? partial(state) : partial
          Object.assign(state, next)
          notify()
        },
        subscribe: (listener: (s: typeof state) => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    ),
  }
})

const mockWindowApp = {
  closeProject: vi.fn().mockResolvedValue(undefined),
  removeRecentFolder: vi.fn(),
  openFolder: vi.fn().mockResolvedValue(true),
  activateWorktree: vi.fn().mockResolvedValue({ ok: true, path: '/proj' }),
  selectFolder: vi.fn(),
  getRecentFolders: vi.fn().mockResolvedValue([]),
  getProjectId: vi.fn().mockResolvedValue(null),
  getStartupData: vi.fn().mockResolvedValue({ cached: { claude: null, codex: null, acp: null, opencode: null, cursor: null } }),
  getAppSettings: vi.fn().mockResolvedValue({ onboardingCompletedAt: 1, onboardingEpoch: 1 }),
  saveAppSettings: vi.fn().mockResolvedValue({ onboardingCompletedAt: Date.now(), onboardingEpoch: 1 }),
  alignEnabledHarnesses: vi.fn().mockResolvedValue({ aligned: [], failed: [] }),
  needsHarnessAlign: vi.fn().mockResolvedValue(true),
  connectClaude: vi.fn().mockResolvedValue({ models: [], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] }),
  connectCodex: vi.fn().mockResolvedValue({ models: [] }),
}

const mockEnvironment = {
  listItems: vi.fn().mockResolvedValue([]),
  listProjects: vi.fn().mockResolvedValue([]),
  connect: vi.fn().mockResolvedValue(undefined),
  openProject: vi.fn(),
  listSessions: vi.fn().mockResolvedValue([]),
  createSession: vi.fn().mockResolvedValue({
    sessionId: 'node-session-1',
    title: 'New session',
    lastActiveAt: new Date().toISOString(),
    messageCount: 0,
  }),
  getSession: vi.fn().mockResolvedValue(null),
}

const storage: Record<string, string> = {}
vi.stubGlobal('window', {
  app: mockWindowApp,
  environment: mockEnvironment,
  localStorage: {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value },
    removeItem: (key: string) => { delete storage[key] },
  },
})

const { useAppStore, startProjectMirror } = await import('./app')
const { useChatStore } = await import('./chat')
startProjectMirror(useChatStore)

/** Seed the project + active session that startup prewarm reads its harness from. */
function seedActiveSession(projectPath: string, provider: HarnessId) {
  useChatStore.setState(() => ({
    activeProject: projectPath,
    projectSessions: {
      [projectPath]: {
        _activeSessionId: 'sess-1',
        _sessions: { 'sess-1': { sessionProvider: null, preferredProvider: provider } },
      },
    } as never,
  }))
}

function resetStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    view: 'loading',
    currentFolder: null,
    recentFolders: [],
    isSwitchingHostProject: false,
    _worktrees: {},
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
  // Default off so host-switch tests must opt in explicitly (see describe below).
  useAppStore.setState({ experimentalRemoteNodesEnabled: false })
  useChatStore.setState(() => ({ activeProject: null, projectSessions: {} }))
})

describe('removeRecentFolder', () => {
  it('should switch to next project when deleting the active project', async () => {
    const remaining = [{ name: 'other', path: '/other' }]
    mockWindowApp.removeRecentFolder.mockResolvedValue(remaining)
    mockWindowApp.openFolder.mockResolvedValue(true)
    mockWindowApp.getRecentFolders.mockResolvedValue(remaining)

    resetStore({
      view: 'main',
      recentFolders: [{ name: 'active', path: '/active' }, ...remaining],
    })
    await useChatStore.getState().focusProject('/active')

    await useAppStore.getState().removeRecentFolder('/active')

    expect(useAppStore.getState().currentFolder).toBe('/other')
    expect(useAppStore.getState().view).toBe('main')
  })

  it('should navigate to startup when deleting the last project', async () => {
    mockWindowApp.removeRecentFolder.mockResolvedValue([])

    resetStore({
      view: 'main',
      recentFolders: [{ name: 'only', path: '/only' }],
    })
    await useChatStore.getState().focusProject('/only')

    await useAppStore.getState().removeRecentFolder('/only')

    expect(useAppStore.getState().currentFolder).toBeNull()
    expect(useAppStore.getState().view).toBe('startup')
  })

  it('should not change view when deleting a non-active project', async () => {
    const remaining = [{ name: 'active', path: '/active' }]
    mockWindowApp.removeRecentFolder.mockResolvedValue(remaining)

    resetStore({
      view: 'main',
      recentFolders: [{ name: 'active', path: '/active' }, { name: 'other', path: '/other' }],
    })
    await useChatStore.getState().focusProject('/active')

    await useAppStore.getState().removeRecentFolder('/other')

    expect(useAppStore.getState().currentFolder).toBe('/active')
    expect(useAppStore.getState().view).toBe('main')
  })

  it('skips a stale folder and selects the next openable one when deleting the active project', async () => {
    const remaining = [{ name: 'stale', path: '/stale' }, { name: 'good', path: '/good' }]
    mockWindowApp.removeRecentFolder.mockResolvedValue(remaining)
    mockWindowApp.getRecentFolders.mockResolvedValue(remaining)
    mockWindowApp.openFolder.mockImplementation(async (p: string) => p !== '/stale')

    resetStore({
      view: 'main',
      recentFolders: [{ name: 'active', path: '/active' }, ...remaining],
    })
    await useChatStore.getState().focusProject('/active')

    await useAppStore.getState().removeRecentFolder('/active')

    expect(useAppStore.getState().currentFolder).toBe('/good')
    expect(useAppStore.getState().view).toBe('main')
  })

  it('drops to startup when every remaining folder fails to open', async () => {
    const remaining = [{ name: 'stale', path: '/stale' }]
    mockWindowApp.removeRecentFolder.mockResolvedValue(remaining)
    mockWindowApp.openFolder.mockResolvedValue(false)

    resetStore({
      view: 'main',
      recentFolders: [{ name: 'active', path: '/active' }, ...remaining],
    })
    await useChatStore.getState().focusProject('/active')

    await useAppStore.getState().removeRecentFolder('/active')

    expect(useAppStore.getState().currentFolder).toBeNull()
    expect(useAppStore.getState().view).toBe('startup')
  })
})

describe('continueToMain', () => {
  it('should force onboarding when onboardingEpoch is below current', async () => {
    mockWindowApp.getRecentFolders.mockResolvedValue([{ name: 'proj', path: '/proj' }])
    mockWindowApp.getAppSettings.mockResolvedValue({ onboardingCompletedAt: 1, onboardingEpoch: 0 })
    resetStore({ recentFolders: [] })

    await useAppStore.getState().continueToMain()

    expect(useAppStore.getState().view).toBe('onboarding')
  })

  it('should enter harness-align when pins need align (fallback)', async () => {
    mockWindowApp.getRecentFolders.mockResolvedValue([])
    mockWindowApp.getAppSettings.mockResolvedValue({ onboardingCompletedAt: 1, onboardingEpoch: 1 })
    mockWindowApp.needsHarnessAlign.mockResolvedValue(true)
    resetStore({ recentFolders: [] })

    await useAppStore.getState().continueToMain()

    expect(useAppStore.getState().view).toBe('harness-align')
  })

  it('should skip harness-align when pins already aligned', async () => {
    mockWindowApp.getRecentFolders.mockResolvedValue([])
    mockWindowApp.getAppSettings.mockResolvedValue({ onboardingCompletedAt: 1, onboardingEpoch: 1 })
    mockWindowApp.needsHarnessAlign.mockResolvedValue(false)
    mockWindowApp.getStartupData.mockResolvedValue({
      appVersion: '0.1.0',
      sandboxCapability: null,
      cached: { claude: null, codex: null, acp: null },
    })
    resetStore({ recentFolders: [] })

    await useAppStore.getState().continueToMain()
    await vi.dynamicImportSettled()

    expect(useAppStore.getState().view).toBe('startup')
  })

  it('should open main after finishHarnessAlign when projects exist', async () => {
    const folders = [{ name: 'proj', path: '/proj' }]
    mockWindowApp.openFolder.mockResolvedValue(true)
    mockWindowApp.getRecentFolders.mockResolvedValue(folders)
    mockWindowApp.getAppSettings.mockResolvedValue({ onboardingCompletedAt: 1, onboardingEpoch: 1 })
    mockWindowApp.needsHarnessAlign.mockResolvedValue(true)
    mockWindowApp.getStartupData.mockResolvedValue({
      appVersion: '0.1.0',
      sandboxCapability: null,
      cached: { claude: null, codex: null, acp: null },
    })
    resetStore({ recentFolders: folders })
    seedActiveSession('/proj', 'claude')

    await useAppStore.getState().continueToMain()
    expect(useAppStore.getState().view).toBe('harness-align')

    await useAppStore.getState().finishHarnessAlign()
    await vi.dynamicImportSettled()

    expect(useAppStore.getState().view).toBe('main')
    expect(useAppStore.getState().currentFolder).toBe('/proj')
    expect(mockInitializeHarness).toHaveBeenCalledWith('claude')
  })

  // Prewarm used to be a hardcoded initializeHarness('claude'). With on-demand
  // harness installs that probes a runtime a codex-only user never downloaded.
  it('prewarms the restored session harness instead of always claude', async () => {
    const folders = [{ name: 'proj', path: '/proj' }]
    mockWindowApp.openFolder.mockResolvedValue(true)
    mockWindowApp.getRecentFolders.mockResolvedValue(folders)
    mockWindowApp.getAppSettings.mockResolvedValue({ onboardingCompletedAt: 1, onboardingEpoch: 1 })
    mockWindowApp.needsHarnessAlign.mockResolvedValue(false)
    mockWindowApp.getStartupData.mockResolvedValue({
      appVersion: '0.1.0',
      sandboxCapability: null,
      cached: { claude: null, codex: null, acp: null },
    })
    resetStore({ recentFolders: folders })
    seedActiveSession('/proj', 'codex')

    await useAppStore.getState().continueToMain()
    await vi.dynamicImportSettled()

    expect(mockInitializeHarness).toHaveBeenCalledWith('codex')
    expect(mockInitializeHarness).not.toHaveBeenCalledWith('claude')
  })

  it('skips missing local projects and opens the first path that still exists', async () => {
    const folders = [
      { name: 'gone', path: '/gone', missing: true },
      { name: 'proj', path: '/proj' },
    ]
    mockWindowApp.openFolder.mockImplementation(async (path: string) => path === '/proj')
    mockWindowApp.getRecentFolders.mockResolvedValue(folders)
    mockWindowApp.getAppSettings.mockResolvedValue({ onboardingCompletedAt: 1, onboardingEpoch: 1 })
    mockWindowApp.needsHarnessAlign.mockResolvedValue(false)
    mockWindowApp.getStartupData.mockResolvedValue({
      appVersion: '0.1.0',
      sandboxCapability: null,
      cached: { claude: null, codex: null, acp: null },
    })
    resetStore({ recentFolders: folders, currentFolder: null })

    await useAppStore.getState().continueToMain()
    await vi.dynamicImportSettled()

    expect(mockWindowApp.openFolder).not.toHaveBeenCalledWith('/gone')
    expect(mockWindowApp.openFolder).toHaveBeenCalledWith('/proj')
    expect(useAppStore.getState().view).toBe('main')
    expect(useAppStore.getState().currentFolder).toBe('/proj')
  })

  it('prewarms nothing when no project opened', async () => {
    mockWindowApp.getRecentFolders.mockResolvedValue([])
    mockWindowApp.getAppSettings.mockResolvedValue({ onboardingCompletedAt: 1, onboardingEpoch: 1 })
    mockWindowApp.needsHarnessAlign.mockResolvedValue(false)
    mockWindowApp.getStartupData.mockResolvedValue({
      appVersion: '0.1.0',
      sandboxCapability: null,
      cached: { claude: null, codex: null, acp: null },
    })
    resetStore({ recentFolders: [] })

    await useAppStore.getState().continueToMain()
    await vi.dynamicImportSettled()

    expect(mockInitializeHarness).not.toHaveBeenCalled()
  })
})

describe('selectProject', () => {
  it('should navigate from startup to main when opening a project', async () => {
    mockWindowApp.selectFolder.mockResolvedValue('/new')
    mockWindowApp.openFolder.mockResolvedValue(true)
    mockWindowApp.getRecentFolders.mockResolvedValue([{ name: 'new', path: '/new' }])

    resetStore({ view: 'startup' })

    await useAppStore.getState().selectProject()

    expect(useAppStore.getState().view).toBe('main')
    expect(useAppStore.getState().currentFolder).toBe('/new')
  })

  it('opens an already-keyed remote project exactly once', async () => {
    mockEnvironment.openProject.mockResolvedValue({
      projectId: 'p1',
      path: '/work/remote-app',
      name: 'remote-app',
    })
    resetStore({ selectedHostConnectionId: 'env-remote' })

    await useAppStore.getState().selectProject('remote:env-remote:/work/remote-app', {
      connectionId: 'env-remote',
      projectId: 'p1',
    })

    expect(mockEnvironment.openProject).toHaveBeenCalledWith('env-remote', '/work/remote-app')
    expect(useAppStore.getState().currentFolder).toBe('remote:env-remote:/work/remote-app')
    expect(useChatStore.getState().activeProject).toBe('remote:env-remote:/work/remote-app')
  })

  it('does not auto-select an existing remote session (stays on New session draft)', async () => {
    mockEnvironment.openProject.mockResolvedValue({
      projectId: 'p1',
      path: '/work/remote-app',
      name: 'remote-app',
    })
    mockEnvironment.listSessions.mockResolvedValue([
      { sessionId: 'hist-1', title: 'yesterday', lastActiveAt: '2026-08-01T00:00:00.000Z' },
    ])
    mockEnsureSession.mockClear()
    mockSwitchSession.mockClear()
    mockEnvironment.listSessions.mockClear()
    resetStore({ selectedHostConnectionId: 'env-remote' })

    await useAppStore.getState().selectProject('remote:env-remote:/work/remote-app', {
      connectionId: 'env-remote',
      projectId: 'p1',
    })

    expect(mockEnvironment.listSessions).not.toHaveBeenCalled()
    expect(mockSwitchSession).not.toHaveBeenCalled()
    expect(mockEnsureSession).toHaveBeenCalledWith('remote:env-remote:/work/remote-app')
  })
})

describe('setSelectedHostConnectionId', () => {
  // Remote host selection is gated on this flag in the store; without it every
  // setSelectedHostConnectionId('env-*') is forced back to 'local'.
  beforeEach(() => {
    useAppStore.setState({ experimentalRemoteNodesEnabled: true })
  })

  it('opens the default project when no project was selected before the host switch', async () => {
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-remote', state: 'connected', label: 'lab' },
    ])
    mockEnvironment.listProjects.mockResolvedValue([
      { projectId: 'p1', path: '/work/remote-app', name: 'remote-app', lastActiveAt: 1 },
    ])
    mockEnvironment.openProject.mockResolvedValue({
      projectId: 'p1',
      path: '/work/remote-app',
      name: 'remote-app',
    })
    resetStore({ selectedHostConnectionId: 'local', currentFolder: null })

    useAppStore.getState().setSelectedHostConnectionId('env-remote')

    await vi.waitFor(() => {
      expect(useAppStore.getState().currentFolder).toBe('remote:env-remote:/work/remote-app')
    })
    expect(mockEnvironment.listProjects).toHaveBeenCalledWith('env-remote')
  })

  it('retries default selection when the selected host still has no active project', async () => {
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-remote', state: 'connected', label: 'lab' },
    ])
    mockEnvironment.listProjects.mockResolvedValue([
      { projectId: 'p1', path: '/work/remote-app', name: 'remote-app', lastActiveAt: 1 },
    ])
    mockEnvironment.openProject.mockResolvedValue({
      projectId: 'p1',
      path: '/work/remote-app',
      name: 'remote-app',
    })
    resetStore({ selectedHostConnectionId: 'env-remote', currentFolder: null })

    useAppStore.getState().setSelectedHostConnectionId('env-remote')

    await vi.waitFor(() => {
      expect(useAppStore.getState().currentFolder).toBe('remote:env-remote:/work/remote-app')
    })
  })

  it('opens the remote host default project after switching away from local', async () => {
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-remote', state: 'connected', label: 'lab' },
    ])
    mockEnvironment.listProjects.mockResolvedValue([
      { projectId: 'p1', path: '/work/remote-app', name: 'remote-app', lastActiveAt: 2 },
      { projectId: 'p2', path: '/work/older', name: 'older', lastActiveAt: 1 },
    ])
    mockEnvironment.openProject.mockResolvedValue({
      projectId: 'p1',
      path: '/work/remote-app',
      name: 'remote-app',
    })

    resetStore({
      selectedHostConnectionId: 'local',
      currentFolder: '/Users/dev/local-app',
      currentProjectId: 'pid-local',
    })
    await useChatStore.getState().focusProject('/Users/dev/local-app')

    useAppStore.getState().setSelectedHostConnectionId('env-remote')
    expect(useAppStore.getState().isSwitchingHostProject).toBe(true)
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      expect(useAppStore.getState().currentFolder).toBe('remote:env-remote:/work/remote-app')
    })

    expect(useAppStore.getState().selectedHostConnectionId).toBe('env-remote')
    expect(useAppStore.getState().isSwitchingHostProject).toBe(false)
    expect(useAppStore.getState().currentProjectId).toBe('p1')
    expect(useChatStore.getState().activeProject).toBe('remote:env-remote:/work/remote-app')
    expect(mockEnvironment.listProjects).toHaveBeenCalledWith('env-remote')
    expect(mockEnvironment.openProject).toHaveBeenCalledWith('env-remote', '/work/remote-app')
  })

  it('skips missing projects when choosing the remote host default', async () => {
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-remote', state: 'connected', label: 'lab' },
    ])
    mockEnvironment.listProjects.mockResolvedValue([
      { projectId: 'stale', path: '/old/project', name: 'old', lastActiveAt: 2, missing: true },
      { projectId: 'valid', path: '/work/valid', name: 'valid', lastActiveAt: 1 },
    ])
    mockEnvironment.openProject.mockResolvedValue({
      projectId: 'valid',
      path: '/work/valid',
      name: 'valid',
    })
    resetStore({ selectedHostConnectionId: 'local', currentFolder: null })

    useAppStore.getState().setSelectedHostConnectionId('env-remote')

    await vi.waitFor(() => {
      expect(useAppStore.getState().currentFolder).toBe('remote:env-remote:/work/valid')
    })
    expect(mockEnvironment.openProject).toHaveBeenCalledTimes(1)
    expect(mockEnvironment.openProject).toHaveBeenCalledWith('env-remote', '/work/valid')
  })

  it('keeps the active project when it already belongs to the target host', async () => {
    const remoteKey = 'remote:env-1:/work/app'
    resetStore({
      selectedHostConnectionId: 'env-1',
      currentFolder: remoteKey,
      currentProjectId: 'pid-remote',
    })
    await useChatStore.getState().focusProject(remoteKey)

    useAppStore.getState().setSelectedHostConnectionId('env-1')
    await vi.dynamicImportSettled()

    expect(useAppStore.getState().currentFolder).toBe(remoteKey)
    expect(useChatStore.getState().activeProject).toBe(remoteKey)
    expect(mockEnvironment.listProjects).not.toHaveBeenCalled()
  })

  it('opens the first local recent when switching back from a remote host', async () => {
    mockWindowApp.openFolder.mockResolvedValue(true)
    const remoteKey = 'remote:env-1:/work/app'
    resetStore({
      selectedHostConnectionId: 'env-1',
      currentFolder: remoteKey,
      currentProjectId: 'pid-remote',
      recentFolders: [
        {
          id: 'local-1',
          path: '/Users/dev/local-app',
          name: 'local-app',
          lastOpened: new Date().toISOString(),
          addedAt: new Date().toISOString(),
        },
      ],
    })
    await useChatStore.getState().focusProject(remoteKey)

    useAppStore.getState().setSelectedHostConnectionId('local')
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      expect(useAppStore.getState().currentFolder).toBe('/Users/dev/local-app')
    })

    expect(useChatStore.getState().activeProject).toBe('/Users/dev/local-app')
    expect(mockWindowApp.openFolder).toHaveBeenCalledWith('/Users/dev/local-app')
  })

  it('stays empty when the new host has no projects', async () => {
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-empty', state: 'connected', label: 'empty' },
    ])
    mockEnvironment.listProjects.mockResolvedValue([])

    resetStore({
      selectedHostConnectionId: 'local',
      currentFolder: '/Users/dev/local-app',
    })
    await useChatStore.getState().focusProject('/Users/dev/local-app')

    useAppStore.getState().setSelectedHostConnectionId('env-empty')
    await vi.dynamicImportSettled()
    await vi.waitFor(() => {
      expect(mockEnvironment.listProjects).toHaveBeenCalledWith('env-empty')
    })

    expect(useAppStore.getState().currentFolder).toBeNull()
    expect(useChatStore.getState().activeProject).toBeNull()
    expect(useAppStore.getState().isSwitchingHostProject).toBe(false)
  })

  it('keeps the host project transition loading until the default project opens', async () => {
    let resolveOpenProject!: (project: {
      projectId: string
      path: string
      name: string
    }) => void
    mockEnvironment.listItems.mockResolvedValue([
      { connectionId: 'env-slow', state: 'connected', label: 'slow lab' },
    ])
    mockEnvironment.listProjects.mockResolvedValue([
      { projectId: 'p-slow', path: '/work/slow-app', name: 'slow-app', lastActiveAt: 1 },
    ])
    mockEnvironment.openProject.mockReturnValue(new Promise((resolve) => {
      resolveOpenProject = resolve
    }))

    resetStore({
      selectedHostConnectionId: 'local',
      currentFolder: '/Users/dev/local-app',
      currentProjectId: 'pid-local',
    })
    await useChatStore.getState().focusProject('/Users/dev/local-app')

    useAppStore.getState().setSelectedHostConnectionId('env-slow')

    await vi.waitFor(() => {
      expect(mockEnvironment.openProject).toHaveBeenCalledWith('env-slow', '/work/slow-app')
    })
    expect(useAppStore.getState().isSwitchingHostProject).toBe(true)
    expect(useChatStore.getState().activeProject).toBeNull()

    resolveOpenProject({ projectId: 'p-slow', path: '/work/slow-app', name: 'slow-app' })
    await vi.waitFor(() => {
      expect(useAppStore.getState().isSwitchingHostProject).toBe(false)
    })
    expect(useChatStore.getState().activeProject).toBe('remote:env-slow:/work/slow-app')
  })
})

describe('currentFolder subscription', () => {
  it('should reset stores when project changes', async () => {
    resetStore({ currentFolder: '/projA' })

    useAppStore.setState({ currentFolder: '/projB' })
    await vi.dynamicImportSettled()

    expect(mockSourceControlReset).toHaveBeenCalled()
  })

  it('should not reset when currentFolder stays the same', async () => {
    useAppStore.setState({ currentFolder: '/projA' })
    await vi.dynamicImportSettled()
    mockSourceControlReset.mockClear()

    useAppStore.setState({ showSidebar: false })
    await vi.dynamicImportSettled()

    expect(mockSourceControlReset).not.toHaveBeenCalled()
  })
})

describe('startProjectMirror initial sync', () => {
  it('seeds currentFolder from activeProject that is already set when the mirror starts', async () => {
    // subscribe() never replays the current value, so a mirror started after activeProject is
    // already set (HMR store re-create, late wire-up) must sync it on start or currentFolder
    // stays null — the status-bar indicators and ChatSuggestions then read as "no project".
    vi.resetModules()
    const freshChat = await import('./chat')
    freshChat.useChatStore.setState(() => ({ activeProject: '/preset' }))

    const freshApp = await import('./app')
    expect(freshApp.useAppStore.getState().currentFolder).toBeNull()

    freshApp.startProjectMirror(freshChat.useChatStore)

    expect(freshApp.useAppStore.getState().currentFolder).toBe('/preset')
  })
})

describe('clearWorktree', () => {
  it('switches runtime back to project root even when activePath is already empty', async () => {
    useAppStore.setState({
      _worktrees: {
        '/proj': {
          pendingBaseBranch: null,
          pendingMode: 'branch',
          pendingBranchName: '',
          pendingCarryLocalChanges: false,
          activePath: null,
        },
      },
    })

    await useAppStore.getState().clearWorktree('/proj')

    expect(mockWindowApp.activateWorktree).toHaveBeenCalledWith('/proj', null)
  })
})

describe('clearPendingWorktree', () => {
  it('clears all pending fields while preserving activePath', () => {
    useAppStore.setState({
      _worktrees: {
        '/proj': {
          pendingBaseBranch: 'feat/x',
          pendingMode: 'attach',
          pendingBranchName: 'feat/y',
          pendingCarryLocalChanges: true,
          activePath: '/proj-worktrees/feat-x',
        },
      },
    })

    useAppStore.getState().clearPendingWorktree('/proj')

    const wt = useAppStore.getState()._worktrees['/proj']
    expect(wt).toEqual({
      pendingBaseBranch: null,
      pendingMode: 'branch',
      pendingBranchName: '',
      pendingCarryLocalChanges: false,
      activePath: '/proj-worktrees/feat-x',
    })
    expect(mockWindowApp.activateWorktree).not.toHaveBeenCalled()
  })

  it('is a no-op-style clear when there is no pending and no active', () => {
    useAppStore.setState({
      _worktrees: {
        '/proj': {
          pendingBaseBranch: null,
          pendingMode: 'branch',
          pendingBranchName: '',
          pendingCarryLocalChanges: false,
          activePath: null,
        },
      },
    })

    useAppStore.getState().clearPendingWorktree('/proj')

    expect(useAppStore.getState()._worktrees['/proj']).toEqual({
      pendingBaseBranch: null,
      pendingMode: 'branch',
      pendingBranchName: '',
      pendingCarryLocalChanges: false,
      activePath: null,
    })
  })

  it('initializes default state when projectPath has no entry', () => {
    useAppStore.setState({ _worktrees: {} })

    useAppStore.getState().clearPendingWorktree('/new-proj')

    expect(useAppStore.getState()._worktrees['/new-proj']).toEqual({
      pendingBaseBranch: null,
      pendingMode: 'branch',
      pendingBranchName: '',
      pendingCarryLocalChanges: false,
      activePath: null,
    })
  })
})

describe('settings harness config navigation', () => {
  function seedSettings(overrides: Record<string, unknown> = {}) {
    resetStore({
      settingsProvider: 'claude',
      settingsTab: 'providers',
      settingsProviderTabs: { claude: 'providers', codex: 'providers', cursor: 'providers', dsh: 'mcp' },
      harnessConfigSection: null,
      ...overrides,
    })
  }

  it('maps legacy provider config tabs into harnesses nested section', () => {
    seedSettings()

    useAppStore.getState().setSettingsTab('mcp')

    expect(useAppStore.getState().settingsTab).toBe('harnesses')
    expect(useAppStore.getState().harnessConfigSection).toBe('mcp')
  })

  it('setSettingsProvider only changes provider, not the active tab', () => {
    seedSettings({ settingsTab: 'harnesses', harnessConfigSection: 'preferences' })

    useAppStore.getState().setSettingsProvider('codex')

    expect(useAppStore.getState().settingsProvider).toBe('codex')
    expect(useAppStore.getState().settingsTab).toBe('harnesses')
    expect(useAppStore.getState().harnessConfigSection).toBe('preferences')
  })

  it('clears nested harness config when leaving the harnesses tab', () => {
    seedSettings({ settingsTab: 'harnesses', harnessConfigSection: 'skills' })

    useAppStore.getState().setSettingsTab('usage')

    expect(useAppStore.getState().settingsTab).toBe('usage')
    expect(useAppStore.getState().harnessConfigSection).toBeNull()
  })

  it('clears nested config when re-selecting harnesses from the sidebar', () => {
    seedSettings({ settingsTab: 'harnesses', harnessConfigSection: 'plugins' })

    useAppStore.getState().setSettingsTab('harnesses')

    expect(useAppStore.getState().settingsTab).toBe('harnesses')
    expect(useAppStore.getState().harnessConfigSection).toBeNull()
  })

  it('openHarnessSettings aligns settingsProvider for Cursor', () => {
    seedSettings({ settingsProvider: 'claude' })

    useAppStore.getState().openHarnessSettings('cursor')

    expect(useAppStore.getState().settingsTab).toBe('harnesses')
    expect(useAppStore.getState().settingsProvider).toBe('cursor')
    expect(useAppStore.getState().harnessListFocusKey).toBe('cursor')
  })

  it('openHarnessSettings aligns settingsProvider for dsh', () => {
    seedSettings({ settingsProvider: 'claude' })

    useAppStore.getState().openHarnessSettings('dsh')

    expect(useAppStore.getState().settingsTab).toBe('harnesses')
    expect(useAppStore.getState().settingsProvider).toBe('dsh')
    expect(useAppStore.getState().harnessListFocusKey).toBe('dsh')
  })
})
