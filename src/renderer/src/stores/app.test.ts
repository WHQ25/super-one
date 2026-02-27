import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSourceControlReset = vi.fn()
vi.mock('./source-control', () => ({
  useSourceControlStore: {
    getState: () => ({ reset: mockSourceControlReset }),
  },
}))

vi.mock('./chat', () => {
  const state = { projectSessions: {} as Record<string, unknown>, activeProject: null as string | null }
  return {
    useChatStore: Object.assign(
      () => state,
      {
        getState: () => ({
          setGlobalResources: vi.fn(),
          ensureSession: vi.fn(),
          switchProject: vi.fn(),
        }),
        setState: (fn: (s: typeof state) => Partial<typeof state>) => {
          Object.assign(state, fn(state))
        },
      },
    ),
  }
})

const mockWindowApp = {
  closeProject: vi.fn().mockResolvedValue(undefined),
  removeRecentFolder: vi.fn(),
  openFolder: vi.fn().mockResolvedValue(true),
  selectFolder: vi.fn(),
  getRecentFolders: vi.fn().mockResolvedValue([]),
  getStartupData: vi.fn().mockResolvedValue({ userSkills: [], userCommands: [], userAgents: [] }),
  connectClaude: vi.fn().mockResolvedValue({ models: [], account: {}, slashCommands: [], userSkills: [], userCommands: [], userAgents: [] }),
}

vi.stubGlobal('window', { app: mockWindowApp })

const { useAppStore } = await import('./app')

function resetStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    view: 'setup',
    currentFolder: null,
    recentFolders: [],
    layoutMode: 'coding',
    _worktrees: {},
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
})

describe('removeRecentFolder', () => {
  it('should switch to next project when deleting the active project', async () => {
    const remaining = [{ name: 'other', path: '/other' }]
    mockWindowApp.removeRecentFolder.mockResolvedValue(remaining)
    mockWindowApp.openFolder.mockResolvedValue(true)
    mockWindowApp.getRecentFolders.mockResolvedValue(remaining)

    resetStore({
      view: 'main',
      currentFolder: '/active',
      recentFolders: [{ name: 'active', path: '/active' }, ...remaining],
    })

    await useAppStore.getState().removeRecentFolder('/active')

    expect(useAppStore.getState().currentFolder).toBe('/other')
    expect(useAppStore.getState().view).toBe('main')
  })

  it('should navigate to startup when deleting the last project', async () => {
    mockWindowApp.removeRecentFolder.mockResolvedValue([])

    resetStore({
      view: 'main',
      currentFolder: '/only',
      recentFolders: [{ name: 'only', path: '/only' }],
    })

    await useAppStore.getState().removeRecentFolder('/only')

    expect(useAppStore.getState().currentFolder).toBeNull()
    expect(useAppStore.getState().view).toBe('startup')
  })

  it('should not change view when deleting a non-active project', async () => {
    const remaining = [{ name: 'active', path: '/active' }]
    mockWindowApp.removeRecentFolder.mockResolvedValue(remaining)

    resetStore({
      view: 'main',
      currentFolder: '/active',
      recentFolders: [{ name: 'active', path: '/active' }, { name: 'other', path: '/other' }],
    })

    await useAppStore.getState().removeRecentFolder('/other')

    expect(useAppStore.getState().currentFolder).toBe('/active')
    expect(useAppStore.getState().view).toBe('main')
  })
})

describe('continueToMain', () => {
  it('should show startup page when no projects exist', async () => {
    resetStore({ recentFolders: [], layoutMode: 'coding' })

    await useAppStore.getState().continueToMain()

    expect(useAppStore.getState().view).toBe('startup')
  })

  it('should go to main and open first project when projects exist', async () => {
    const folders = [{ name: 'proj', path: '/proj' }]
    mockWindowApp.openFolder.mockResolvedValue(true)
    mockWindowApp.getRecentFolders.mockResolvedValue(folders)

    resetStore({ recentFolders: folders, layoutMode: 'coding' })

    await useAppStore.getState().continueToMain()

    expect(useAppStore.getState().view).toBe('main')
    expect(useAppStore.getState().currentFolder).toBe('/proj')
  })
})

describe('openFolderDirect (via selectAndOpenFolder)', () => {
  it('should navigate from startup to main when opening a project', async () => {
    mockWindowApp.selectFolder.mockResolvedValue('/new')
    mockWindowApp.openFolder.mockResolvedValue(true)
    mockWindowApp.getRecentFolders.mockResolvedValue([{ name: 'new', path: '/new' }])

    resetStore({ view: 'startup' })

    await useAppStore.getState().selectAndOpenFolder()

    expect(useAppStore.getState().view).toBe('main')
    expect(useAppStore.getState().currentFolder).toBe('/new')
  })
})

describe('currentFolder subscription', () => {
  it('should reset file panel and stores when project changes', async () => {
    resetStore({ currentFolder: '/projA', showFilePanel: true })

    useAppStore.setState({ currentFolder: '/projB' })
    await vi.dynamicImportSettled()

    expect(useAppStore.getState().showFilePanel).toBe(false)
    expect(mockSourceControlReset).toHaveBeenCalled()
  })

  it('should not reset when currentFolder stays the same', async () => {
    useAppStore.setState({ currentFolder: '/projA' })
    await vi.dynamicImportSettled()
    mockSourceControlReset.mockClear()

    useAppStore.setState({ showFilePanel: true, layoutMode: 'canvas' })
    await vi.dynamicImportSettled()

    expect(useAppStore.getState().showFilePanel).toBe(true)
    expect(mockSourceControlReset).not.toHaveBeenCalled()
  })
})
