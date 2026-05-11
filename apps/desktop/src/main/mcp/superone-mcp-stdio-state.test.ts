import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({ executable: '/mock/node' })),
}))

const {
  SUPERONE_MCP_IPC_ENDPOINT_ENV,
  SUPERONE_MCP_IPC_TOKEN_ENV,
  SUPERONE_MCP_PROJECT_DIR_ENV,
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
    expect(getCodexSuperoneMcpConfig('/project')).toBeNull()
  })

  it('builds stdio MCP config with project env', () => {
    setSuperoneMcpBridgeRuntime({
      endpoint: '/tmp/superone.sock',
      token: 'token-1',
      bridgeScriptPath: '/app/out/main/superone-mcp-stdio-bridge.js',
    })

    expect(getCodexSuperoneMcpConfig('/project')).toEqual({
      command: '/mock/node',
      args: ['/app/out/main/superone-mcp-stdio-bridge.js'],
      env: {
        [SUPERONE_MCP_IPC_ENDPOINT_ENV]: '/tmp/superone.sock',
        [SUPERONE_MCP_IPC_TOKEN_ENV]: 'token-1',
        [SUPERONE_MCP_PROJECT_DIR_ENV]: '/project',
      },
    })
  })
})
