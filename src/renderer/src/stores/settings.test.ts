import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./app', () => ({
  useAppStore: {
    getState: vi.fn(() => ({ currentFolder: '/project', settingsProvider: 'claude' })),
  },
}))

const mockWindowApp = {
  toggleMcpConfig: vi.fn().mockResolvedValue(undefined),
  codexToggleMcpConfig: vi.fn().mockResolvedValue(undefined),
  checkMcpServers: vi.fn().mockResolvedValue({ status: [], meta: {} }),
  listMcpLibrary: vi.fn().mockResolvedValue([]),
  deleteSkill: vi.fn().mockResolvedValue(undefined),
  codexDeleteSkill: vi.fn().mockResolvedValue(undefined),
  listSkills: vi.fn().mockResolvedValue([]),
  codexListSkills: vi.fn().mockResolvedValue([]),
  listMcpConfigs: vi.fn().mockResolvedValue([]),
  codexListMcpConfigs: vi.fn().mockResolvedValue([]),
  saveMcpConfig: vi.fn().mockResolvedValue(undefined),
  codexSaveMcpConfig: vi.fn().mockResolvedValue(undefined),
  deleteMcpConfig: vi.fn().mockResolvedValue(undefined),
  codexDeleteMcpConfig: vi.fn().mockResolvedValue(undefined),
  deleteMcpLibraryEntry: vi.fn().mockResolvedValue(undefined),
  installSkill: vi.fn().mockResolvedValue(undefined),
  deletePlugin: vi.fn().mockResolvedValue(undefined),
  codexDeletePlugin: vi.fn().mockResolvedValue(undefined),
  listPlugins: vi.fn().mockResolvedValue([]),
  codexListPlugins: vi.fn().mockResolvedValue([]),
  installPlugin: vi.fn().mockResolvedValue(undefined),
  codexInstallPlugin: vi.fn().mockResolvedValue(undefined),
  listMarketplacePlugins: vi.fn().mockResolvedValue([]),
  codexListMarketplacePlugins: vi.fn().mockResolvedValue([]),
  readPlugin: vi.fn().mockResolvedValue(null),
  codexReadPlugin: vi.fn().mockResolvedValue(null),
  readPluginFile: vi.fn().mockResolvedValue(null),
  codexReadPluginFile: vi.fn().mockResolvedValue(null),
}

vi.stubGlobal('window', { app: mockWindowApp })

const { useSettingsStore } = await import('./settings')
const { useAppStore } = await import('./app')
const store = useSettingsStore

function resetStore(overrides: Record<string, unknown> = {}) {
  store.setState({
    mcpConfigs: [],
    mcpStatus: [],
    mcpMeta: {},
    selectedMcpName: null,
    skills: [],
    skillDetail: null,
    skillFileContent: null,
    skillFilePath: null,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
  vi.mocked(useAppStore.getState).mockReturnValue({
    currentFolder: '/project',
    settingsProvider: 'claude',
  } as ReturnType<typeof useAppStore.getState>)
})

describe('toggleMcpConfig', () => {
  it('should optimistically set status to disabled when disabled=true', async () => {
    resetStore({
      mcpConfigs: [{ name: 'test-server', disabled: false }],
      mcpStatus: [{ name: 'test-server', status: 'running' }],
    })

    const promise = store.getState().toggleMcpConfig('test-server', true, 'user')

    expect(store.getState().mcpConfigs[0].disabled).toBe(true)
    expect(store.getState().mcpStatus[0].status).toBe('disabled')

    await promise
  })

  it('should optimistically set status to pending when disabled=false', async () => {
    resetStore({
      mcpConfigs: [{ name: 'test-server', disabled: true }],
      mcpStatus: [{ name: 'test-server', status: 'disabled' }],
    })

    const promise = store.getState().toggleMcpConfig('test-server', false, 'user')

    expect(store.getState().mcpConfigs[0].disabled).toBe(false)
    expect(store.getState().mcpStatus[0].status).toBe('pending')

    await promise
  })

  it('should update state before IPC call resolves', async () => {
    let ipcResolved = false
    mockWindowApp.toggleMcpConfig.mockImplementation(
      () => new Promise<void>((r) => setTimeout(() => { ipcResolved = true; r() }, 50))
    )

    resetStore({
      mcpConfigs: [{ name: 'srv', disabled: false }],
      mcpStatus: [{ name: 'srv', status: 'running' }],
    })

    const promise = store.getState().toggleMcpConfig('srv', true, 'user')

    expect(ipcResolved).toBe(false)
    expect(store.getState().mcpConfigs[0].disabled).toBe(true)
    expect(store.getState().mcpStatus[0].status).toBe('disabled')

    await promise
  })

  it('should call IPC with correct arguments', async () => {
    resetStore({
      mcpConfigs: [{ name: 'srv', disabled: false }],
      mcpStatus: [{ name: 'srv', status: 'running' }],
    })

    await store.getState().toggleMcpConfig('srv', true, 'project')

    expect(mockWindowApp.toggleMcpConfig).toHaveBeenCalledWith('/project', 'srv', true, 'project')
  })

  it('should use Codex IPC when provider is codex', async () => {
    vi.mocked(useAppStore.getState).mockReturnValue({
      currentFolder: '/project',
      settingsProvider: 'codex',
    } as ReturnType<typeof useAppStore.getState>)
    resetStore({
      codexMcpConfigs: [{ name: 'srv', disabled: false }],
    })

    await store.getState().toggleMcpConfig('srv', true, 'user')

    expect(mockWindowApp.codexToggleMcpConfig).toHaveBeenCalledWith('/project', 'srv', true, 'user')
    expect(mockWindowApp.toggleMcpConfig).not.toHaveBeenCalled()
  })

  it('should only update the matching server in configs and status', async () => {
    resetStore({
      mcpConfigs: [
        { name: 'a', disabled: false },
        { name: 'b', disabled: false },
      ],
      mcpStatus: [
        { name: 'a', status: 'running' },
        { name: 'b', status: 'running' },
      ],
    })

    const promise = store.getState().toggleMcpConfig('a', true, 'user')

    expect(store.getState().mcpConfigs[0].disabled).toBe(true)
    expect(store.getState().mcpConfigs[1].disabled).toBe(false)
    expect(store.getState().mcpStatus[0].status).toBe('disabled')
    expect(store.getState().mcpStatus[1].status).toBe('running')

    await promise
  })
})

describe('deleteSkill', () => {
  it('should call normal delete path when provider is claude', async () => {
    await store.getState().deleteSkill('my-skill', 'user')

    expect(mockWindowApp.deleteSkill).toHaveBeenCalledWith('/project', 'my-skill', 'user')
    expect(mockWindowApp.codexDeleteSkill).not.toHaveBeenCalled()
  })

  it('should call codex delete path when provider is codex', async () => {
    vi.mocked(useAppStore.getState).mockReturnValue({
      currentFolder: '/project',
      settingsProvider: 'codex',
    } as ReturnType<typeof useAppStore.getState>)

    await store.getState().deleteSkill('my-skill', 'user')

    expect(mockWindowApp.codexDeleteSkill).toHaveBeenCalledWith('/project', 'my-skill', 'user')
    expect(mockWindowApp.deleteSkill).not.toHaveBeenCalled()
  })

  it('should refresh skills list via fetchSkills for claude provider', async () => {
    const refreshed = [{ name: 'remaining-skill' }]
    mockWindowApp.listSkills.mockResolvedValue(refreshed)

    await store.getState().deleteSkill('my-skill', 'user')

    expect(mockWindowApp.listSkills).toHaveBeenCalledWith('/project')
    expect(store.getState().skills).toEqual(refreshed)
  })

  it('should refresh skills list via fetchCodexSkills for codex provider', async () => {
    vi.mocked(useAppStore.getState).mockReturnValue({
      currentFolder: '/project',
      settingsProvider: 'codex',
    } as ReturnType<typeof useAppStore.getState>)

    const refreshed = [{ name: 'codex-skill' }]
    mockWindowApp.codexListSkills.mockResolvedValue(refreshed)

    await store.getState().deleteSkill('my-skill', 'project')

    expect(mockWindowApp.codexListSkills).toHaveBeenCalledWith('/project')
    expect(store.getState().skills).toEqual(refreshed)
  })

  it('should clear skill detail state after deletion', async () => {
    resetStore({
      skillDetail: { name: 'my-skill' },
      skillFileContent: 'content',
      skillFilePath: '/path',
    })

    await store.getState().deleteSkill('my-skill', 'user')

    expect(store.getState().skillDetail).toBeNull()
    expect(store.getState().skillFileContent).toBeNull()
    expect(store.getState().skillFilePath).toBeNull()
  })
})

describe('deleteMcpConfig', () => {
  it('should clear selectedMcpName and refresh configs after deletion', async () => {
    resetStore({ selectedMcpName: 'srv' })

    await store.getState().deleteMcpConfig('srv', 'user')

    expect(mockWindowApp.deleteMcpConfig).toHaveBeenCalledWith('/project', 'srv', 'user')
    expect(store.getState().selectedMcpName).toBeNull()
  })

  it('should use Codex delete path when provider is codex', async () => {
    vi.mocked(useAppStore.getState).mockReturnValue({
      currentFolder: '/project',
      settingsProvider: 'codex',
    } as ReturnType<typeof useAppStore.getState>)

    await store.getState().deleteMcpConfig('srv', 'user')

    expect(mockWindowApp.codexDeleteMcpConfig).toHaveBeenCalledWith('/project', 'srv', 'user')
    expect(mockWindowApp.deleteMcpConfig).not.toHaveBeenCalled()
  })
})

describe('saveMcpConfig', () => {
  it('should refresh configs and check servers after save', async () => {
    const config = { command: 'node', args: ['server.js'] }

    await store.getState().saveMcpConfig('new-srv', config, 'user')

    expect(mockWindowApp.saveMcpConfig).toHaveBeenCalledWith('/project', 'new-srv', config, 'user')
    expect(mockWindowApp.listMcpConfigs).toHaveBeenCalled()
    expect(mockWindowApp.checkMcpServers).toHaveBeenCalled()
  })

  it('should use Codex save path when provider is codex', async () => {
    vi.mocked(useAppStore.getState).mockReturnValue({
      currentFolder: '/project',
      settingsProvider: 'codex',
    } as ReturnType<typeof useAppStore.getState>)

    const config = { command: 'node', args: ['server.js'] }
    await store.getState().saveMcpConfig('new-srv', config, 'user')

    expect(mockWindowApp.codexSaveMcpConfig).toHaveBeenCalledWith('/project', 'new-srv', config, 'user')
    expect(mockWindowApp.saveMcpConfig).not.toHaveBeenCalled()
    expect(mockWindowApp.codexListMcpConfigs).toHaveBeenCalled()
  })
})

describe('installSkill', () => {
  it('should refresh skills after installation', async () => {
    const refreshed = [{ name: 'installed' }]
    mockWindowApp.listSkills.mockResolvedValue(refreshed)

    await store.getState().installSkill('/source/path')

    expect(mockWindowApp.installSkill).toHaveBeenCalledWith('/source/path')
    expect(store.getState().skills).toEqual(refreshed)
  })
})

describe('deletePlugin', () => {
  it('should clear detail state and refresh plugins after deletion', async () => {
    store.setState({
      pluginDetail: { key: 'test' } as never,
      pluginFileContent: 'content',
      pluginFilePath: '/path',
    })

    await store.getState().deletePlugin('test', 'user')

    expect(mockWindowApp.deletePlugin).toHaveBeenCalledWith('/project', 'test', 'user')
    expect(store.getState().pluginDetail).toBeNull()
    expect(store.getState().pluginFileContent).toBeNull()
    expect(store.getState().pluginFilePath).toBeNull()
    expect(mockWindowApp.listPlugins).toHaveBeenCalled()
  })

  it('should use Codex delete path when provider is codex', async () => {
    vi.mocked(useAppStore.getState).mockReturnValue({
      currentFolder: '/project',
      settingsProvider: 'codex',
    } as ReturnType<typeof useAppStore.getState>)

    await store.getState().deletePlugin('test', 'user')

    expect(mockWindowApp.codexDeletePlugin).toHaveBeenCalledWith('/project', 'test', 'user')
    expect(mockWindowApp.deletePlugin).not.toHaveBeenCalled()
  })
})

describe('installPlugin', () => {
  it('should refresh plugins and marketplace after installation', async () => {
    await store.getState().installPlugin('my-plugin', 'user')

    expect(mockWindowApp.installPlugin).toHaveBeenCalledWith('/project', 'my-plugin', 'user')
    expect(mockWindowApp.listPlugins).toHaveBeenCalled()
    expect(mockWindowApp.listMarketplacePlugins).toHaveBeenCalled()
  })

  it('should use Codex install path when provider is codex', async () => {
    vi.mocked(useAppStore.getState).mockReturnValue({
      currentFolder: '/project',
      settingsProvider: 'codex',
    } as ReturnType<typeof useAppStore.getState>)

    await store.getState().installPlugin('my-plugin', 'user')

    expect(mockWindowApp.codexInstallPlugin).toHaveBeenCalledWith('/project', 'my-plugin', 'user')
    expect(mockWindowApp.installPlugin).not.toHaveBeenCalled()
    expect(mockWindowApp.codexListPlugins).toHaveBeenCalled()
    expect(mockWindowApp.codexListMarketplacePlugins).toHaveBeenCalled()
  })
})

describe('deleteMcpLibraryEntry', () => {
  it('should refresh library after deletion', async () => {
    await store.getState().deleteMcpLibraryEntry('entry')

    expect(mockWindowApp.deleteMcpLibraryEntry).toHaveBeenCalledWith('entry')
    expect(mockWindowApp.listMcpLibrary).toHaveBeenCalled()
  })
})
