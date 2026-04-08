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

import { discoverProjectApps, detectStandaloneApp, createMiniApp, getProjectAppsDir } from './miniapp-service'

function mockManifest(appId: string, name: string) {
  return { appId, name, tools: [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
})

describe('getProjectAppsDir', () => {
  it('returns .superone/apps under project dir', () => {
    expect(getProjectAppsDir('/projects/my-app')).toBe('/projects/my-app/.superone/apps')
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
    expect(result!.basePath).toBe('/projects/my-app')
  })

  it('falls back to dist/manifest.json when root missing', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === '/projects/my-app/dist/manifest.json') return Promise.resolve(JSON.stringify(mockManifest('built-app', 'Built App')))
      return Promise.reject(new Error('not found'))
    })

    const result = await detectStandaloneApp('/projects/my-app')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('built-app')
    expect(result!.basePath).toBe('/projects/my-app/dist')
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
  it('defaults to project mode + vanilla template', async () => {
    const result = await createMiniApp({ name: 'Test App', projectDir: '/projects/test' })

    expect(result.buildRequired).toBe(false)
    expect(result.appPath).toBe('/projects/test/.superone/apps/test-app')
    expect(result.entry.id).toBe('test-app')
  })

  it('slugifies app name for appId', async () => {
    const result = await createMiniApp({ name: 'My Cool App!', projectDir: '/p' })
    expect(result.entry.id).toBe('my-cool-app')
  })

  it('creates minimal manifest without tools or permissions', async () => {
    const result = await createMiniApp({ name: 'Test', projectDir: '/p' })
    expect(result.entry.manifest.tools).toBeUndefined()
    expect(result.entry.manifest.permissions).toBeUndefined()
  })

  it('sets type and description in manifest', async () => {
    const result = await createMiniApp({ name: 'Test', projectDir: '/p', type: 'sidebar', description: 'A test app' })
    expect(result.entry.manifest.type).toBe('sidebar')
    expect(result.entry.manifest.description).toBe('A test app')
  })

  describe('project + vanilla', () => {
    it('writes files to .superone/apps/<appId>/', async () => {
      await createMiniApp({ name: 'Dashboard', projectDir: '/projects/test', mode: 'project', template: 'vanilla' })

      const writtenPaths = mockWriteFile.mock.calls.map((c: string[]) => c[0])
      expect(writtenPaths.some((p: string) => p.includes('.superone/apps/dashboard/manifest.json'))).toBe(true)
      expect(writtenPaths.some((p: string) => p.includes('.superone/apps/dashboard/index.html'))).toBe(true)
    })

    it('returns buildRequired=false', async () => {
      const result = await createMiniApp({ name: 'Test', projectDir: '/p', mode: 'project', template: 'vanilla' })
      expect(result.buildRequired).toBe(false)
    })

    it('returns basePath=appPath', async () => {
      const result = await createMiniApp({ name: 'Test', projectDir: '/p', mode: 'project', template: 'vanilla' })
      expect(result.entry.basePath).toBe(result.appPath)
    })
  })

  describe('project + react', () => {
    it('writes react files to .superone/apps/<appId>/', async () => {
      await createMiniApp({ name: 'Dashboard', projectDir: '/projects/test', mode: 'project', template: 'react' })

      const writtenPaths = mockWriteFile.mock.calls.map((c: string[]) => c[0])
      expect(writtenPaths.some((p: string) => p.includes('.superone/apps/dashboard/package.json'))).toBe(true)
      expect(writtenPaths.some((p: string) => p.includes('.superone/apps/dashboard/src/App.tsx'))).toBe(true)
      expect(writtenPaths.some((p: string) => p.includes('.superone/apps/dashboard/public/manifest.json'))).toBe(true)
    })

    it('returns buildRequired=true', async () => {
      const result = await createMiniApp({ name: 'Test', projectDir: '/p', mode: 'project', template: 'react' })
      expect(result.buildRequired).toBe(true)
    })

    it('returns basePath pointing to dist/', async () => {
      const result = await createMiniApp({ name: 'Test', projectDir: '/p', mode: 'project', template: 'react' })
      expect(result.entry.basePath).toBe(result.appPath + '/dist')
    })
  })

  describe('standalone + vanilla', () => {
    it('writes files to projectDir root', async () => {
      await createMiniApp({ name: 'My App', projectDir: '/projects/my-app', mode: 'standalone', template: 'vanilla' })

      const writtenPaths = mockWriteFile.mock.calls.map((c: string[]) => c[0])
      expect(writtenPaths).toContain('/projects/my-app/manifest.json')
      expect(writtenPaths).toContain('/projects/my-app/index.html')
    })

    it('returns buildRequired=false and basePath=projectDir', async () => {
      const result = await createMiniApp({ name: 'My App', projectDir: '/projects/my-app', mode: 'standalone', template: 'vanilla' })
      expect(result.buildRequired).toBe(false)
      expect(result.entry.basePath).toBe('/projects/my-app')
      expect(result.appPath).toBe('/projects/my-app')
    })
  })

  describe('standalone + react', () => {
    it('writes react files to projectDir root', async () => {
      await createMiniApp({ name: 'My App', projectDir: '/projects/my-app', mode: 'standalone', template: 'react' })

      const writtenPaths = mockWriteFile.mock.calls.map((c: string[]) => c[0])
      expect(writtenPaths.some((p: string) => p.includes('/projects/my-app/package.json'))).toBe(true)
      expect(writtenPaths.some((p: string) => p.includes('/projects/my-app/src/main.tsx'))).toBe(true)
    })

    it('returns buildRequired=true and basePath=projectDir/dist', async () => {
      const result = await createMiniApp({ name: 'My App', projectDir: '/projects/my-app', mode: 'standalone', template: 'react' })
      expect(result.buildRequired).toBe(true)
      expect(result.entry.basePath).toBe('/projects/my-app/dist')
    })
  })

})
