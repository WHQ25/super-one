import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReaddir = vi.fn()
const mockWriteFile = vi.fn()
const mockMkdir = vi.fn()
const mockReadFile = vi.fn()
const mockStat = vi.fn()

vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  glob: vi.fn(),
  watch: vi.fn(),
}))
vi.mock('fs', () => ({ watch: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/mock-home' } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../git-run', () => ({ gitRun: vi.fn() }))
vi.mock('../path-security', () => ({ sanitizeGitRef: vi.fn((s: string) => s) }))
vi.mock('../git-status-utils', () => ({ parseGitStatusFiles: vi.fn(() => []) }))

import { discoverProjectApps, detectStandaloneApp, createMiniApp, getProjectAppsDir, setAllowedDirectories, clearAllowedDirectories, handleFsRequest, resolveAppEntry, setAllowedMedia, isMediaAllowed, clearAllowedMedia, getAllowedMedia, appIdFromUrl } from './miniapp-service'

function mockManifest(appId: string, name: string) {
  return { appId, name, tools: [] }
}

const MOCK_TS = 1700000000000
const MOCK_TS_B36 = MOCK_TS.toString(36)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(MOCK_TS)
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
})

describe('getProjectAppsDir', () => {
  it('returns .superone/apps under project dir', () => {
    expect(getProjectAppsDir('/projects/my-app')).toBe('/projects/my-app/.superone/apps')
  })
})

describe('resolveAppEntry', () => {
  const installDir = '/projects/test/.superone/apps/foo'

  it('returns null when no manifest and no .s1-dev.json exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result).toBeNull()
  })

  it('reads manifest from installDir when no .s1-dev.json (prod / legacy)', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`) return Promise.reject(new Error('ENOENT'))
      if (path === `${installDir}/manifest.json`) return Promise.resolve(JSON.stringify(mockManifest('foo', 'Foo')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result).not.toBeNull()
    expect(result!.id).toBe('foo')
    expect(result!.installDir).toBe(installDir)
    expect(result!.distDir).toBeUndefined()
  })

  it('resolves project-level dev link with relative distDir', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({ distDir: 'packages/foo/dist', enabled: true }))
      if (path === '/projects/test/packages/foo/dist/manifest.json')
        return Promise.resolve(JSON.stringify(mockManifest('foo', 'Foo')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result).not.toBeNull()
    expect(result!.id).toBe('foo')
    expect(result!.installDir).toBe(installDir)
    expect(result!.distDir).toBe('/projects/test/packages/foo/dist')
  })

  it('resolves user-level dev link with absolute distDir', async () => {
    const userInstall = '/mock-home/.superone/apps/notes'
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${userInstall}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({ distDir: '/Users/me/code/notes/dist', enabled: true }))
      if (path === '/Users/me/code/notes/dist/manifest.json')
        return Promise.resolve(JSON.stringify(mockManifest('notes', 'Notes')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(userInstall, {})
    expect(result).not.toBeNull()
    expect(result!.distDir).toBe('/Users/me/code/notes/dist')
  })

  it('falls back to installDir manifest when devlink enabled=false', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({ distDir: 'packages/foo/dist', enabled: false }))
      if (path === `${installDir}/manifest.json`)
        return Promise.resolve(JSON.stringify(mockManifest('foo', 'Foo (prod)')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result).not.toBeNull()
    expect(result!.manifest.name).toBe('Foo (prod)')
    expect(result!.distDir).toBeUndefined()
  })

  it('treats enabled omitted as true (default)', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({ distDir: 'packages/foo/dist' }))
      if (path === '/projects/test/packages/foo/dist/manifest.json')
        return Promise.resolve(JSON.stringify(mockManifest('foo', 'Foo dev')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result!.distDir).toBe('/projects/test/packages/foo/dist')
    expect(result!.manifest.name).toBe('Foo dev')
  })

  it('falls back to prod manifest when devlink enabled but distDir manifest missing', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({ distDir: 'packages/foo/dist', enabled: true }))
      if (path === `${installDir}/manifest.json`)
        return Promise.resolve(JSON.stringify(mockManifest('foo', 'Foo prod fallback')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result).not.toBeNull()
    expect(result!.manifest.name).toBe('Foo prod fallback')
    expect(result!.distDir).toBeUndefined()
  })

  it('returns null when devlink enabled, distDir manifest missing, and no prod manifest', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({ distDir: 'packages/foo/dist', enabled: true }))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result).toBeNull()
  })

  it('falls back to prod when devlink JSON is invalid', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`) return Promise.resolve('{not valid json')
      if (path === `${installDir}/manifest.json`)
        return Promise.resolve(JSON.stringify(mockManifest('foo', 'Foo')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result).not.toBeNull()
    expect(result!.distDir).toBeUndefined()
  })

  it('falls back to prod when devlink schema is invalid (missing distDir)', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({ enabled: true }))
      if (path === `${installDir}/manifest.json`)
        return Promise.resolve(JSON.stringify(mockManifest('foo', 'Foo')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result).not.toBeNull()
    expect(result!.distDir).toBeUndefined()
  })
})

describe('discoverProjectApps', () => {
  it('returns empty array when apps dir does not exist', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'))
    const result = await discoverProjectApps('/projects/my-app')
    expect(result).toEqual([])
  })

  it('discovers apps with valid manifests', async () => {
    mockReaddir.mockResolvedValue(['dashboard', 'todo'])
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('dashboard')) return Promise.resolve(JSON.stringify(mockManifest('dashboard', 'Dashboard')))
      if (path.includes('todo')) return Promise.resolve(JSON.stringify(mockManifest('todo', 'Todo')))
      return Promise.reject(new Error('not found'))
    })

    const result = await discoverProjectApps('/projects/my-app')
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('dashboard')
    expect(result[1].id).toBe('todo')
  })

  it('skips entries without valid manifest', async () => {
    mockReaddir.mockResolvedValue(['readme.md', 'my-app'])
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('my-app')) return Promise.resolve(JSON.stringify(mockManifest('my-app', 'My App')))
      return Promise.reject(new Error('ENOENT'))
    })

    const result = await discoverProjectApps('/projects/test')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('my-app')
  })

  it('returns empty when no valid manifests found', async () => {
    mockReaddir.mockResolvedValue(['broken'])
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const result = await discoverProjectApps('/projects/test')
    expect(result).toEqual([])
  })

  it('mixes dev-linked apps (via .s1-dev.json) with legacy vanilla apps in same scope', async () => {
    mockReaddir.mockResolvedValue(['vanilla-legacy', 'react-dev'])
    mockReadFile.mockImplementation((path: string) => {
      // legacy vanilla: manifest at installDir
      if (path === '/projects/p/.superone/apps/vanilla-legacy/manifest.json')
        return Promise.resolve(JSON.stringify(mockManifest('vanilla-legacy', 'Legacy')))
      if (path === '/projects/p/.superone/apps/vanilla-legacy/.s1-dev.json')
        return Promise.reject(new Error('ENOENT'))
      // dev-linked react: .s1-dev.json + manifest at distDir
      if (path === '/projects/p/.superone/apps/react-dev/.s1-dev.json')
        return Promise.resolve(JSON.stringify({ distDir: 'packages/react-dev/dist', enabled: true }))
      if (path === '/projects/p/packages/react-dev/dist/manifest.json')
        return Promise.resolve(JSON.stringify(mockManifest('react-dev', 'React')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await discoverProjectApps('/projects/p')
    expect(result).toHaveLength(2)
    const legacy = result.find((e) => e.id === 'vanilla-legacy')!
    const dev = result.find((e) => e.id === 'react-dev')!
    expect(legacy.installDir).toBe('/projects/p/.superone/apps/vanilla-legacy')
    expect(legacy.distDir).toBeUndefined()
    expect(dev.installDir).toBe('/projects/p/.superone/apps/react-dev')
    expect(dev.distDir).toBe('/projects/p/packages/react-dev/dist')
  })

  it('discovers a dev-linked app whose installDir is otherwise empty (only .s1-dev.json)', async () => {
    mockReaddir.mockResolvedValue(['fresh-dev'])
    mockReadFile.mockImplementation((path: string) => {
      if (path === '/projects/p/.superone/apps/fresh-dev/.s1-dev.json')
        return Promise.resolve(JSON.stringify({ distDir: 'tools/fresh/dist' }))
      if (path === '/projects/p/tools/fresh/dist/manifest.json')
        return Promise.resolve(JSON.stringify(mockManifest('fresh', 'Fresh')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await discoverProjectApps('/projects/p')
    expect(result).toHaveLength(1)
    expect(result[0].distDir).toBe('/projects/p/tools/fresh/dist')
  })

  it('falls back to prod manifest when dev link disabled, even with both files present (dev/prod coexist)', async () => {
    mockReaddir.mockResolvedValue(['both'])
    mockReadFile.mockImplementation((path: string) => {
      if (path === '/projects/p/.superone/apps/both/.s1-dev.json')
        return Promise.resolve(JSON.stringify({ distDir: 'packages/both/dist', enabled: false }))
      if (path === '/projects/p/.superone/apps/both/manifest.json')
        return Promise.resolve(JSON.stringify(mockManifest('both', 'Prod Version')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await discoverProjectApps('/projects/p')
    expect(result).toHaveLength(1)
    expect(result[0].manifest.name).toBe('Prod Version')
    expect(result[0].distDir).toBeUndefined()
  })
})

describe('detectStandaloneApp', () => {
  it('returns app from root manifest.json', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === '/projects/my-app/manifest.json') return Promise.resolve(JSON.stringify(mockManifest('my-app', 'My App')))
      return Promise.reject(new Error('not found'))
    })

    const result = await detectStandaloneApp('/projects/my-app')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('my-app')
    expect(result!.installDir).toBe('/projects/my-app')
    expect(result!.distDir).toBeUndefined()
  })

  it('falls back to dist/manifest.json when root missing', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === '/projects/my-app/dist/manifest.json') return Promise.resolve(JSON.stringify(mockManifest('built-app', 'Built App')))
      return Promise.reject(new Error('not found'))
    })

    const result = await detectStandaloneApp('/projects/my-app')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('built-app')
    expect(result!.distDir).toBe('/projects/my-app/dist')
  })

  it('prefers root manifest over dist', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === '/projects/my-app/manifest.json') return Promise.resolve(JSON.stringify(mockManifest('root-app', 'Root')))
      if (path === '/projects/my-app/dist/manifest.json') return Promise.resolve(JSON.stringify(mockManifest('dist-app', 'Dist')))
      return Promise.reject(new Error('not found'))
    })

    const result = await detectStandaloneApp('/projects/my-app')
    expect(result!.id).toBe('root-app')
  })

  it('returns null when no manifest exists', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const result = await detectStandaloneApp('/projects/empty')
    expect(result).toBeNull()
  })
})

describe('createMiniApp', () => {
  const appId = `test-app-${MOCK_TS_B36}`

  it('generates appId from slug + timestamp', async () => {
    const result = await createMiniApp({
      name: 'My Cool App!', slug: 'my-cool-app',
      directory: '/projects/p/packages/my-cool-app',
      projectDir: '/projects/p', scope: 'project',
    })
    expect(result.entry.id).toBe(`my-cool-app-${MOCK_TS_B36}`)
  })

  it('creates minimal manifest without tools or permissions', async () => {
    const result = await createMiniApp({
      name: 'Test', slug: 'test',
      directory: '/projects/p/packages/test',
      projectDir: '/projects/p', scope: 'project',
    })
    expect(result.entry.manifest.tools).toBeUndefined()
    expect(result.entry.manifest.permissions).toBeUndefined()
  })

  it('sets fullscreen and description in manifest', async () => {
    const result = await createMiniApp({
      name: 'Test', slug: 'test',
      directory: '/projects/p/packages/test',
      projectDir: '/projects/p', scope: 'project',
      fullscreen: true, description: 'A test app',
    })
    expect(result.entry.manifest.fullscreen).toBe(true)
    expect(result.entry.manifest.description).toBe('A test app')
  })

  describe('project scope + vanilla', () => {
    it('writes vanilla scaffold files to user-specified directory', async () => {
      await createMiniApp({
        name: 'Dashboard', slug: 'dashboard',
        directory: '/projects/test/tools/dashboard',
        projectDir: '/projects/test', scope: 'project', template: 'vanilla',
      })
      const writtenPaths = mockWriteFile.mock.calls.map((c: string[]) => c[0])
      expect(writtenPaths).toContain('/projects/test/tools/dashboard/manifest.json')
      expect(writtenPaths).toContain('/projects/test/tools/dashboard/index.html')
    })

    it('writes .s1-dev.json to <projectDir>/.superone/apps/<appId>/ with relative distDir = directory', async () => {
      await createMiniApp({
        name: 'Dashboard', slug: 'dashboard',
        directory: '/projects/test/tools/dashboard',
        projectDir: '/projects/test', scope: 'project', template: 'vanilla',
      })
      const devLinkCall = mockWriteFile.mock.calls.find((c: string[]) =>
        c[0] === `/projects/test/.superone/apps/dashboard-${MOCK_TS_B36}/.s1-dev.json`,
      )
      expect(devLinkCall).toBeDefined()
      const parsed = JSON.parse(devLinkCall![1])
      expect(parsed.distDir).toBe('tools/dashboard')
      expect(parsed.enabled).toBe(true)
    })

    it('returns buildRequired=false', async () => {
      const result = await createMiniApp({
        name: 'T', slug: 't',
        directory: '/projects/p/packages/t',
        projectDir: '/projects/p', scope: 'project', template: 'vanilla',
      })
      expect(result.buildRequired).toBe(false)
    })
  })

  describe('project scope + react', () => {
    it('writes React scaffold to user-specified directory', async () => {
      await createMiniApp({
        name: 'Dashboard', slug: 'dashboard',
        directory: '/projects/test/packages/dashboard',
        projectDir: '/projects/test', scope: 'project', template: 'react',
      })
      const writtenPaths = mockWriteFile.mock.calls.map((c: string[]) => c[0])
      expect(writtenPaths.some((p: string) => p === '/projects/test/packages/dashboard/package.json')).toBe(true)
      expect(writtenPaths.some((p: string) => p === '/projects/test/packages/dashboard/src/App.tsx')).toBe(true)
    })

    it('writes .s1-dev.json with relative distDir = <directory>/dist', async () => {
      await createMiniApp({
        name: 'Dashboard', slug: 'dashboard',
        directory: '/projects/test/packages/dashboard',
        projectDir: '/projects/test', scope: 'project', template: 'react',
      })
      const devLinkCall = mockWriteFile.mock.calls.find((c: string[]) =>
        c[0] === `/projects/test/.superone/apps/dashboard-${MOCK_TS_B36}/.s1-dev.json`,
      )
      expect(devLinkCall).toBeDefined()
      const parsed = JSON.parse(devLinkCall![1])
      expect(parsed.distDir).toBe('packages/dashboard/dist')
      expect(parsed.enabled).toBe(true)
    })

    it('returns buildRequired=true', async () => {
      const result = await createMiniApp({
        name: 'T', slug: 't',
        directory: '/projects/p/packages/t',
        projectDir: '/projects/p', scope: 'project', template: 'react',
      })
      expect(result.buildRequired).toBe(true)
    })
  })

  describe('user scope + vanilla', () => {
    it('writes scaffold to user-specified absolute directory', async () => {
      await createMiniApp({
        name: 'Notes', slug: 'notes',
        directory: '/Users/me/code/notes',
        scope: 'user', template: 'vanilla',
      })
      const writtenPaths = mockWriteFile.mock.calls.map((c: string[]) => c[0])
      expect(writtenPaths).toContain('/Users/me/code/notes/manifest.json')
    })

    it('writes .s1-dev.json to ~/.superone/apps/<appId>/ with absolute distDir', async () => {
      await createMiniApp({
        name: 'Notes', slug: 'notes',
        directory: '/Users/me/code/notes',
        scope: 'user', template: 'vanilla',
      })
      const devLinkCall = mockWriteFile.mock.calls.find((c: string[]) =>
        c[0] === `/mock-home/.superone/apps/notes-${MOCK_TS_B36}/.s1-dev.json`,
      )
      expect(devLinkCall).toBeDefined()
      const parsed = JSON.parse(devLinkCall![1])
      expect(parsed.distDir).toBe('/Users/me/code/notes')
      expect(parsed.enabled).toBe(true)
    })
  })

  describe('user scope + react', () => {
    it('writes .s1-dev.json with absolute distDir = <directory>/dist', async () => {
      await createMiniApp({
        name: 'Calc', slug: 'calc',
        directory: '/Users/me/code/calc',
        scope: 'user', template: 'react',
      })
      const devLinkCall = mockWriteFile.mock.calls.find((c: string[]) =>
        c[0] === `/mock-home/.superone/apps/calc-${MOCK_TS_B36}/.s1-dev.json`,
      )
      const parsed = JSON.parse(devLinkCall![1])
      expect(parsed.distDir).toBe('/Users/me/code/calc/dist')
    })
  })

  describe('validation', () => {
    it('rejects when directory is not absolute', async () => {
      await expect(
        createMiniApp({
          name: 'T', slug: 't',
          directory: 'relative/path',
          projectDir: '/p', scope: 'project',
        }),
      ).rejects.toThrow(/absolute/)
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('rejects scope=project without projectDir', async () => {
      await expect(
        createMiniApp({
          name: 'T', slug: 't',
          directory: '/abs/path',
          scope: 'project',
        }),
      ).rejects.toThrow(/projectDir/)
    })

    it('rejects scope=project when directory is outside projectDir', async () => {
      await expect(
        createMiniApp({
          name: 'T', slug: 't',
          directory: '/elsewhere/dashboard',
          projectDir: '/projects/p', scope: 'project',
        }),
      ).rejects.toThrow(/inside projectDir|outside/)
    })

    it('does not reject project + react (legacy reject removed)', async () => {
      await expect(
        createMiniApp({
          name: 'D', slug: 'd',
          directory: '/projects/p/packages/d',
          projectDir: '/projects/p', scope: 'project', template: 'react',
        }),
      ).resolves.toBeDefined()
    })
  })

  it('avoids re-running once project+react was previously rejected (sanity)', async () => {
    const result = await createMiniApp({
      name: 'D', slug: 'd',
      directory: '/projects/p/packages/d',
      projectDir: '/projects/p', scope: 'project', template: 'react',
    })
    expect(result.appPath).toBe('/projects/p/packages/d')
    expect(result.entry.id).toBe(`d-${MOCK_TS_B36}`)
  })
})

describe('.superone directory protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks project scope from accessing .superone', async () => {
    setAllowedDirectories('/projects/my-app', 'test-app', [{ path: '/projects/my-app', access: 'read' }])
    mockReadFile.mockResolvedValue('secret')
    await expect(
      handleFsRequest('/projects/my-app', 'test-app', 'readFile', { path: '.superone/apps/other/manifest.json' })
    ).rejects.toThrow('.superone is a protected directory')
  })

  it('blocks user scope from accessing .superone', async () => {
    setAllowedDirectories('/projects/my-app', 'test-app', [{ path: '/mock-home', access: 'read' }])
    mockReadFile.mockResolvedValue('secret')
    await expect(
      handleFsRequest('/projects/my-app', 'test-app', 'readFile', { path: '.superone/apps/other/data/file.txt' })
    ).rejects.toThrow('.superone is a protected directory')
  })

  it('allows app scope data dir within .superone', async () => {
    setAllowedDirectories('/projects/my-app', 'test-app', [{ path: '/projects/my-app/.superone/apps/test-app/data', access: 'readwrite' }])
    mockReadFile.mockResolvedValue('ok')
    const result = await handleFsRequest('/projects/my-app', 'test-app', 'readFile', { path: 'test.txt' })
    expect(result).toBe('ok')
  })
})

describe('fs permissions cross-project isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    clearAllowedDirectories('/proj-A', 'notes-app')
    clearAllowedDirectories('/proj-B', 'notes-app')
  })

  it('reads from project A use /proj-A/notes even after the same mini-app opens in project B', async () => {
    setAllowedDirectories('/proj-A', 'notes-app', [{ path: '/proj-A/notes', access: 'readwrite' }])
    setAllowedDirectories('/proj-B', 'notes-app', [{ path: '/proj-B/notes', access: 'readwrite' }])
    mockReadFile.mockImplementation((path: string) => Promise.resolve(`content-at-${path}`))

    const readA = await handleFsRequest('/proj-A', 'notes-app', 'readFile', { path: 'today.md' })
    expect(readA).toBe('content-at-/proj-A/notes/today.md')

    const readB = await handleFsRequest('/proj-B', 'notes-app', 'readFile', { path: 'today.md' })
    expect(readB).toBe('content-at-/proj-B/notes/today.md')
  })

  it('writes from project A land in /proj-A/notes even after the same mini-app opens in project B', async () => {
    setAllowedDirectories('/proj-A', 'notes-app', [{ path: '/proj-A/notes', access: 'readwrite' }])
    setAllowedDirectories('/proj-B', 'notes-app', [{ path: '/proj-B/notes', access: 'readwrite' }])

    await handleFsRequest('/proj-A', 'notes-app', 'writeFile', { path: 'summary.md', content: 'A' })
    const writeA = mockWriteFile.mock.calls.at(-1)!
    expect(writeA[0]).toBe('/proj-A/notes/summary.md')

    await handleFsRequest('/proj-B', 'notes-app', 'writeFile', { path: 'summary.md', content: 'B' })
    const writeB = mockWriteFile.mock.calls.at(-1)!
    expect(writeB[0]).toBe('/proj-B/notes/summary.md')
  })

  it('rejects fs request for a project that never opened the mini-app', async () => {
    setAllowedDirectories('/proj-A', 'notes-app', [{ path: '/proj-A/notes', access: 'readwrite' }])
    await expect(handleFsRequest('/proj-B', 'notes-app', 'readFile', { path: 'today.md' })).rejects.toThrow(/No allowed directories/)
  })
})

describe('allowedMedia registry', () => {
  beforeEach(() => {
    clearAllowedMedia('app-a')
    clearAllowedMedia('app-b')
  })

  it('records granted kinds and answers isMediaAllowed', () => {
    setAllowedMedia('app-a', ['microphone'])
    expect(isMediaAllowed('app-a', 'microphone')).toBe(true)
    expect(isMediaAllowed('app-a', 'camera')).toBe(false)
  })

  it('isolates apps from each other', () => {
    setAllowedMedia('app-a', ['microphone'])
    setAllowedMedia('app-b', ['camera'])
    expect(isMediaAllowed('app-b', 'microphone')).toBe(false)
    expect(isMediaAllowed('app-b', 'camera')).toBe(true)
    expect(isMediaAllowed('app-a', 'camera')).toBe(false)
  })

  it('replaces previous grants when set again', () => {
    setAllowedMedia('app-a', ['microphone', 'camera'])
    setAllowedMedia('app-a', ['camera'])
    expect(isMediaAllowed('app-a', 'microphone')).toBe(false)
    expect(isMediaAllowed('app-a', 'camera')).toBe(true)
  })

  it('clearAllowedMedia removes all grants for an app', () => {
    setAllowedMedia('app-a', ['microphone', 'camera'])
    clearAllowedMedia('app-a')
    expect(isMediaAllowed('app-a', 'microphone')).toBe(false)
    expect(getAllowedMedia('app-a')).toBeUndefined()
  })

  it('setting an empty array drops the registry entry', () => {
    setAllowedMedia('app-a', ['microphone'])
    setAllowedMedia('app-a', [])
    expect(getAllowedMedia('app-a')).toBeUndefined()
    expect(isMediaAllowed('app-a', 'microphone')).toBe(false)
  })

  it('returns false for unregistered apps', () => {
    expect(isMediaAllowed('ghost', 'microphone')).toBe(false)
  })
})

describe('appIdFromUrl', () => {
  it('extracts appId from a superone-app URL', () => {
    expect(appIdFromUrl('superone-app://hello/index.html')).toBe('hello')
  })

  it('extracts appId regardless of path / query / fragment', () => {
    expect(appIdFromUrl('superone-app://my-app/sub/page.html?_locale=zh#section')).toBe('my-app')
  })

  it('returns null for non-superone protocols', () => {
    expect(appIdFromUrl('https://hello/index.html')).toBeNull()
    expect(appIdFromUrl('file:///etc/passwd')).toBeNull()
    expect(appIdFromUrl('superone-fs://hello/file')).toBeNull()
  })

  it('returns null for malformed URLs', () => {
    expect(appIdFromUrl('not a url')).toBeNull()
    expect(appIdFromUrl('')).toBeNull()
  })

  it('returns null for empty hostname', () => {
    expect(appIdFromUrl('superone-app:///path')).toBeNull()
  })

  it('lowercases hostname (URL spec)', () => {
    expect(appIdFromUrl('superone-app://Hello/x')).toBe('hello')
  })

  it('extracts appId from a project-scoped host (appId.projectUuid)', () => {
    expect(appIdFromUrl('superone-app://hello.f3a1b9c2-1234-5678-9abc-def012345678/index.html')).toBe('hello')
  })

  it('extracts appId from the no-project fallback host', () => {
    expect(appIdFromUrl('superone-app://hello.00000000-0000-0000-0000-000000000000/index.html')).toBe('hello')
  })
})
