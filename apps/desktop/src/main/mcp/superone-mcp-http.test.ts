import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import * as z from 'zod/v4'

const mocks = vi.hoisted(() => ({
  closedSessionIds: [] as string[],
  protocolClosedSessionIds: [] as string[],
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
}))
vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({ executable: '/mock/node', env: {} })),
}))
vi.mock('./superone-mcp-tool-surface', () => ({
  listSuperoneMcpTools: vi.fn(() => []),
  executeSuperoneMcpTool: vi.fn(),
}))
vi.mock('./superone-mcp-server', () => ({
  setToolSyncCallbacks: vi.fn(),
  getSessionHost: vi.fn(() => ({
    getSession: (sessionId: string) => ({ projectPath: `/projects/${sessionId}` }),
  })),
  createSuperoneMcpServer: vi.fn((sessionId: string) => {
    const server = new McpServer({ name: 'superone-test', version: '1.0.0' })
    const innerServer = (server as unknown as { server: { onclose?: () => void } }).server
    innerServer.onclose = () => {
      mocks.protocolClosedSessionIds.push(sessionId)
    }
    const close = server.close.bind(server)
    server.close = async () => {
      mocks.closedSessionIds.push(sessionId)
      await close()
    }
    server.registerTool(
      'whoami',
      { inputSchema: { value: z.string().optional() } },
      async ({ value }) => ({
        content: [{ type: 'text' as const, text: JSON.stringify({ sessionId, value }) }],
      }),
    )
    return { type: 'sdk', name: 'superone', instance: server }
  }),
}))

const {
  startSuperoneMcpStdioBridge,
  stopSuperoneMcpStdioBridge,
} = await import('./superone-mcp-stdio-ipc')
const { createSuperoneMcpServer } = await import('./superone-mcp-server')
const {
  getSuperoneMcpHttpConfig,
} = await import('./superone-mcp-stdio-state')
const { closeSuperoneMcpHttpSessions } = await import('./superone-mcp-http-state')

function makeClient(sessionId: string, authorization?: string) {
  const config = getSuperoneMcpHttpConfig(sessionId)!
  const headers = authorization
    ? { ...config.headers, Authorization: authorization }
    : config.headers
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers },
  })
  const client = new Client({ name: 'superone-http-test', version: '1.0.0' })
  return { client, transport, config }
}

describe('superone MCP shared HTTP transport', () => {
  beforeEach(async () => {
    mocks.closedSessionIds = []
    mocks.protocolClosedSessionIds = []
    await startSuperoneMcpStdioBridge()
  })

  afterEach(() => {
    stopSuperoneMcpStdioBridge()
  })

  it('serves tools in-process with the configured SuperOne session scope', async () => {
    const { client, transport } = makeClient('session-http-a')
    await client.connect(transport)

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toContain('whoami')
    expect(createSuperoneMcpServer).toHaveBeenCalledWith(
      'session-http-a',
      '/projects/session-http-a',
    )
    const result = await client.callTool({ name: 'whoami', arguments: { value: 'ok' } })
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      sessionId: 'session-http-a',
      value: 'ok',
    })

    await client.close()
  })

  it('rejects clients with the wrong bearer token', async () => {
    const { client, transport } = makeClient('session-http-a', 'Bearer wrong')
    await expect(client.connect(transport)).rejects.toThrow()
    await client.close().catch(() => undefined)
  })

  it('does not allow an MCP transport id to be reused by another SuperOne session', async () => {
    const { client, transport, config } = makeClient('session-http-a')
    await client.connect(transport)
    expect(transport.sessionId).toBeTruthy()

    const otherConfig = getSuperoneMcpHttpConfig('session-http-b')!
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        ...otherConfig.headers,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Session-Id': transport.sessionId!,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    })
    expect(response.status).toBe(403)

    await client.close()
  })

  it('does not allow one SuperOne session token to initialize another session', async () => {
    const sessionA = getSuperoneMcpHttpConfig('session-http-a')!
    const sessionB = getSuperoneMcpHttpConfig('session-http-b')!
    const response = await fetch(sessionA.url, {
      method: 'POST',
      headers: {
        ...sessionA.headers,
        'X-SuperOne-Session-Id': sessionB.headers['X-SuperOne-Session-Id'],
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'spoof', version: '1.0.0' },
        },
      }),
    })

    expect(response.status).toBe(401)
  })

  it('closes all HTTP MCP servers when the Session runtime is released', async () => {
    const first = makeClient('session-http-release')
    const second = makeClient('session-http-release')
    await first.client.connect(first.transport)
    await second.client.connect(second.transport)

    await closeSuperoneMcpHttpSessions('session-http-release')

    expect(mocks.closedSessionIds).toEqual([
      'session-http-release',
      'session-http-release',
    ])
    expect(mocks.protocolClosedSessionIds).toEqual([
      'session-http-release',
      'session-http-release',
    ])
    await first.client.close().catch(() => undefined)
    await second.client.close().catch(() => undefined)
  })
})
