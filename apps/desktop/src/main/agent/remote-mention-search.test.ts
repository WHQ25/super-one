import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  discoverApps: vi.fn(),
  discoverProjectApps: vi.fn(),
  listInstalledApps: vi.fn(),
  resolveAppIconDataUri: vi.fn(),
  searchMentions: vi.fn(),
}))

vi.mock('electron', () => ({
  nativeImage: {
    createFromPath: () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 64, height: 64 }),
      toDataURL: () => 'data:image/png;base64,bWluaQ==',
    }),
  },
}))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => ({}) }))
vi.mock('../computer-use/app-icon-resolver', () => ({ resolveAppIconDataUri: mocks.resolveAppIconDataUri }))
vi.mock('../computer-use/resolve-installed-app', () => ({ listInstalledApps: mocks.listInstalledApps }))
vi.mock('../miniapp/miniapp-service', () => ({
  discoverApps: mocks.discoverApps,
  discoverProjectApps: mocks.discoverProjectApps,
  validatePath: (root: string, path: string) => `${root}/${path}`,
}))
vi.mock('./discover-resources', () => ({ discoverAllAgents: () => [] }))
vi.mock('./fuzzy-file-search', () => ({ searchMentions: mocks.searchMentions }))
vi.mock('../session/agent-profiles', () => ({ listAgentMentionTargets: () => [] }))
vi.mock('@superone/shared/mention-capabilities', () => ({ availableMentionCapabilityIds: () => ['computer'] }))

import { searchRemoteMentions } from './remote-mention-search'

describe('remote mention app results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.discoverApps.mockResolvedValue([])
    mocks.discoverProjectApps.mockResolvedValue([])
    mocks.listInstalledApps.mockResolvedValue([])
    mocks.resolveAppIconDataUri.mockResolvedValue(null)
    mocks.searchMentions.mockReturnValue([{ kind: 'file', path: 'src/App.tsx' }])
  })

  it('returns desktop and miniapp identities with bounded PNG artwork', async () => {
    mocks.discoverApps.mockResolvedValue([{ id: 'board', manifest: { name: 'Board', logo: 'logo.png' }, installDir: '/apps/board' }])
    mocks.listInstalledApps.mockResolvedValue([{ app: 'Editor', bundleId: 'com.example.Editor', path: '/Applications/Editor.app', aliases: ['Code Editor'] }])
    mocks.resolveAppIconDataUri.mockResolvedValue('data:image/png;base64,ZGVza3RvcA==')

    const result = await searchRemoteMentions('/project', '/project', 'd')

    expect(result.items).toEqual([
      expect.objectContaining({ kind: 'miniapp', path: 'board', label: 'Board', iconDataUri: 'data:image/png;base64,bWluaQ==' }),
      expect.objectContaining({ kind: 'desktop-app', path: 'com.example.Editor', label: 'Editor', iconDataUri: 'data:image/png;base64,ZGVza3RvcA==' }),
      { kind: 'file', path: 'src/App.tsx' },
    ])
  })

  it('keeps file search available when app discovery and icon lookup fail', async () => {
    mocks.discoverApps.mockRejectedValue(new Error('miniapps unavailable'))
    mocks.discoverProjectApps.mockRejectedValue(new Error('project unavailable'))
    mocks.listInstalledApps.mockResolvedValue([{ app: 'Editor', bundleId: 'com.example.Editor', path: '/Applications/Editor.app', aliases: [] }])
    mocks.resolveAppIconDataUri.mockRejectedValue(new Error('icon unavailable'))

    const result = await searchRemoteMentions('/project', '/project', '')

    // An icon that could not be resolved is simply absent, rather than a key
    // holding `undefined` that the wire would carry anyway.
    expect(result.items).toEqual([
      expect.objectContaining({ kind: 'desktop-app', path: 'com.example.Editor' }),
      { kind: 'file', path: 'src/App.tsx' },
    ])
    expect(result.items[0]).not.toHaveProperty('iconDataUri')
  })
})

describe('scoped mention search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.discoverApps.mockResolvedValue([])
    mocks.discoverProjectApps.mockResolvedValue([])
    mocks.listInstalledApps.mockResolvedValue([])
    mocks.resolveAppIconDataUri.mockResolvedValue(null)
    mocks.searchMentions.mockReturnValue([])
  })

  it('confines the crawl to the directory the client is browsing', async () => {
    await searchRemoteMentions('/project', '/worktree', 'app', { scopeDir: 'src/' })
    expect(mocks.searchMentions).toHaveBeenCalledWith(['/worktree'], 'app', [], 20, 'src/')
  })

  it('searches the session cwd alongside its extra roots, never twice', async () => {
    await searchRemoteMentions('/project', '/worktree', 'app', { additionalDirs: ['/shared', '/worktree'] })
    expect(mocks.searchMentions).toHaveBeenCalledWith(['/worktree', '/shared'], 'app', [], 20, undefined)
  })

  it('reports the cwd and the options it honoured', async () => {
    // A client cannot tell a scoped answer from an older host's project-wide
    // one otherwise, and the unscoped top-20 may hold no in-scope file at all.
    const result = await searchRemoteMentions('/project', '/worktree', 'app', { scopeDir: 'src/' })
    expect(result.cwd).toBe('/worktree')
    expect(result.appliedOptions).toEqual({ scopeDir: true, additionalDirs: false, iconsById: false })
  })

  it('says it applied nothing when nothing was asked for', async () => {
    const result = await searchRemoteMentions('/project', '/project', 'app')
    expect(result.appliedOptions).toEqual({ scopeDir: false, additionalDirs: false, iconsById: false })
  })
})

describe('icons over the wire', () => {
  beforeEach(async () => {
    // The registry is process-wide; one case's ids would otherwise answer the next.
    const { resetMentionIconRegistry } = await import('./remote-mention-icons')
    resetMentionIconRegistry()
    vi.clearAllMocks()
    mocks.discoverApps.mockResolvedValue([])
    mocks.discoverProjectApps.mockResolvedValue([])
    mocks.listInstalledApps.mockResolvedValue([
      { app: 'Editor', bundleId: 'com.example.Editor', path: '/Applications/Editor.app', aliases: [] },
    ])
    mocks.resolveAppIconDataUri.mockResolvedValue('data:image/png;base64,ZGVza3RvcA==')
    mocks.searchMentions.mockReturnValue([])
  })

  it('inlines the bytes for a client that has nowhere to cache them', async () => {
    const result = await searchRemoteMentions('/project', '/project', 'ed')
    expect(result.items[0]).toMatchObject({ iconDataUri: 'data:image/png;base64,ZGVza3RvcA==' })
    expect(result.items[0]).not.toHaveProperty('iconId')
  })

  it('sends an id instead once the client says it caches', async () => {
    // A phone re-runs this on every keystroke; the icons are most of the answer.
    const result = await searchRemoteMentions('/project', '/project', 'ed', { iconsById: true })
    expect(result.items[0]).not.toHaveProperty('iconDataUri')
    expect(result.items[0]).toMatchObject({ iconId: expect.stringMatching(/^[0-9a-f]{16}$/) })
    expect(result.appliedOptions).toMatchObject({ iconsById: true })
  })

  it('gives the same artwork the same id, so two rows cost one fetch', async () => {
    mocks.listInstalledApps.mockResolvedValue([
      { app: 'Editor', bundleId: 'com.example.Editor', path: '/a.app', aliases: [] },
      { app: 'Editor 2', bundleId: 'com.example.Editor2', path: '/b.app', aliases: [] },
    ])
    const result = await searchRemoteMentions('/project', '/project', 'ed', { iconsById: true })
    const ids = result.items.map((item) => (item as { iconId?: string }).iconId)
    expect(ids[0]).toBe(ids[1])
  })

  it('answers a later lookup with the bytes it registered', async () => {
    const { lookupMentionIcons } = await import('./remote-mention-icons')
    const result = await searchRemoteMentions('/project', '/project', 'ed', { iconsById: true })
    const id = (result.items[0] as { iconId: string }).iconId
    expect(lookupMentionIcons([id])).toEqual({ [id]: 'data:image/png;base64,ZGVza3RvcA==' })
    expect(lookupMentionIcons(['never-registered'])).toEqual({})
  })
})
