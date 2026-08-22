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

import { discoverProjectApps, detectStandaloneApp, createMiniApp, getProjectAppsDir, resolveAppEntry, setAllowedMedia, isMediaAllowed, clearAllowedMedia, getAllowedMedia, appIdFromUrl, generateCSP } from './miniapp-service'
import type { MiniAppManifest } from '@superone/shared/miniapp-types'

function mockManifest(appId: string, name: string) {
  return { appId, name, main: 'node.js', tools: [] }
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
