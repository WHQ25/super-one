import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/mock/userData' } }))
vi.mock('fs')

import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { McpLibraryEntry, McpServerConfig, McpServerMeta } from '../shared/agent-types'
import { backupMcpServers, deleteLibraryEntry, listLibrary } from './mcp-library-service'

const mockExistsSync = vi.mocked(existsSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockWriteFileSync = vi.mocked(writeFileSync)

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'test-server',
    type: 'stdio',
    scope: 'project',
    command: 'node',
    args: ['server.js'],
    ...overrides,
  }
}

function makeMeta(overrides: Partial<McpServerMeta> = {}): McpServerMeta {
  return {
    name: 'test-server',
    description: 'A test server',
    icons: [{ url: 'https://example.com/icon.png' }],
    ...overrides,
  }
}

function makeEntry(overrides: Partial<McpLibraryEntry> = {}): McpLibraryEntry {
  return {
    name: 'test-server',
    type: 'stdio',
    command: 'node',
    args: ['server.js'],
    description: 'A test server',
    icons: [{ url: 'https://example.com/icon.png' }],
    savedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function stubLibrary(data: Record<string, McpLibraryEntry>): void {
  mockExistsSync.mockReturnValue(true)
  mockReadFileSync.mockReturnValue(JSON.stringify(data))
}

function stubEmpty(): void {
  mockExistsSync.mockReturnValue(false)
}

function getWrittenData(): Record<string, McpLibraryEntry> {
  return JSON.parse(mockWriteFileSync.mock.calls[0][1] as string)
}

beforeEach(() => {
  vi.clearAllMocks()
  stubEmpty()
})

describe('backupMcpServers', () => {
  it('should create a new entry for a valid config with meta', () => {
    backupMcpServers([makeConfig()], { 'test-server': makeMeta() })

    expect(mockWriteFileSync).toHaveBeenCalledOnce()
    const written = getWrittenData()
    expect(written['test-server']).toMatchObject({
      name: 'test-server',
      type: 'stdio',
      command: 'node',
      description: 'A test server',
    })
    expect(written['test-server'].savedAt).toBeDefined()
  })

  it('should preserve existing icons when merging', () => {
    const existingIcons = [{ url: 'https://example.com/old-icon.png' }]
    stubLibrary({ 'test-server': makeEntry({ icons: existingIcons }) })

    backupMcpServers([makeConfig()], {
      'test-server': makeMeta({ icons: [{ url: 'https://example.com/new-icon.png' }] }),
    })

    expect(getWrittenData()['test-server'].icons).toEqual(existingIcons)
  })

  it('should use meta icons when no existing entry', () => {
    const metaIcons = [{ url: 'https://example.com/meta-icon.png' }]

    backupMcpServers([makeConfig()], { 'test-server': makeMeta({ icons: metaIcons }) })

    expect(getWrittenData()['test-server'].icons).toEqual(metaIcons)
  })

  it('should preserve existing savedAt timestamp', () => {
    stubLibrary({ 'test-server': makeEntry({ savedAt: '2025-06-01T00:00:00.000Z' }) })

    backupMcpServers([makeConfig()], { 'test-server': makeMeta() })

    expect(getWrittenData()['test-server'].savedAt).toBe('2025-06-01T00:00:00.000Z')
  })

  it('should skip disabled server configs', () => {
    backupMcpServers([makeConfig({ disabled: true })], { 'test-server': makeMeta() })

    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('should skip configs without meta information', () => {
    backupMcpServers([makeConfig()], {})

    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('should not write when configs array is empty', () => {
    backupMcpServers([], {})

    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('should backup multiple servers in one call', () => {
    const configs = [makeConfig({ name: 'server-a' }), makeConfig({ name: 'server-b' })]
    const meta: Record<string, McpServerMeta> = {
      'server-a': makeMeta({ name: 'server-a' }),
      'server-b': makeMeta({ name: 'server-b' }),
    }

    backupMcpServers(configs, meta)

    expect(Object.keys(getWrittenData())).toEqual(['server-a', 'server-b'])
  })

  it('should write to correct path when library does not exist', () => {
    backupMcpServers([makeConfig()], { 'test-server': makeMeta() })

    expect(mockWriteFileSync.mock.calls[0][0]).toBe('/mock/userData/mcp-library.json')
  })

  it('should include http-specific fields', () => {
    const config = makeConfig({
      name: 'http-server',
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
    })

    backupMcpServers([config], { 'http-server': makeMeta({ name: 'http-server' }) })

    const entry = getWrittenData()['http-server']
    expect(entry.url).toBe('https://example.com/mcp')
    expect(entry.headers).toEqual({ Authorization: 'Bearer token' })
  })
})

describe('listLibrary', () => {
  it('should return sorted entries by name', () => {
    stubLibrary({
      'zeta-server': makeEntry({ name: 'zeta-server' }),
      'alpha-server': makeEntry({ name: 'alpha-server' }),
      'middle-server': makeEntry({ name: 'middle-server' }),
    })

    const result = listLibrary()

    expect(result.map((e) => e.name)).toEqual(['alpha-server', 'middle-server', 'zeta-server'])
  })

  it('should return empty array when file does not exist', () => {
    stubEmpty()

    expect(listLibrary()).toEqual([])
  })

  it('should return empty array for empty library', () => {
    stubLibrary({})

    expect(listLibrary()).toEqual([])
  })

  it('should return empty array for corrupt JSON', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('not valid json{{{')

    expect(listLibrary()).toEqual([])
  })
})

describe('deleteLibraryEntry', () => {
  it('should delete an existing entry', () => {
    stubLibrary({
      'server-a': makeEntry({ name: 'server-a' }),
      'server-b': makeEntry({ name: 'server-b' }),
    })

    deleteLibraryEntry('server-a')

    const written = getWrittenData()
    expect(written['server-a']).toBeUndefined()
    expect(written['server-b']).toBeDefined()
  })

  it('should write file even for non-existing entry', () => {
    stubLibrary({ 'server-a': makeEntry({ name: 'server-a' }) })

    deleteLibraryEntry('non-existing')

    expect(mockWriteFileSync).toHaveBeenCalledOnce()
    expect(getWrittenData()['server-a']).toBeDefined()
  })

  it('should write to correct path', () => {
    stubLibrary({})

    deleteLibraryEntry('anything')

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/mock/userData/mcp-library.json',
      expect.any(String),
    )
  })
})
