import { describe, it, expect, vi } from 'vitest'
import type { McpServerConfig } from '@superone/shared/agent-types'

vi.mock('../mcp/superone-mcp-stdio-state', () => ({
  getSuperoneMcpHttpConfig: (sessionId: string) => ({
    url: 'http://127.0.0.1:3210/mcp',
    headers: {
      Authorization: 'Bearer tok',
      'X-SuperOne-Session-Id': sessionId,
    },
  }),
  getSuperoneMcpStdioConfig: (sessionId: string) => ({
    command: '/node',
    args: ['/bridge.js'],
    env: {
      SUPERONE_MCP_SESSION_ID: sessionId,
      SUPERONE_MCP_IPC_TOKEN: 'tok',
      SUPERONE_MCP_IPC_ENDPOINT: 'http://127.0.0.1/mcp',
    },
  }),
}))

import {
  SUPERONE_ACP_MCP_NAME,
  buildAcpSessionMcpServers,
  mcpTransportCapsFromAgent,
  toAcpMcpServer,
} from './acp-mcp'

function stdio(name: string, overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name,
    type: 'stdio',
    scope: 'user',
    command: 'npx',
    args: ['-y', `${name}-mcp`],
    ...overrides,
  }
}

describe('toAcpMcpServer', () => {
  const allCaps = { http: true, sse: true }

  it('maps stdio env Record to name/value array', () => {
    const mapped = toAcpMcpServer(
      stdio('github', { env: { GITHUB_TOKEN: 'x' } }),
      allCaps,
    )
    expect(mapped).toEqual({
      name: 'github',
      command: 'npx',
      args: ['-y', 'github-mcp'],
      env: [{ name: 'GITHUB_TOKEN', value: 'x' }],
    })
  })

  it('skips disabled and incomplete entries', () => {
    expect(toAcpMcpServer(stdio('a', { disabled: true }), allCaps)).toBeNull()
    expect(toAcpMcpServer(stdio('b', { command: '' }), allCaps)).toBeNull()
    expect(toAcpMcpServer({ name: 'h', type: 'http', scope: 'user', url: '' }, allCaps)).toBeNull()
  })

  it('maps http/sse only when agent advertises transport', () => {
    const httpCfg: McpServerConfig = {
      name: 'linear',
      type: 'http',
      scope: 'user',
      url: 'https://mcp.linear.app',
      headers: { Authorization: 'Bearer t' },
    }
    expect(toAcpMcpServer(httpCfg, { http: false, sse: false })).toBeNull()
    expect(toAcpMcpServer(httpCfg, { http: true, sse: false })).toEqual({
      type: 'http',
      name: 'linear',
      url: 'https://mcp.linear.app',
      headers: [{ name: 'Authorization', value: 'Bearer t' }],
    })

    const sseCfg: McpServerConfig = {
      name: 'sse-svc',
      type: 'sse',
      scope: 'project',
      url: 'https://example.com/sse',
    }
    expect(toAcpMcpServer(sseCfg, { http: true, sse: false })).toBeNull()
    expect(toAcpMcpServer(sseCfg, { http: false, sse: true })).toMatchObject({
      type: 'sse',
      name: 'sse-svc',
      url: 'https://example.com/sse',
      headers: [],
    })
  })
})

describe('buildAcpSessionMcpServers', () => {
  it('puts superone first and appends enabled user servers', () => {
    const servers = buildAcpSessionMcpServers({
      cwd: '/proj',
      superoneSessionId: 'sid-1',
      agentCapabilities: {
        loadSession: false,
        mcp: { http: true, sse: false, acp: false },
        sessionCapabilities: { additionalDirectories: false },
      },
      listConfigs: () => [
        stdio('github'),
        stdio('disabled', { disabled: true }),
        { name: 'remote', type: 'http', scope: 'user', url: 'https://r.example' },
        { name: 'sse-skip', type: 'sse', scope: 'user', url: 'https://s.example' },
        stdio(SUPERONE_ACP_MCP_NAME, { command: 'evil' }),
      ],
    })

    expect(servers.map((s) => s.name)).toEqual(['superone', 'github', 'remote'])
    expect(servers[0]).toEqual({
      type: 'http',
      name: 'superone',
      url: 'http://127.0.0.1:3210/mcp',
      headers: [
        { name: 'Authorization', value: 'Bearer tok' },
        { name: 'X-SuperOne-Session-Id', value: 'sid-1' },
      ],
    })
    expect(servers[1]).toMatchObject({ name: 'github', command: 'npx' })
    expect(servers[2]).toMatchObject({ type: 'http', name: 'remote' })
  })

  it('falls back to stdio when the agent does not advertise HTTP', () => {
    const servers = buildAcpSessionMcpServers({
      cwd: '/proj',
      superoneSessionId: 'sid-stdio',
      listConfigs: () => [],
    })

    expect(servers[0]).toMatchObject({
      name: 'superone',
      command: '/node',
      env: expect.arrayContaining([
        { name: 'SUPERONE_MCP_SESSION_ID', value: 'sid-stdio' },
      ]),
    })
  })

  it('works without superone session id', () => {
    const servers = buildAcpSessionMcpServers({
      cwd: '/proj',
      listConfigs: () => [stdio('only-user')],
    })
    expect(servers).toEqual([
      {
        name: 'only-user',
        command: 'npx',
        args: ['-y', 'only-user-mcp'],
        env: [],
      },
    ])
  })
})

describe('mcpTransportCapsFromAgent', () => {
  it('defaults to false when capabilities missing', () => {
    expect(mcpTransportCapsFromAgent(null)).toEqual({ http: false, sse: false })
  })
})
