/**
 * Host Action loopback HTTP MCP — browser_snapshot → requestHostAction.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { HOST_ACTION_TOOL_GROUPS } from '@superone/shared/environment'
import {
  buildSuperoneMcpHttpConfig,
  deriveSuperoneMcpSessionToken,
} from './host-action-mcp-auth'
import { startHostActionMcpServer, type HostActionMcpServerHandle } from './host-action-mcp-server'

const handles: HostActionMcpServerHandle[] = []

afterEach(async () => {
  while (handles.length) {
    const h = handles.pop()
    if (h) await h.stop().catch(() => {})
  }
})

async function boot(requestHostAction: Parameters<typeof startHostActionMcpServer>[0]['requestHostAction']) {
  const h = await startHostActionMcpServer({ requestHostAction, masterToken: 'test-master-token' })
  handles.push(h)
  return h
}

async function connectClient(h: HostActionMcpServerHandle, sessionId: string, auth?: string) {
  const cfg = h.getHttpConfig(sessionId)
  const headers = auth
    ? { ...cfg.headers, Authorization: auth }
    : cfg.headers
  const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
    requestInit: { headers },
  })
  const client = new Client({ name: 'ha-mcp-test', version: '1.0.0' })
  await client.connect(transport)
  return { client, transport, cfg }
}

describe('Host Action MCP server', () => {
  it('serves browser_snapshot and delegates to requestHostAction with session scope', async () => {
    const calls: Array<{ sessionId: string; toolName: string; args: unknown }> = []
    const h = await boot(async (input) => {
      calls.push({
        sessionId: input.sessionId,
        toolName: input.toolName,
        args: input.args,
      })
      expect(input.toolGroup).toBe(HOST_ACTION_TOOL_GROUPS.browserRead)
      expect(input.replayPolicy).toBe('safe')
      return {
        actionId: 'a1',
        state: 'succeeded',
        result: {
          content: [{ type: 'text', text: 'snapshot-ok' }],
        },
      }
    })

    const { client } = await connectClient(h, 'sess-node-1')
    const tools = await client.listTools()
    expect(tools.tools.map((t) => t.name)).toEqual(['browser_snapshot'])

    const result = (await client.callTool({
      name: 'browser_snapshot',
      arguments: { include: ['meta'] },
    })) as { content: Array<{ text: string }> }
    expect(result.content[0]!.text).toBe('snapshot-ok')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      sessionId: 'sess-node-1',
      toolName: 'browser_snapshot',
      args: { include: ['meta'] },
    })
    await client.close()
  })

  it('rejects wrong bearer token', async () => {
    const h = await boot(async () => ({
      actionId: 'x',
      state: 'failed',
      error: {},
    }))
    await expect(connectClient(h, 'sess-a', 'Bearer wrong')).rejects.toThrow(/Unauthorized|error/i)
  })

  it('isolates MCP transport sessions by SuperOne session id', async () => {
    const h = await boot(async (input) => ({
      actionId: 'a',
      state: 'succeeded',
      result: { content: [{ type: 'text', text: input.sessionId }] },
    }))
    const a = await connectClient(h, 'sess-a')
    const b = await connectClient(h, 'sess-b')
    const ra = (await a.client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    })) as { content: Array<{ text: string }> }
    const rb = (await b.client.callTool({
      name: 'browser_snapshot',
      arguments: {},
    })) as { content: Array<{ text: string }> }
    expect(ra.content[0]!.text).toBe('sess-a')
    expect(rb.content[0]!.text).toBe('sess-b')
    await a.client.close()
    await b.client.close()
  })

  it('getClaudeMcpServers matches SuperoneMcpHttpConfig shape', () => {
    const cfg = buildSuperoneMcpHttpConfig('http://127.0.0.1:9/mcp', 'tok', 'sid')
    expect(cfg).toEqual({
      url: 'http://127.0.0.1:9/mcp',
      headers: {
        Authorization: `Bearer ${deriveSuperoneMcpSessionToken('tok', 'sid')}`,
        'X-SuperOne-Session-Id': 'sid',
      },
    })
  })

  it('surfaces cancelled host actions as MCP isError', async () => {
    const h = await boot(async () => ({
      actionId: 'c1',
      state: 'cancelled',
      error: { code: 'cancelled', reason: 'interrupt' },
    }))
    const { client } = await connectClient(h, 'sess-c')
    const result = await client.callTool({ name: 'browser_snapshot', arguments: {} })
    expect(result.isError).toBe(true)
    await client.close()
  })
})
