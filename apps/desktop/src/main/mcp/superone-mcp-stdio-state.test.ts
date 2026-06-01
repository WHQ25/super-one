import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({ executable: '/mock/node' })),
}))

const {
  SUPERONE_MCP_IPC_ENDPOINT_ENV,
  SUPERONE_MCP_IPC_TOKEN_ENV,
  SUPERONE_MCP_SESSION_ID_ENV,
  getCodexSuperoneMcpConfig,
  setSuperoneMcpBridgeRuntime,
} = await import('./superone-mcp-stdio-state')

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

  it('builds stdio MCP config with session env', () => {
    setSuperoneMcpBridgeRuntime({
      endpoint: '/tmp/superone.sock',
      token: 'token-1',
      bridgeScriptPath: '/app/out/main/superone-mcp-stdio-bridge.js',
    })

    expect(getCodexSuperoneMcpConfig('session-1')).toEqual({
      command: '/mock/node',
      args: ['/app/out/main/superone-mcp-stdio-bridge.js'],
      env: {
        [SUPERONE_MCP_IPC_ENDPOINT_ENV]: '/tmp/superone.sock',
        [SUPERONE_MCP_IPC_TOKEN_ENV]: 'token-1',
        [SUPERONE_MCP_SESSION_ID_ENV]: 'session-1',
      },
      startup_timeout_sec: 60,
    })
  })
})
