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

import { listPlugins, readPluginContent, readPluginFile, deletePlugin, listMarketplacePlugins, readMarketplacePluginContent } from './plugins-service'

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

  it('drops the CLI "unknown" version sentinel and does not flag a false update', () => {
    const installPath = '/cache/code-review/unknown'
    const mpDir = '/marketplaces/official'
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE) {
        return JSON.stringify(makeInstalledData({
          'code-review@official': [{ scope: 'user', installPath, version: 'unknown' }],
        }))
      }
      if (path === MARKETPLACES_FILE) {
        return JSON.stringify({ official: { installLocation: mpDir } })
      }
      if (path === join(mpDir, '.claude-plugin', 'marketplace.json')) {
        return JSON.stringify({ plugins: [{ name: 'code-review', source: './plugins/code-review' }] })
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === INSTALLED_FILE || path === MARKETPLACES_FILE) return true
      if (path === join(mpDir, '.claude-plugin', 'marketplace.json')) return true
      if (path === join(mpDir, 'plugins', 'code-review')) return true
      if (path === join(mpDir, '.git')) return true
      return false
    })

    const result = listPlugins('/proj')
    expect(result).toHaveLength(1)
    expect(result[0].version).toBeUndefined()
    expect(result[0].hasUpdate).toBe(false)
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

describe('listMarketplacePlugins', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('enumerates skill-only plugins declared in marketplace.json with source "./"', () => {
    const mpDir = '/mp/anthropic-agent-skills'
    const manifestPath = join(mpDir, '.claude-plugin', 'marketplace.json')
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE) {
        return JSON.stringify({
          'anthropic-agent-skills': {
            source: { source: 'github', repo: 'anthropics/skills' },
            installLocation: mpDir,
            lastUpdated: '2026-05-19T00:00:00.000Z',
          },
        })
      }
      if (path === manifestPath) {
        return JSON.stringify({
          name: 'anthropic-agent-skills',
          owner: { name: 'Anthropic' },
          plugins: [
            { name: 'document-skills', source: './', description: 'Docs', skills: ['./skills/docx'] },
            { name: 'example-skills', source: './', description: 'Examples', skills: ['./skills/skill-creator'] },
            { name: 'claude-api', source: './', description: 'API', version: '1.0.0', skills: ['./skills/claude-api'] },
          ],
        })
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE) return true
      if (path === mpDir) return true
      if (path === manifestPath) return true
      return false
    })

    const result = listMarketplacePlugins('/proj')
    expect(result.map(p => p.name).sort()).toEqual(['claude-api', 'document-skills', 'example-skills'])
    const claudeApi = result.find(p => p.name === 'claude-api')!
    expect(claudeApi.key).toBe('claude-api@anthropic-agent-skills')
    expect(claudeApi.marketplace).toBe('anthropic-agent-skills')
    expect(claudeApi.description).toBe('API')
    expect(claudeApi.version).toBe('1.0.0')
    expect(claudeApi.hasSkills).toBe(true)
    expect(claudeApi.marketplaceLastUpdated).toBe('2026-05-19T00:00:00.000Z')
  })

  it('still resolves plugins whose source points to a subdir with its own plugin.json', () => {
    const mpDir = '/mp/classic'
    const manifestPath = join(mpDir, '.claude-plugin', 'marketplace.json')
    const pluginDir = join(mpDir, 'plugins', 'dev-toolkit')
    const pluginManifestPath = join(pluginDir, '.claude-plugin', 'plugin.json')
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE) {
        return JSON.stringify({ classic: { installLocation: mpDir } })
      }
      if (path === manifestPath) {
        return JSON.stringify({
          name: 'classic',
          plugins: [{ name: 'dev-toolkit', source: './plugins/dev-toolkit', description: 'from manifest' }],
        })
      }
      if (path === pluginManifestPath) {
        return JSON.stringify({ description: 'from plugin.json', author: { name: 'Bob' }, version: '2.1' })
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE || path === mpDir || path === manifestPath) return true
      if (path === pluginDir || path === pluginManifestPath) return true
      if (path === join(pluginDir, 'commands')) return true
      return false
    })

    const result = listMarketplacePlugins('/proj')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('dev-toolkit')
    expect(result[0].author).toBe('Bob')
    expect(result[0].version).toBe('2.1')
    expect(result[0].hasCommands).toBe(true)
  })

  it('labels an unsettled directory-source marketplace as local, not official', () => {
    const mpDir = '/Users/me/Dev/my-mp'
    const manifestPath = join(mpDir, '.claude-plugin', 'marketplace.json')
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE) {
        return JSON.stringify({
          'my-mp': {
            source: { source: 'directory', path: mpDir },
            installLocation: mpDir,
          },
          'claude-plugins-official': {
            source: { source: 'github', repo: 'anthropics/claude-plugins-official' },
            installLocation: '/mp/official',
          },
        })
      }
      if (path === manifestPath) {
        return JSON.stringify({ name: 'my-mp', plugins: [{ name: 'p1', source: './', description: 'd' }] })
      }
      if (path === join('/mp/official', '.claude-plugin', 'marketplace.json')) {
        return JSON.stringify({ name: 'official', plugins: [{ name: 'op', source: './', description: 'o' }] })
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE) return true
      if (path === mpDir || path === manifestPath) return true
      if (path === '/mp/official' || path === join('/mp/official', '.claude-plugin', 'marketplace.json')) return true
      return false
    })

    const result = listMarketplacePlugins('/proj')
    expect(result.find(p => p.marketplace === 'my-mp')!.marketplaceScope).toBe('local')
    expect(result.find(p => p.marketplace === 'claude-plugins-official')!.marketplaceScope).toBe('official')
  })

  it('keeps the settings-declared scope over the directory-source fallback', () => {
    const mpDir = '/Users/me/Dev/declared-mp'
    const manifestPath = join(mpDir, '.claude-plugin', 'marketplace.json')
    const userSettings = join('/home/testuser', '.claude', 'settings.json')
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE) {
        return JSON.stringify({
          'declared-mp': { source: { source: 'directory', path: mpDir }, installLocation: mpDir },
        })
      }
      if (path === userSettings) {
        return JSON.stringify({ extraKnownMarketplaces: { 'declared-mp': { source: { source: 'directory', path: mpDir } } } })
      }
      if (path === manifestPath) {
        return JSON.stringify({ name: 'declared-mp', plugins: [{ name: 'p1', source: './', description: 'd' }] })
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE || path === userSettings) return true
      if (path === mpDir || path === manifestPath) return true
      return false
    })

    const result = listMarketplacePlugins('/proj')
    expect(result.find(p => p.marketplace === 'declared-mp')!.marketplaceScope).toBe('user')
  })

  it('falls back to directory scan when marketplace.json is absent', () => {
    const mpDir = '/mp/legacy'
    const pluginDir = join(mpDir, 'plugins', 'legacy-plugin')
    const pluginManifestPath = join(pluginDir, '.claude-plugin', 'plugin.json')
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE) {
        return JSON.stringify({ legacy: { installLocation: mpDir } })
      }
      if (path === pluginManifestPath) {
        return JSON.stringify({ description: 'legacy', version: '0.1' })
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE || path === mpDir) return true
      if (path === join(mpDir, 'plugins')) return true
      if (path === pluginManifestPath) return true
      return false
    })
    readdirSyncMock.mockImplementation((path: string) => {
      if (path === join(mpDir, 'plugins')) {
        return [{ name: 'legacy-plugin', isDirectory: () => true, isSymbolicLink: () => false }]
      }
      return []
    })

    const result = listMarketplacePlugins('/proj')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('legacy-plugin')
    expect(result[0].description).toBe('legacy')
  })
})

describe('readMarketplacePluginContent', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns detail for a skill-only plugin (source "./", no own plugin.json)', () => {
    const mpDir = '/mp/anthropic-agent-skills'
    const manifestPath = join(mpDir, '.claude-plugin', 'marketplace.json')
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE) {
        return JSON.stringify({
          'anthropic-agent-skills': {
            source: { source: 'github', repo: 'anthropics/skills' },
            installLocation: mpDir,
            lastUpdated: '2026-05-19T00:00:00.000Z',
          },
        })
      }
      if (path === manifestPath) {
        return JSON.stringify({
          name: 'anthropic-agent-skills',
          plugins: [
            { name: 'claude-api', source: './', description: 'API skill', version: '1.0.0', skills: ['./skills/claude-api'] },
          ],
        })
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE || path === mpDir || path === manifestPath) return true
      return false
    })
    readdirSyncMock.mockReturnValue([])

    const result = readMarketplacePluginContent('anthropic-agent-skills', 'claude-api')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('claude-api')
    expect(result!.key).toBe('claude-api@anthropic-agent-skills')
    expect(result!.description).toBe('API skill')
    expect(result!.version).toBe('1.0.0')
    expect(result!.hasSkills).toBe(true)
    expect(result!.sourcePath).toBe(mpDir)
    expect(result!.marketplaceSource).toBe('anthropics/skills')
  })

  it('returns null when neither plugin.json nor marketplace.json entry exists', () => {
    const mpDir = '/mp/empty'
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE) {
        return JSON.stringify({ empty: { installLocation: mpDir } })
      }
      return '{}'
    })
    existsSyncMock.mockImplementation((path: string) => {
      if (path === MARKETPLACES_FILE || path === mpDir) return true
      return false
    })

    expect(readMarketplacePluginContent('empty', 'ghost')).toBeNull()
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
