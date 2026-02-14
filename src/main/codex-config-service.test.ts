import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock, readFileSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}))

const homedirMock = vi.hoisted(() => vi.fn(() => '/home/testuser'))

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
}))

vi.mock('os', () => ({
  homedir: homedirMock,
}))

import { listCodexMcpConfigs } from './codex-config-service'

describe('listCodexMcpConfigs', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    readFileSyncMock.mockReset()
  })

  it('returns empty array when no config files exist', () => {
    existsSyncMock.mockReturnValue(false)

    const result = listCodexMcpConfigs('/project')
    expect(result).toEqual([])
  })

  it('parses stdio MCP server from TOML', () => {
    const toml = `
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem"]
env = { HOME = "/home/user" }
`
    existsSyncMock.mockImplementation((path: string) =>
      path === join('/home/testuser', '.codex', 'config.toml')
    )
    readFileSyncMock.mockReturnValue(toml)

    const result = listCodexMcpConfigs('/project')
    expect(result).toEqual([
      {
        name: 'filesystem',
        type: 'stdio',
        scope: 'user',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: { HOME: '/home/user' },
      },
    ])
  })

  it('parses HTTP MCP server from TOML', () => {
    const toml = `
[mcp_servers.remote]
url = "https://api.example.com/mcp"
http_headers = { Authorization = "Bearer token123" }
`
    existsSyncMock.mockImplementation((path: string) =>
      path === join('/home/testuser', '.codex', 'config.toml')
    )
    readFileSyncMock.mockReturnValue(toml)

    const result = listCodexMcpConfigs('/project')
    expect(result).toEqual([
      {
        name: 'remote',
        type: 'http',
        scope: 'user',
        url: 'https://api.example.com/mcp',
        headers: { Authorization: 'Bearer token123' },
      },
    ])
  })

  it('maps enabled: false to disabled: true', () => {
    const toml = `
[mcp_servers.disabled_server]
command = "node"
args = ["server.js"]
enabled = false
`
    existsSyncMock.mockImplementation((path: string) =>
      path === join('/home/testuser', '.codex', 'config.toml')
    )
    readFileSyncMock.mockReturnValue(toml)

    const result = listCodexMcpConfigs('/project')
    expect(result).toHaveLength(1)
    expect(result[0].disabled).toBe(true)
  })

  it('merges user and project configs, project overrides user', () => {
    const userToml = `
[mcp_servers.shared]
command = "user-cmd"

[mcp_servers.user_only]
command = "user-only-cmd"
`
    const projectToml = `
[mcp_servers.shared]
command = "project-cmd"

[mcp_servers.project_only]
url = "https://project.example.com"
`
    const userPath = join('/home/testuser', '.codex', 'config.toml')
    const projectPath = join('/project', '.codex', 'config.toml')

    existsSyncMock.mockImplementation((path: string) =>
      path === userPath || path === projectPath
    )
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === userPath) return userToml
      if (path === projectPath) return projectToml
      throw new Error('not found')
    })

    const result = listCodexMcpConfigs('/project')
    expect(result).toHaveLength(3)

    // shared should use project version
    const shared = result.find((c) => c.name === 'shared')
    expect(shared?.command).toBe('project-cmd')
    expect(shared?.scope).toBe('project')

    // user_only keeps user scope
    const userOnly = result.find((c) => c.name === 'user_only')
    expect(userOnly?.command).toBe('user-only-cmd')
    expect(userOnly?.scope).toBe('user')

    // project_only has project scope
    const projectOnly = result.find((c) => c.name === 'project_only')
    expect(projectOnly?.type).toBe('http')
    expect(projectOnly?.scope).toBe('project')
  })

  it('returns empty array for malformed TOML', () => {
    existsSyncMock.mockImplementation((path: string) =>
      path === join('/home/testuser', '.codex', 'config.toml')
    )
    readFileSyncMock.mockReturnValue('this is not valid toml {{{')

    const result = listCodexMcpConfigs('/project')
    expect(result).toEqual([])
  })

  it('skips entries without command or url', () => {
    const toml = `
[mcp_servers.incomplete]
args = ["--flag"]
`
    existsSyncMock.mockImplementation((path: string) =>
      path === join('/home/testuser', '.codex', 'config.toml')
    )
    readFileSyncMock.mockReturnValue(toml)

    const result = listCodexMcpConfigs('/project')
    expect(result).toEqual([])
  })

  it('handles TOML without mcp_servers section', () => {
    const toml = `
model = "gpt-4o"
`
    existsSyncMock.mockImplementation((path: string) =>
      path === join('/home/testuser', '.codex', 'config.toml')
    )
    readFileSyncMock.mockReturnValue(toml)

    const result = listCodexMcpConfigs('/project')
    expect(result).toEqual([])
  })
})
