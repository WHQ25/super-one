import { join } from 'path'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn<(p: string) => boolean>(() => false),
  readFileSync: vi.fn<(p: string, enc: string) => string>(() => '{}'),
  writeFileSync: vi.fn<(p: string, data: string) => void>(),
  homedir: vi.fn(() => '/mock-home'),
}))

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
}))

vi.mock('os', () => ({
  homedir: mocks.homedir,
}))

import { listMcpConfigs, saveMcpConfig, toggleMcpConfig, deleteMcpConfig } from './mcp-config-service'

const CWD = '/test/project'
const USER_CONFIG = join('/mock-home', '.claude.json')
const PROJECT_SETTINGS = join(CWD, '.claude', 'settings.json')
const PROJECT_MCP = join(CWD, '.mcp.json')

function mockFiles(files: Record<string, unknown>) {
  mocks.existsSync.mockImplementation((p: string) => p in files)
  mocks.readFileSync.mockImplementation((p: string) => {
    if (p in files) return JSON.stringify(files[p])
    throw new Error('ENOENT')
  })
}

function writtenJson(callIndex = 0): Record<string, unknown> {
  return JSON.parse(mocks.writeFileSync.mock.calls[callIndex][1] as string)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listMcpConfigs', () => {
  it('should merge servers from all 3 sources', () => {
    mockFiles({
      [USER_CONFIG]: { mcpServers: { userServer: { command: 'usr' } } },
      [PROJECT_SETTINGS]: { mcpServers: { projServer: { command: 'proj' } } },
      [PROJECT_MCP]: { mcpServers: { mcpServer: { command: 'mcp' } } },
    })

    const result = listMcpConfigs(CWD)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ name: 'userServer', scope: 'user' })
    expect(result[1]).toMatchObject({ name: 'projServer', scope: 'project' })
    expect(result[2]).toMatchObject({ name: 'mcpServer', scope: 'project' })
  })

  it('should dedupe by name with first-wins priority', () => {
    mockFiles({
      [USER_CONFIG]: { mcpServers: { shared: { command: 'user-cmd' } } },
      [PROJECT_SETTINGS]: { mcpServers: { shared: { command: 'project-cmd' } } },
    })

    const result = listMcpConfigs(CWD)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'shared', scope: 'user', command: 'user-cmd' })
  })

  it('should return empty array when no files exist', () => {
    mockFiles({})
    expect(listMcpConfigs(CWD)).toEqual([])
  })

  it('should handle malformed JSON gracefully', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue('not valid json')

    expect(listMcpConfigs(CWD)).toEqual([])
  })
})

describe('extractServers (via listMcpConfigs)', () => {
  it('should parse stdio type with command, args, env', () => {
    mockFiles({
      [USER_CONFIG]: {
        mcpServers: {
          myStdio: { type: 'stdio', command: 'node', args: ['server.js'], env: { KEY: 'val' } },
        },
      },
    })

    const [server] = listMcpConfigs(CWD)
    expect(server).toMatchObject({
      name: 'myStdio',
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { KEY: 'val' },
    })
  })

  it('should parse http type with url and headers', () => {
    mockFiles({
      [USER_CONFIG]: {
        mcpServers: {
          myHttp: { type: 'http', url: 'https://example.com', headers: { Authorization: 'Bearer tok' } },
        },
      },
    })

    const [server] = listMcpConfigs(CWD)
    expect(server).toMatchObject({
      name: 'myHttp',
      type: 'http',
      url: 'https://example.com',
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('should parse sse type', () => {
    mockFiles({
      [USER_CONFIG]: {
        mcpServers: { mySse: { type: 'sse', url: 'https://sse.example.com' } },
      },
    })

    const [server] = listMcpConfigs(CWD)
    expect(server).toMatchObject({ name: 'mySse', type: 'sse' })
  })

  it('should handle disabled flag', () => {
    mockFiles({
      [USER_CONFIG]: {
        mcpServers: { srv: { command: 'x', disabled: true } },
      },
    })

    const [server] = listMcpConfigs(CWD)
    expect(server.disabled).toBe(true)
  })

  it('should default disabled to false', () => {
    mockFiles({
      [USER_CONFIG]: { mcpServers: { srv: { command: 'x' } } },
    })

    const [server] = listMcpConfigs(CWD)
    expect(server.disabled).toBe(false)
  })

  it('should default to stdio when type is unknown', () => {
    mockFiles({
      [USER_CONFIG]: {
        mcpServers: { srv: { type: 'websocket', command: 'ws-cmd' } },
      },
    })

    const [server] = listMcpConfigs(CWD)
    expect(server.type).toBe('stdio')
  })
})

describe('saveMcpConfig', () => {
  it('should write stdio config to user file when scope is user', () => {
    mockFiles({ [USER_CONFIG]: { mcpServers: {} } })

    saveMcpConfig('newServer', { command: 'node', args: ['s.js'], env: { A: '1' } }, 'user', CWD)

    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      USER_CONFIG,
      expect.any(String)
    )
    const written = writtenJson()
    expect(written.mcpServers.newServer).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['s.js'],
      env: { A: '1' },
    })
  })

  it('should write to project .mcp.json when scope is project', () => {
    mockFiles({ [PROJECT_MCP]: { mcpServers: {} } })

    saveMcpConfig('projSrv', { command: 'python' }, 'project', CWD)

    expect(mocks.writeFileSync).toHaveBeenCalledWith(PROJECT_MCP, expect.any(String))
  })

  it('should write http config with url and headers', () => {
    mockFiles({ [USER_CONFIG]: {} })

    saveMcpConfig(
      'httpSrv',
      { type: 'http', url: 'https://api.test', headers: { 'X-Key': 'abc' } },
      'user',
      CWD
    )

    const written = writtenJson()
    expect(written.mcpServers.httpSrv).toEqual({
      type: 'http',
      url: 'https://api.test',
      headers: { 'X-Key': 'abc' },
    })
  })

  it('should create mcpServers object if not exists', () => {
    mockFiles({ [USER_CONFIG]: { otherKey: true } })

    saveMcpConfig('srv', { command: 'cmd' }, 'user', CWD)

    const written = writtenJson()
    expect(written.mcpServers).toBeDefined()
    expect(written.mcpServers.srv).toBeDefined()
    expect(written.otherKey).toBe(true)
  })

  it('should preserve existing entries', () => {
    mockFiles({
      [USER_CONFIG]: { mcpServers: { existing: { command: 'old' } } },
    })

    saveMcpConfig('newOne', { command: 'new' }, 'user', CWD)

    const written = writtenJson()
    expect(written.mcpServers.existing).toEqual({ command: 'old' })
    expect(written.mcpServers.newOne).toBeDefined()
  })
})

describe('toggleMcpConfig', () => {
  it('should set disabled=true when disabling', () => {
    mockFiles({
      [USER_CONFIG]: { mcpServers: { srv: { command: 'x' } } },
    })

    toggleMcpConfig('srv', true, 'user', CWD)

    const written = writtenJson()
    expect(written.mcpServers.srv.disabled).toBe(true)
  })

  it('should remove disabled key when enabling', () => {
    mockFiles({
      [USER_CONFIG]: { mcpServers: { srv: { command: 'x', disabled: true } } },
    })

    toggleMcpConfig('srv', false, 'user', CWD)

    const written = writtenJson()
    expect(written.mcpServers.srv.disabled).toBeUndefined()
  })

  it('should search across multiple project files', () => {
    mockFiles({
      [PROJECT_SETTINGS]: { mcpServers: {} },
      [PROJECT_MCP]: { mcpServers: { srv: { command: 'x' } } },
    })

    toggleMcpConfig('srv', true, 'project', CWD)

    expect(mocks.writeFileSync).toHaveBeenCalledWith(PROJECT_MCP, expect.any(String))
    const written = writtenJson()
    expect(written.mcpServers.srv.disabled).toBe(true)
  })

  it('should be no-op when server not found', () => {
    mockFiles({
      [USER_CONFIG]: { mcpServers: { other: { command: 'x' } } },
    })

    toggleMcpConfig('nonexistent', true, 'user', CWD)

    expect(mocks.writeFileSync).not.toHaveBeenCalled()
  })
})

describe('deleteMcpConfig', () => {
  it('should remove matching server entry', () => {
    mockFiles({
      [USER_CONFIG]: { mcpServers: { srv: { command: 'x' }, keep: { command: 'y' } } },
    })

    deleteMcpConfig('srv', 'user', CWD)

    const written = writtenJson()
    expect(written.mcpServers.srv).toBeUndefined()
    expect(written.mcpServers.keep).toEqual({ command: 'y' })
  })

  it('should search correct files for project scope', () => {
    mockFiles({
      [PROJECT_SETTINGS]: { mcpServers: {} },
      [PROJECT_MCP]: { mcpServers: { target: { command: 'rm-me' } } },
    })

    deleteMcpConfig('target', 'project', CWD)

    expect(mocks.writeFileSync).toHaveBeenCalledWith(PROJECT_MCP, expect.any(String))
    const written = writtenJson()
    expect(written.mcpServers.target).toBeUndefined()
  })

  it('should search correct file for user scope', () => {
    mockFiles({
      [USER_CONFIG]: { mcpServers: { target: { command: 'x' } } },
    })

    deleteMcpConfig('target', 'user', CWD)

    expect(mocks.writeFileSync).toHaveBeenCalledWith(USER_CONFIG, expect.any(String))
  })

  it('should be no-op when server not found', () => {
    mockFiles({
      [USER_CONFIG]: { mcpServers: {} },
    })

    deleteMcpConfig('ghost', 'user', CWD)

    expect(mocks.writeFileSync).not.toHaveBeenCalled()
  })
})
