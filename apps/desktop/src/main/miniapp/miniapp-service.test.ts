import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReaddir = vi.fn()
const mockWriteFile = vi.fn()
const mockMkdir = vi.fn()
const mockReadFile = vi.fn()
const mockStat = vi.fn()
const mockRename = vi.fn()
const mockRmdir = vi.fn()
const mockRm = vi.fn()
const mockGlob = vi.fn()

vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  rmdir: (...args: unknown[]) => mockRmdir(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  glob: (...args: unknown[]) => mockGlob(...args),
  watch: vi.fn(),
}))
vi.mock('fs', () => ({ watch: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/mock-home' } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../git-run', () => ({ gitRun: vi.fn() }))
vi.mock('../path-security', () => ({ sanitizeGitRef: vi.fn((s: string) => s) }))
vi.mock('../git-status-utils', () => ({ parseGitStatusFiles: vi.fn(() => []) }))

const mockDevRegistryLookup = vi.fn()
const mockDevRegistryUpsert = vi.fn()
const mockDevRegistryList = vi.fn().mockResolvedValue([])
const mockDevRegistryRemove = vi.fn()
const mockDevRegistrySourceExists = vi.fn().mockResolvedValue(true)
vi.mock('./dev-registry', () => ({
  lookupByAppId: (...args: unknown[]) => mockDevRegistryLookup(...args),
  upsertEntry: (...args: unknown[]) => mockDevRegistryUpsert(...args),
  listEntries: (...args: unknown[]) => mockDevRegistryList(...args),
  removeEntry: (...args: unknown[]) => mockDevRegistryRemove(...args),
  sourceDirExists: (...args: unknown[]) => mockDevRegistrySourceExists(...args),
  touchLastSeen: vi.fn(),
}))

import { discoverProjectApps, detectStandaloneApp, createMiniApp, getProjectAppsDir, setAllowedDirectories, clearAllowedDirectories, handleFsRequest, resolveAppEntry, setAllowedMedia, isMediaAllowed, clearAllowedMedia, getAllowedMedia, appIdFromUrl, generateCSP } from './miniapp-service'
import type { MiniAppManifest } from '@superone/shared/miniapp-types'

function mockManifest(appId: string, name: string) {
  return { appId, name, tools: [] }
}

async function* asyncIter(...items: string[]) {
  for (const i of items) yield i
}

const MOCK_TS = 1700000000000
const MOCK_TS_B36 = MOCK_TS.toString(36)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(MOCK_TS)
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
  mockRename.mockResolvedValue(undefined)
  mockRmdir.mockResolvedValue(undefined)
  mockRm.mockResolvedValue(undefined)
  mockDevRegistryLookup.mockResolvedValue(undefined)
  mockDevRegistryUpsert.mockImplementation(async (input: { appId: string; sourceDir: string; distDir: string; name: string }) => ({
    ...input, registeredAt: MOCK_TS, lastSeenAt: MOCK_TS,
  }))
  mockDevRegistryList.mockResolvedValue([])
  mockDevRegistrySourceExists.mockResolvedValue(true)
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

  it('reads manifest from installDir when no .s1-dev.json (prod install)', async () => {
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

  it('resolves dev pointer by looking up appId (basename) in registry', async () => {
    mockDevRegistryLookup.mockResolvedValue({
      appId: 'foo', sourceDir: '/src/foo', distDir: '/src/foo/dist',
      name: 'Foo', registeredAt: 0, lastSeenAt: 0,
    })
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({ enabled: true }))
      if (path === '/src/foo/dist/manifest.json')
        return Promise.resolve(JSON.stringify(mockManifest('foo', 'Foo')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result).not.toBeNull()
    expect(result!.id).toBe('foo')
    expect(result!.installDir).toBe(installDir)
    expect(result!.distDir).toBe('/src/foo/dist')
    expect(mockDevRegistryLookup).toHaveBeenCalledWith('foo')
  })

  it('returns orphan entry when dev pointer has no matching registry entry', async () => {
    mockDevRegistryLookup.mockResolvedValue(undefined)
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({ enabled: true }))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result).not.toBeNull()
    expect(result!.orphan).toBe(true)
    expect(result!.id).toBe('foo')
    expect(result!.distDir).toBeUndefined()
  })

  it('returns orphan when registry exists but distDir manifest missing', async () => {
    mockDevRegistryLookup.mockResolvedValue({
      appId: 'foo', sourceDir: '/src/foo', distDir: '/src/foo/dist',
      name: 'Foo (stale)', registeredAt: 0, lastSeenAt: 0,
    })
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({ enabled: true }))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result!.orphan).toBe(true)
    expect(result!.manifest.name).toBe('Foo (stale)')
  })

  it('falls back to prod manifest when dev pointer is disabled', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({ enabled: false }))
      if (path === `${installDir}/manifest.json`)
        return Promise.resolve(JSON.stringify(mockManifest('foo', 'Foo (prod)')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result).not.toBeNull()
    expect(result!.manifest.name).toBe('Foo (prod)')
    expect(result!.distDir).toBeUndefined()
    expect(mockDevRegistryLookup).not.toHaveBeenCalled()
  })

  it('treats enabled omitted as true (default)', async () => {
    mockDevRegistryLookup.mockResolvedValue({
      appId: 'foo', sourceDir: '/src/foo', distDir: '/src/foo/dist',
      name: 'Foo dev', registeredAt: 0, lastSeenAt: 0,
    })
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({}))
      if (path === '/src/foo/dist/manifest.json')
        return Promise.resolve(JSON.stringify(mockManifest('foo', 'Foo dev')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result!.distDir).toBe('/src/foo/dist')
    expect(result!.manifest.name).toBe('Foo dev')
  })

  it('returns null when devlink JSON is invalid and no prod manifest exists', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`) return Promise.resolve('{not valid json')
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await resolveAppEntry(installDir, { projectDir: '/projects/test' })
    expect(result).toBeNull()
  })

  it('rejects extra unknown fields in .s1-dev.json via strict schema (forces prod fallback)', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === `${installDir}/.s1-dev.json`)
        return Promise.resolve(JSON.stringify({ enabled: true, distDir: 'legacy/path' }))
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

  it('mixes dev-linked apps (via .s1-dev.json + registry) with prod apps in same scope', async () => {
    mockReaddir.mockResolvedValue(['vanilla-prod', 'react-dev'])
    mockDevRegistryLookup.mockImplementation(async (appId: string) =>
      appId === 'react-dev'
        ? { appId, sourceDir: '/src/react-dev', distDir: '/src/react-dev/dist', name: 'React', registeredAt: 0, lastSeenAt: 0 }
        : undefined,
    )
    mockReadFile.mockImplementation((path: string) => {
      // prod vanilla: manifest at installDir
      if (path === '/projects/p/.superone/apps/vanilla-prod/manifest.json')
        return Promise.resolve(JSON.stringify(mockManifest('vanilla-prod', 'Prod')))
      if (path === '/projects/p/.superone/apps/vanilla-prod/.s1-dev.json')
        return Promise.reject(new Error('ENOENT'))
      // dev-linked react: .s1-dev.json + manifest read from registry distDir
      if (path === '/projects/p/.superone/apps/react-dev/.s1-dev.json')
        return Promise.resolve(JSON.stringify({ enabled: true }))
      if (path === '/src/react-dev/dist/manifest.json')
        return Promise.resolve(JSON.stringify(mockManifest('react-dev', 'React')))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await discoverProjectApps('/projects/p')
    expect(result).toHaveLength(2)
    const prod = result.find((e) => e.id === 'vanilla-prod')!
    const dev = result.find((e) => e.id === 'react-dev')!
    expect(prod.installDir).toBe('/projects/p/.superone/apps/vanilla-prod')
    expect(prod.distDir).toBeUndefined()
    expect(dev.installDir).toBe('/projects/p/.superone/apps/react-dev')
    expect(dev.distDir).toBe('/src/react-dev/dist')
  })

  it('marks dev pointer as orphan when registry has no entry for its appId', async () => {
    mockReaddir.mockResolvedValue(['unknown-dev'])
    mockDevRegistryLookup.mockResolvedValue(undefined)
    mockReadFile.mockImplementation((path: string) => {
      if (path === '/projects/p/.superone/apps/unknown-dev/.s1-dev.json')
        return Promise.resolve(JSON.stringify({ enabled: true }))
      return Promise.reject(new Error('ENOENT'))
    })
    const result = await discoverProjectApps('/projects/p')
    expect(result).toHaveLength(1)
    expect(result[0].orphan).toBe(true)
    expect(result[0].id).toBe('unknown-dev')
  })

  it('falls back to prod manifest when dev link disabled, even with both files present (dev/prod coexist)', async () => {
    mockReaddir.mockResolvedValue(['both'])
    mockReadFile.mockImplementation((path: string) => {
      if (path === '/projects/p/.superone/apps/both/.s1-dev.json')
        return Promise.resolve(JSON.stringify({ enabled: false }))
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

  it('sets description in manifest', async () => {
    const result = await createMiniApp({
      name: 'Test', slug: 'test',
      directory: '/projects/p/packages/test',
      projectDir: '/projects/p', scope: 'project',
      description: 'A test app',
    })
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

    it('writes .s1-dev.json (enabled only) to <projectDir>/.superone/apps/<appId>/ and registers absolute distDir in registry', async () => {
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
      expect(parsed).toEqual({ enabled: true })
      expect(mockDevRegistryUpsert).toHaveBeenCalledWith({
        appId: `dashboard-${MOCK_TS_B36}`,
        sourceDir: '/projects/test/tools/dashboard',
        distDir: '/projects/test/tools/dashboard',
        name: 'Dashboard',
      })
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

    it('registers distDir = <directory>/dist for react template', async () => {
      await createMiniApp({
        name: 'Dashboard', slug: 'dashboard',
        directory: '/projects/test/packages/dashboard',
        projectDir: '/projects/test', scope: 'project', template: 'react',
      })
      const devLinkCall = mockWriteFile.mock.calls.find((c: string[]) =>
        c[0] === `/projects/test/.superone/apps/dashboard-${MOCK_TS_B36}/.s1-dev.json`,
      )
      expect(devLinkCall).toBeDefined()
      expect(JSON.parse(devLinkCall![1])).toEqual({ enabled: true })
      expect(mockDevRegistryUpsert).toHaveBeenCalledWith(expect.objectContaining({
        appId: `dashboard-${MOCK_TS_B36}`,
        sourceDir: '/projects/test/packages/dashboard',
        distDir: '/projects/test/packages/dashboard/dist',
      }))
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

    it('writes .s1-dev.json to ~/.superone/apps/<appId>/ and registers absolute distDir', async () => {
      await createMiniApp({
        name: 'Notes', slug: 'notes',
        directory: '/Users/me/code/notes',
        scope: 'user', template: 'vanilla',
      })
      const devLinkCall = mockWriteFile.mock.calls.find((c: string[]) =>
        c[0] === `/mock-home/.superone/apps/notes-${MOCK_TS_B36}/.s1-dev.json`,
      )
      expect(devLinkCall).toBeDefined()
      expect(JSON.parse(devLinkCall![1])).toEqual({ enabled: true })
      expect(mockDevRegistryUpsert).toHaveBeenCalledWith(expect.objectContaining({
        sourceDir: '/Users/me/code/notes',
        distDir: '/Users/me/code/notes',
      }))
    })
  })

  describe('user scope + react', () => {
    it('registers absolute distDir = <directory>/dist', async () => {
      await createMiniApp({
        name: 'Calc', slug: 'calc',
        directory: '/Users/me/code/calc',
        scope: 'user', template: 'react',
      })
      expect(mockDevRegistryUpsert).toHaveBeenCalledWith(expect.objectContaining({
        sourceDir: '/Users/me/code/calc',
        distDir: '/Users/me/code/calc/dist',
      }))
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

describe('fs permission resolver with overlapping (parent + child) scopes', () => {
  const PROJ = '/projects/aigc'
  const overlapping = [
    { path: PROJ, access: 'read' as const, root: PROJ },
    { path: `${PROJ}/asset`, access: 'readwrite' as const, root: PROJ },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
    clearAllowedDirectories(PROJ, 'aigc')
  })

  for (const order of ['parent-first', 'child-first'] as const) {
    describe(`declared ${order}`, () => {
      beforeEach(() => {
        const dirs = order === 'parent-first' ? overlapping : [...overlapping].reverse()
        setAllowedDirectories(PROJ, 'aigc', dirs)
      })

      it('writes asset/images/x into the readwrite asset scope', async () => {
        await handleFsRequest(PROJ, 'aigc', 'writeFile', { path: 'asset/images/abc.jpg', content: 'x' })
        expect(mockWriteFile.mock.calls.at(-1)![0]).toBe(`${PROJ}/asset/images/abc.jpg`)
      })

      it('reads asset/images/x from the same single interpretation', async () => {
        mockReadFile.mockResolvedValue('img')
        await handleFsRequest(PROJ, 'aigc', 'readFile', { path: 'asset/images/abc.jpg' })
        expect(mockReadFile.mock.calls.at(-1)![0]).toBe(`${PROJ}/asset/images/abc.jpg`)
      })

      it('reads a file covered only by the read scope', async () => {
        mockReadFile.mockResolvedValue('# readme')
        const result = await handleFsRequest(PROJ, 'aigc', 'readFile', { path: 'README.md' })
        expect(result).toBe('# readme')
        expect(mockReadFile.mock.calls.at(-1)![0]).toBe(`${PROJ}/README.md`)
      })

      it('denies writing a file covered only by the read scope', async () => {
        await expect(
          handleFsRequest(PROJ, 'aigc', 'writeFile', { path: 'README.md', content: 'x' }),
        ).rejects.toThrow(/read-only permission/)
        expect(mockWriteFile).not.toHaveBeenCalled()
      })
    })
  }

  it('still blocks .superone traversal under overlapping scopes', async () => {
    setAllowedDirectories(PROJ, 'aigc', overlapping)
    await expect(
      handleFsRequest(PROJ, 'aigc', 'readFile', { path: '.superone/apps/other/manifest.json' }),
    ).rejects.toThrow('.superone is a protected directory')
  })

  it('throws for a ../ escape outside all scopes', async () => {
    setAllowedDirectories(PROJ, 'aigc', overlapping)
    await expect(
      handleFsRequest(PROJ, 'aigc', 'readFile', { path: '../secret.txt' }),
    ).rejects.toThrow(/not within allowed directories/)
  })
})

describe('fs permission resolver with a single (legacy) scope', () => {
  const PROJ = '/projects/notes'
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
    clearAllowedDirectories(PROJ, 'notes')
  })

  it('treats the lone scope as the base for relative paths', async () => {
    setAllowedDirectories(PROJ, 'notes', [{ path: `${PROJ}/asset`, access: 'readwrite', root: PROJ }])
    await handleFsRequest(PROJ, 'notes', 'writeFile', { path: 'images/abc.jpg', content: 'x' })
    expect(mockWriteFile.mock.calls.at(-1)![0]).toBe(`${PROJ}/asset/images/abc.jpg`)
  })
})

describe('fs permission resolver across multiple roots (project + app + user)', () => {
  const PROJ = '/projects/aigc'
  // Dev-install data dir is *longer* than the project dir, so the old length tiebreak
  // would wrongly favour it for bare paths — this is the latent bug under guard.
  const DATA = `${PROJ}/.superone/apps/aigc/data`
  const USER = '/mock-home/.config/aigc'
  const dirs = [
    { path: PROJ, access: 'read' as const, root: PROJ, scope: 'project' as const },
    { path: `${PROJ}/asset`, access: 'readwrite' as const, root: PROJ, scope: 'project' as const },
    { path: DATA, access: 'readwrite' as const, root: DATA, scope: 'app' as const },
    { path: USER, access: 'readwrite' as const, root: '/mock-home', scope: 'user' as const },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
    clearAllowedDirectories(PROJ, 'aigc')
    setAllowedDirectories(PROJ, 'aigc', dirs)
  })

  it('routes a bare write to the project root, not the longer app-data root', async () => {
    await handleFsRequest(PROJ, 'aigc', 'writeFile', { path: 'asset/images/x.png', content: 'x' })
    expect(mockWriteFile.mock.calls.at(-1)![0]).toBe(`${PROJ}/asset/images/x.png`)
  })

  it('routes a bare read to the project root, not the app-data root', async () => {
    mockReadFile.mockResolvedValue('img')
    await handleFsRequest(PROJ, 'aigc', 'readFile', { path: 'asset/images/x.png' })
    expect(mockReadFile.mock.calls.at(-1)![0]).toBe(`${PROJ}/asset/images/x.png`)
  })

  it('denies a bare write to a project read-only path instead of leaking into app data', async () => {
    await expect(
      handleFsRequest(PROJ, 'aigc', 'writeFile', { path: 'README.md', content: 'x' }),
    ).rejects.toThrow(/read-only permission/)
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('routes an explicit @app/ path to the app data dir', async () => {
    await handleFsRequest(PROJ, 'aigc', 'writeFile', { path: '@app/state.json', content: 'x' })
    expect(mockWriteFile.mock.calls.at(-1)![0]).toBe(`${DATA}/state.json`)
  })

  it('routes an explicit @project/ path to the project root', async () => {
    await handleFsRequest(PROJ, 'aigc', 'writeFile', { path: '@project/asset/y.png', content: 'x' })
    expect(mockWriteFile.mock.calls.at(-1)![0]).toBe(`${PROJ}/asset/y.png`)
  })

  it('routes an explicit @user/ path to the user (home) root', async () => {
    await handleFsRequest(PROJ, 'aigc', 'writeFile', { path: '@user/.config/aigc/prefs.json', content: 'x' })
    expect(mockWriteFile.mock.calls.at(-1)![0]).toBe(`${USER}/prefs.json`)
  })

  it('rejects an explicit @app/ path that escapes the app data dir', async () => {
    await expect(
      handleFsRequest(PROJ, 'aigc', 'writeFile', { path: '@app/../escape.json', content: 'x' }),
    ).rejects.toThrow(/not within allowed directories/)
  })

  it('rejects an @app/ prefix when no app scope is declared', async () => {
    clearAllowedDirectories(PROJ, 'aigc')
    setAllowedDirectories(PROJ, 'aigc', [{ path: PROJ, access: 'readwrite', root: PROJ, scope: 'project' }])
    await expect(
      handleFsRequest(PROJ, 'aigc', 'writeFile', { path: '@app/state.json', content: 'x' }),
    ).rejects.toThrow(/@app/)
  })

  it('globs only the project group for a bare pattern, not app-data or user roots', async () => {
    mockGlob.mockImplementation(() => asyncIter('x.json'))
    await handleFsRequest(PROJ, 'aigc', 'glob', { pattern: '**/*.json' })
    const cwds = mockGlob.mock.calls.map((c) => (c[1] as { cwd: string }).cwd)
    expect(cwds).toEqual([PROJ, `${PROJ}/asset`])
    expect(cwds).not.toContain(DATA)
    expect(cwds).not.toContain(USER)
  })

  it('globs the app data dir for an explicit @app/ pattern', async () => {
    mockGlob.mockImplementation(() => asyncIter('state.json'))
    await handleFsRequest(PROJ, 'aigc', 'glob', { pattern: '@app/*.json' })
    const cwds = mockGlob.mock.calls.map((c) => (c[1] as { cwd: string }).cwd)
    expect(cwds).toEqual([DATA])
  })
})

describe('fs permission resolver with multiple non-project roots', () => {
  const PROJ = '/projects/noproj'
  const DATA = `${PROJ}/.superone/apps/noproj/data`
  const USER = '/mock-home/.config/noproj'
  const dirs = [
    { path: DATA, access: 'readwrite' as const, root: DATA, scope: 'app' as const },
    { path: USER, access: 'readwrite' as const, root: '/mock-home', scope: 'user' as const },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
    mockMkdir.mockResolvedValue(undefined)
    clearAllowedDirectories(PROJ, 'noproj')
    setAllowedDirectories(PROJ, 'noproj', dirs)
  })

  it('rejects a bare path as ambiguous across distinct roots', async () => {
    await expect(
      handleFsRequest(PROJ, 'noproj', 'writeFile', { path: 'state.json', content: 'x' }),
    ).rejects.toThrow(/scope prefix|ambiguous/i)
  })

  it('still resolves explicit @app/ and @user/ paths', async () => {
    await handleFsRequest(PROJ, 'noproj', 'writeFile', { path: '@app/state.json', content: 'x' })
    expect(mockWriteFile.mock.calls.at(-1)![0]).toBe(`${DATA}/state.json`)
    await handleFsRequest(PROJ, 'noproj', 'writeFile', { path: '@user/.config/noproj/p.json', content: 'x' })
    expect(mockWriteFile.mock.calls.at(-1)![0]).toBe(`${USER}/p.json`)
  })

  it('rejects a bare glob pattern as ambiguous across distinct roots', async () => {
    mockGlob.mockImplementation(() => asyncIter())
    await expect(
      handleFsRequest(PROJ, 'noproj', 'glob', { pattern: '**/*.json' }),
    ).rejects.toThrow(/scope prefix|ambiguous/i)
    expect(mockGlob).not.toHaveBeenCalled()
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

describe('generateCSP', () => {
  const manifest = (network?: Array<{ domain: string; reason: string }>): MiniAppManifest =>
    ({ appId: 'x', name: 'X', permissions: network ? { network } : undefined }) as MiniAppManifest

  const parse = (csp: string): Record<string, string[]> =>
    Object.fromEntries(
      csp
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const [name, ...vals] = p.split(/\s+/)
          return [name, vals]
        }),
    )

  it("keeps default-src 'none' as the fallback", () => {
    expect(parse(generateCSP(manifest()))['default-src']).toEqual(["'none'"])
  })

  it("always emits a frame-src directive (so framing never falls back to default-src 'none')", () => {
    const csp = generateCSP(manifest())
    expect(csp).toContain('frame-src')
    expect(parse(csp)['frame-src']).toEqual(["'self'"])
  })

  it('allows framing declared network domains, prefixing bare domains with https://', () => {
    const frameSrc = parse(generateCSP(manifest([{ domain: 'embed.diagrams.net', reason: 'r' }])))['frame-src']
    expect(frameSrc).toEqual(["'self'", 'https://embed.diagrams.net'])
  })

  it('preserves an explicit scheme in a declared domain', () => {
    const frameSrc = parse(generateCSP(manifest([{ domain: 'http://localhost:3000', reason: 'r' }])))['frame-src']
    expect(frameSrc).toEqual(["'self'", 'http://localhost:3000'])
  })

  it('includes every declared domain in frame-src', () => {
    const frameSrc = parse(
      generateCSP(manifest([
        { domain: 'a.example.com', reason: 'r' },
        { domain: 'b.example.com', reason: 'r' },
      ])),
    )['frame-src']
    expect(frameSrc).toEqual(["'self'", 'https://a.example.com', 'https://b.example.com'])
  })

  it('keeps frame-src domains consistent with script-src and connect-src', () => {
    const csp = parse(generateCSP(manifest([{ domain: 'embed.diagrams.net', reason: 'r' }])))
    expect(csp['frame-src']).toContain('https://embed.diagrams.net')
    expect(csp['script-src']).toContain('https://embed.diagrams.net')
    expect(csp['connect-src']).toContain('https://embed.diagrams.net')
  })
})
