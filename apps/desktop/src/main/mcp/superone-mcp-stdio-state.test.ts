import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({ executable: '/mock/node' })),
}))

const {
  SUPERONE_MCP_IPC_ENDPOINT_ENV,
  SUPERONE_MCP_IPC_TOKEN_ENV,
  SUPERONE_MCP_SESSION_ID_ENV,
  getCodexSuperoneMcpConfig,
  getSuperoneMcpHttpConfig,
  getSuperoneMcpStdioConfig,
  setSuperoneMcpBridgeRuntime,
} = await import('./superone-mcp-stdio-state')
const { deriveSuperoneMcpSessionToken } = await import('./superone-mcp-auth')

describe('getCodexSuperoneMcpConfig', () => {
  beforeEach(() => {
    setSuperoneMcpBridgeRuntime(null)
  })

  afterEach(() => {
    setSuperoneMcpBridgeRuntime(null)
  })

  it('returns null until the bridge runtime is registered', () => {
    expect(getCodexSuperoneMcpConfig('session-1')).toBeNull()
  })

  it('builds shared HTTP configs with session-scoped authentication', () => {
    const sessionToken = deriveSuperoneMcpSessionToken('token-1', 'session-1')
    setSuperoneMcpBridgeRuntime({
      endpoint: '/tmp/superone.sock',
      httpUrl: 'http://127.0.0.1:3210/mcp',
      token: 'token-1',
      bridgeScriptPath: '/app/out/main/superone-mcp-stdio-bridge.js',
    })

    expect(getSuperoneMcpHttpConfig('session-1')).toEqual({
      url: 'http://127.0.0.1:3210/mcp',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'X-SuperOne-Session-Id': 'session-1',
      },
    })
    expect(getCodexSuperoneMcpConfig('session-1')).toEqual({
      url: 'http://127.0.0.1:3210/mcp',
      http_headers: {
        Authorization: `Bearer ${sessionToken}`,
        'X-SuperOne-Session-Id': 'session-1',
      },
      startup_timeout_sec: 60,
    })
  })

  it('keeps stdio config available for agents without HTTP support', () => {
    const sessionToken = deriveSuperoneMcpSessionToken('token-1', 'session-1')
    setSuperoneMcpBridgeRuntime({
      endpoint: '/tmp/superone.sock',
      httpUrl: 'http://127.0.0.1:3210/mcp',
      token: 'token-1',
      bridgeScriptPath: '/app/out/main/superone-mcp-stdio-bridge.js',
    })

    expect(getSuperoneMcpStdioConfig('session-1')).toEqual({
      command: '/mock/node',
      args: ['/app/out/main/superone-mcp-stdio-bridge.js'],
      env: {
        [SUPERONE_MCP_IPC_ENDPOINT_ENV]: '/tmp/superone.sock',
        [SUPERONE_MCP_IPC_TOKEN_ENV]: sessionToken,
        [SUPERONE_MCP_SESSION_ID_ENV]: 'session-1',
      },
    })
  })

  it('derives different credentials for different SuperOne sessions', () => {
    setSuperoneMcpBridgeRuntime({
      endpoint: '/tmp/superone.sock',
      httpUrl: 'http://127.0.0.1:3210/mcp',
      token: 'token-1',
      bridgeScriptPath: '/app/out/main/superone-mcp-stdio-bridge.js',
    })

    expect(getSuperoneMcpHttpConfig('session-a')?.headers.Authorization)
      .not.toBe(getSuperoneMcpHttpConfig('session-b')?.headers.Authorization)
    expect(getSuperoneMcpStdioConfig('session-a')?.env[SUPERONE_MCP_IPC_TOKEN_ENV])
      .not.toBe(getSuperoneMcpStdioConfig('session-b')?.env[SUPERONE_MCP_IPC_TOKEN_ENV])
  })
})
