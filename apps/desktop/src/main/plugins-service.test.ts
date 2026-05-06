import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  existsSyncMock,
  readdirSyncMock,
  readFileSyncMock,
  writeFileSyncMock,
  statSyncMock,
  mkdirSyncMock,
  cpSyncMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  cpSyncMock: vi.fn(),
}))

const homedirMock = vi.hoisted(() => vi.fn(() => '/home/testuser'))

const { execFileSyncMock, execFileMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  execFileMock: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
  readFileSync: readFileSyncMock,
  writeFileSync: writeFileSyncMock,
  statSync: statSyncMock,
  mkdirSync: mkdirSyncMock,
  cpSync: cpSyncMock,
}))

vi.mock('os', () => ({
  homedir: homedirMock,
}))

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
  execFile: execFileMock,
}))

import { listPlugins, readPluginContent, readPluginFile, deletePlugin } from './plugins-service'

const PLUGINS_DIR = join('/home/testuser', '.claude', 'plugins')
const INSTALLED_FILE = join(PLUGINS_DIR, 'installed_plugins.json')
const MARKETPLACES_FILE = join(PLUGINS_DIR, 'known_marketplaces.json')

function makeInstalledData(plugins: Record<string, Array<{
  scope?: string
  installPath?: string
  version?: string
  projectPath?: string
  installedAt?: string
  gitCommitSha?: string
}>>) {
  return { version: 1, plugins }
}

describe('listPlugins', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns empty array when no installed_plugins.json', () => {
    existsSyncMock.mockReturnValue(false)
    expect(listPlugins('/my-project')).toEqual([])
  })

  it('filters by user scope', () => {
    const installPath = '/cache/my-plugin/1.0'
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({
          'my-plugin@marketplace': [
            { scope: 'user', installPath, version: '1.0' },
          ],
        }))
      }
      if (path === MARKETPLACES_FILE) return JSON.stringify({})
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE || path === MARKETPLACES_FILE) return true
      return false
    })

    const result = listPlugins('/any-project')
    expect(result).toHaveLength(1)
    expect(result[0].scope).toBe('user')
    expect(result[0].name).toBe('my-plugin')
  })

  it('filters by project scope matching cwd', () => {
    const installPath = '/cache/proj-plugin/1.0'
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({
          'proj-plugin@mp': [
            { scope: 'project', installPath, version: '1.0', projectPath: '/my-project' },
            { scope: 'project', installPath, version: '1.0', projectPath: '/other-project' },
          ],
        }))
      }
      if (path === MARKETPLACES_FILE) return JSON.stringify({})
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE || path === MARKETPLACES_FILE) return true
      return false
    })

    const result = listPlugins('/my-project')
    expect(result).toHaveLength(1)
    expect(result[0].scope).toBe('project')
    expect(result[0].name).toBe('proj-plugin')
  })

  it('reads plugin manifest for description/author', () => {
    const installPath = '/cache/fancy/1.0'
    const manifestPath = join(installPath, '.claude-plugin', 'plugin.json')
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({
          'fancy@mp': [{ scope: 'user', installPath, version: '1.0' }],
        }))
      }
      if (path === MARKETPLACES_FILE) return JSON.stringify({})
      if (path === manifestPath) {
        return JSON.stringify({ description: 'A fancy plugin', author: { name: 'Alice' } })
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE || path === MARKETPLACES_FILE || path === manifestPath) return true
      return false
    })

    const result = listPlugins('/proj')
    expect(result[0].description).toBe('A fancy plugin')
    expect(result[0].author).toBe('Alice')
  })

  it('detects plugin contents', () => {
    const installPath = '/cache/full/1.0'
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({
          'full@mp': [{ scope: 'user', installPath, version: '1.0' }],
        }))
      }
      if (path === MARKETPLACES_FILE) return JSON.stringify({})
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE || path === MARKETPLACES_FILE) return true
      if (path === join(installPath, 'commands')) return true
      if (path === join(installPath, 'agents')) return true
      if (path === join(installPath, 'skills')) return false
      if (path === join(installPath, 'hooks')) return true
      if (path === join(installPath, '.mcp.json')) return false
      return false
    })

    const result = listPlugins('/proj')
    expect(result[0].hasCommands).toBe(true)
    expect(result[0].hasAgents).toBe(true)
    expect(result[0].hasSkills).toBe(false)
    expect(result[0].hasHooks).toBe(true)
    expect(result[0].hasMcpServers).toBe(false)
  })

  it('detects version updates', () => {
    const installPath = '/cache/updatable/1.0'
    const mpDir = '/marketplaces/mp1'
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({
          'updatable@mp1': [{ scope: 'user', installPath, version: '1.0' }],
        }))
      }
      if (path === MARKETPLACES_FILE) {
        return JSON.stringify({ mp1: { installLocation: mpDir } })
      }
      if (path === join(mpDir, '.claude-plugin', 'marketplace.json')) {
        return JSON.stringify({ plugins: [{ name: 'updatable', version: '2.0' }] })
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE || path === MARKETPLACES_FILE) return true
      if (path === join(mpDir, '.git')) return true
      if (path === join(mpDir, '.claude-plugin', 'marketplace.json')) return true
      return false
    })

    const result = listPlugins('/proj')
    expect(result[0].hasUpdate).toBe(true)
    expect(result[0].latestVersion).toBe('2.0')
  })

  it('skips entries without installPath', () => {
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({
          'no-path@mp': [{ scope: 'user' }],
        }))
      }
      if (path === MARKETPLACES_FILE) return JSON.stringify({})
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE || path === MARKETPLACES_FILE) return true
      return false
    })

    const result = listPlugins('/proj')
    expect(result).toEqual([])
  })
})

describe('readPluginContent', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns plugin detail with file tree', () => {
    const installPath = '/cache/detail/1.0'
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({
          'detail@mp': [{ scope: 'user', installPath, version: '1.0' }],
        }))
      }
      if (path === MARKETPLACES_FILE) return JSON.stringify({})
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE || path === MARKETPLACES_FILE) return true
      return false
    })
    readdirSyncMock.mockReturnValue([
      { name: 'README.md', isDirectory: () => false, isSymbolicLink: () => false },
    ])

    const result = readPluginContent('/proj', 'detail@mp')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('detail')
    expect(result!.marketplace).toBe('mp')
    expect(result!.files).toBeDefined()
    expect(result!.files).toHaveLength(1)
    expect(result!.files[0].name).toBe('README.md')
  })

  it('returns null for unknown plugin key', () => {
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({}))
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) return true
      return false
    })

    expect(readPluginContent('/proj', 'unknown@mp')).toBeNull()
  })
})

describe('readPluginFile', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns file content for valid path', () => {
    const installPath = '/cache/reader/1.0'
    readFileSyncMock.mockImplementation((path: string, encoding?: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({
          'reader@mp': [{ scope: 'user', installPath, version: '1.0' }],
        }))
      }
      if (path === join(installPath, 'SKILL.md') && encoding === 'utf-8') {
        return '# Skill content'
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) return true
      if (path === join(installPath, 'SKILL.md')) return true
      return false
    })
    statSyncMock.mockReturnValue({ isDirectory: () => false })

    const result = readPluginFile('/proj', 'reader@mp', 'SKILL.md')
    expect(result).toBe('# Skill content')
  })

  it('returns null for path traversal attempt', () => {
    const installPath = '/cache/safe/1.0'
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({
          'safe@mp': [{ scope: 'user', installPath, version: '1.0' }],
        }))
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) return true
      return true
    })

    const result = readPluginFile('/proj', 'safe@mp', '../../etc/passwd')
    expect(result).toBeNull()
  })

  it('returns null for directory path', () => {
    const installPath = '/cache/dirtest/1.0'
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({
          'dirtest@mp': [{ scope: 'user', installPath, version: '1.0' }],
        }))
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) return true
      if (path === join(installPath, 'subdir')) return true
      return false
    })
    statSyncMock.mockReturnValue({ isDirectory: () => true })

    const result = readPluginFile('/proj', 'dirtest@mp', 'subdir')
    expect(result).toBeNull()
  })

  it('returns null for non-existent file', () => {
    const installPath = '/cache/nofile/1.0'
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({
          'nofile@mp': [{ scope: 'user', installPath, version: '1.0' }],
        }))
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) return true
      return false
    })

    const result = readPluginFile('/proj', 'nofile@mp', 'missing.txt')
    expect(result).toBeNull()
  })
})

describe('deletePlugin', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('removes user-scoped entry', () => {
    const data = makeInstalledData({
      'del@mp': [
        { scope: 'user', installPath: '/cache/del/1.0' },
        { scope: 'project', installPath: '/cache/del/1.0', projectPath: '/proj' },
      ],
    })
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) return JSON.stringify(data)
      return '{}'
    })
    existsSyncMock.mockReturnValue(true)

    deletePlugin('del@mp', 'user', '/proj')

    const written = JSON.parse(writeFileSyncMock.mock.calls[0][1])
    expect(written.plugins['del@mp']).toHaveLength(1)
    expect(written.plugins['del@mp'][0].scope).toBe('project')
  })

  it('removes project-scoped entry matching cwd', () => {
    const data = makeInstalledData({
      'del@mp': [
        { scope: 'user', installPath: '/cache/del/1.0' },
        { scope: 'project', installPath: '/cache/del/1.0', projectPath: '/my-proj' },
        { scope: 'project', installPath: '/cache/del/1.0', projectPath: '/other' },
      ],
    })
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) return JSON.stringify(data)
      return '{}'
    })
    existsSyncMock.mockReturnValue(true)

    deletePlugin('del@mp', 'project', '/my-proj')

    const written = JSON.parse(writeFileSyncMock.mock.calls[0][1])
    expect(written.plugins['del@mp']).toHaveLength(2)
    expect(written.plugins['del@mp'].every((e: { projectPath?: string }) => e.projectPath !== '/my-proj')).toBe(true)
  })

  it('deletes entire plugin key when no entries remain', () => {
    const data = makeInstalledData({
      'only@mp': [{ scope: 'user', installPath: '/cache/only/1.0' }],
    })
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) return JSON.stringify(data)
      return '{}'
    })
    existsSyncMock.mockReturnValue(true)

    deletePlugin('only@mp', 'user', '/proj')

    const written = JSON.parse(writeFileSyncMock.mock.calls[0][1])
    expect(written.plugins['only@mp']).toBeUndefined()
  })

  it('no-op for unknown plugin key', () => {
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) return JSON.stringify(makeInstalledData({}))
      return '{}'
    })
    existsSyncMock.mockReturnValue(true)

    deletePlugin('unknown@mp', 'user', '/proj')

    expect(writeFileSyncMock).not.toHaveBeenCalled()
  })
})
