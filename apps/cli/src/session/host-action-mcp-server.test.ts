/**
 * Host Action loopback HTTP MCP — browser_snapshot → requestHostAction.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { HOST_ACTION_TOOL_GROUPS } from '@superone/shared/environment'
import { deriveSuperoneMcpSessionToken } from './host-action-mcp-auth'
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
    const names = tools.tools.map((t) => t.name)
    expect(names).toContain('browser_snapshot')
    expect(names).toContain('browser_act')
    expect(names).toContain('browser_action')
    // The legacy per-verb primitives are executable on the desktop but not advertised.
    expect(names).not.toContain('browser_navigate')
    expect(names).not.toContain('browser_click')
    expect(names).not.toContain('browser_action_list')
    expect(names).toContain('read_manual')
    expect(names).toContain('session_rename')
    expect(names).toContain('session_tag')
    expect(names).toContain('session_tag_list')
    expect(names).toContain('widget_show')
    expect(names).toContain('miniapp_list')
    expect(names).toContain('computer_snapshot')
    expect(names).toContain('media_generate_image')
    // Node-local collab tools must not appear as Host Action advertise surface.
    expect(names).not.toContain('session_collab_list_agents')
    expect(names).not.toContain('session_collab_request')
    expect(names).not.toContain('session_collab_start')
    expect(names).not.toContain('session_collab_send')
    expect(names).not.toContain('session_collab_retrieve')
    expect(names.length).toBeGreaterThanOrEqual(45)

    const result = (await client.callTool({
      name: 'browser_snapshot',
      arguments: { include: ['meta'] },
    })) as { content: Array<{ text: string }> }
    expect(result.content[0]!.text).toBe('snapshot-ok')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      sessionId: 'sess-node-1',
      toolName: 'browser_snapshot',
      args: expect.objectContaining({ include: ['meta'] }),
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

  it('HTTP harness configs share the same session token surface', async () => {
    const h = await boot(async () => ({
      actionId: 'x',
      state: 'succeeded',
      result: { content: [{ type: 'text', text: 'ok' }] },
    }))
    const http = h.getHttpConfig('sid')
    const codex = h.getCodexMcpConfig('sid')
    const opencode = h.getOpenCodeMcpConfig('sid')
    const acp = h.getAcpMcpServer('sid')
    const claudeHttp = h.getClaudeHttpMcpServers('sid')

    expect(http).toEqual({
      url: h.httpUrl,
      headers: {
        Authorization: `Bearer ${deriveSuperoneMcpSessionToken(h.masterToken, 'sid')}`,
        'X-SuperOne-Session-Id': 'sid',
      },
    })
    expect(codex).toEqual({
      url: http.url,
      http_headers: http.headers,
      startup_timeout_sec: 60,
    })
    expect(opencode).toEqual({
      type: 'remote',
      url: http.url,
      headers: http.headers,
      enabled: true,
    })
    expect(acp).toEqual({
      type: 'http',
      name: 'superone',
      url: http.url,
      headers: Object.entries(http.headers).map(([name, value]) => ({ name, value })),
    })
    expect(claudeHttp.superone).toEqual({
      type: 'http',
      url: http.url,
      headers: http.headers,
    })
  })

  it('createClaudeSdkMcp returns in-process SDK entry that can call tools', async () => {
    const calls: string[] = []
    const h = await boot(async (input) => {
      calls.push(input.sessionId)
      return {
        actionId: 'a',
        state: 'succeeded',
        result: { content: [{ type: 'text', text: 'sdk-ok' }] },
      }
    })
    const sdk = h.createClaudeSdkMcp('sid-sdk')
    expect(sdk.mcpServers.superone?.type).toBe('sdk')
    expect(sdk.mcpServers.superone?.name).toBe('superone')
    // Instance is a live McpServer — close via dispose.
    await sdk.dispose()
    expect(calls).toEqual([])
  })

  it('forwards mutating tools with browser.act + unsafe replay policy', async () => {
    const seen: Array<{ toolName: string; toolGroup: string; replayPolicy: string }> = []
    const h = await boot(async (input) => {
      seen.push({
        toolName: input.toolName,
        toolGroup: input.toolGroup,
        replayPolicy: input.replayPolicy,
      })
      return {
        actionId: 'a',
        state: 'succeeded',
        result: { content: [{ type: 'text', text: 'nav-ok' }] },
      }
    })
    const { client } = await connectClient(h, 'sess-nav')
    await client.callTool({
      name: 'browser_act',
      arguments: { actions: [{ type: 'click', selector: '#go' }] },
    })
    expect(seen).toEqual([
      {
        toolName: 'browser_act',
        toolGroup: HOST_ACTION_TOOL_GROUPS.browserAct,
        replayPolicy: 'unsafe',
      },
    ])
    await client.close()
  })

  it('forwards superone builtins with superone group', async () => {
    const seen: Array<{ toolName: string; toolGroup: string; replayPolicy: string }> = []
    const h = await boot(async (input) => {
      seen.push({
        toolName: input.toolName,
        toolGroup: input.toolGroup,
        replayPolicy: input.replayPolicy,
      })
      return {
        actionId: 'a',
        state: 'succeeded',
        result: { content: [{ type: 'text', text: 'manual-ok' }] },
      }
    })
    const { client } = await connectClient(h, 'sess-manual')
    await client.callTool({
      name: 'read_manual',
      arguments: { domain: 'product' },
    })
    expect(seen).toEqual([
      {
        toolName: 'read_manual',
        toolGroup: HOST_ACTION_TOOL_GROUPS.superone,
        replayPolicy: 'safe',
      },
    ])
    await client.close()
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

  it('registers node-local session_collab tools without Host Action claim', async () => {
    const haCalls: string[] = []
    const listCalls: string[] = []
    const h = await startHostActionMcpServer({
      masterToken: 'test-master-token',
      requestHostAction: async (input) => {
        haCalls.push(input.toolName)
        return {
          actionId: 'x',
          state: 'failed',
          error: { code: 'unexpected', message: 'should not HA-route collab' },
        }
      },
      collab: {
        listAgents: (sessionId) => {
          listCalls.push(sessionId)
          return [{ id: 'claude', name: 'claude' }]
        },
        request: async () => ({ status: 'approved', launches: [] }),
        start: async () => ({ status: 'started', sessionId: 'c1', reused: false }),
        send: async () => ({ status: 'sent', messageId: 'm1', sequence: 1, reused: false }),
        retrieve: async () => ({ status: 'empty', messages: [] }),
      },
    })
    handles.push(h)

    const { client } = await connectClient(h, 'sess-collab')
    const tools = await client.listTools()
    const names = tools.tools.map((t) => t.name)
    expect(names).toContain('session_collab_list_agents')
    expect(names).toContain('session_collab_request')
    expect(names).toContain('session_collab_start')
    expect(names).toContain('session_collab_send')
    expect(names).toContain('session_collab_retrieve')

    const result = (await client.callTool({
      name: 'session_collab_list_agents',
      arguments: {},
    })) as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      agents: [{ id: 'claude', name: 'claude' }],
    })
    expect(listCalls).toEqual(['sess-collab'])
    expect(haCalls).toEqual([])
    await client.close()
  })
})
