/**
 * A remote session's `widget_show` reply comes back from the desktop in full. The node owns
 * the harness, so it shortens a successful `widget_code` reply for a harness whose
 * transcript keeps the call's complete input, on both ways a harness attaches.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { widgetShowShortContent } from '@superone/shared/generative-ui/widget-data'
import { startHostActionMcpServer, type HostActionMcpServerHandle } from './host-action-mcp-server'

const ARGS = { title: 'releases', widget_code: '<div>Release chart</div>' }
const PAYLOAD = JSON.stringify({ title: 'releases', widget_code: '<div>Release chart</div>', width: 800, height: 600, isSVG: false })
const FULL = { content: [{ type: 'text', text: PAYLOAD }] }

const handles: HostActionMcpServerHandle[] = []
afterEach(async () => {
  while (handles.length) await handles.pop()!.stop().catch(() => {})
})

async function boot(harnessId: string | undefined, reply: unknown = FULL) {
  const h = await startHostActionMcpServer({
    masterToken: 'test-master-token',
    requestHostAction: async () => ({ actionId: 'a', state: 'succeeded', result: reply }),
    resolveHarnessId: () => harnessId,
  })
  handles.push(h)
  return h
}

async function viaHttp(h: HostActionMcpServerHandle, args: Record<string, unknown>) {
  const cfg = h.getHttpConfig('sess-1')
  const client = new Client({ name: 'widget-test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } }))
  try {
    return await client.callTool({ name: 'widget_show', arguments: args })
  } finally {
    await client.close()
  }
}

async function viaSdk(h: HostActionMcpServerHandle, args: Record<string, unknown>) {
  const sdk = h.createClaudeSdkMcp('sess-1')
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await (sdk.mcpServers.superone!.instance as McpServer).connect(serverSide)
  const client = new Client({ name: 'widget-test', version: '1' })
  await client.connect(clientSide)
  try {
    return await client.callTool({ name: 'widget_show', arguments: args })
  } finally {
    await client.close()
    await sdk.dispose()
  }
}

describe.each([['HTTP', viaHttp], ['SDK', viaSdk]] as const)('a node widget_show reply over %s', (_, call) => {
  it.each(['claude', 'codex'])('is the acknowledgement for a %s session', async (harnessId) => {
    const result = await call(await boot(harnessId), ARGS)
    expect(result.content).toEqual(widgetShowShortContent(ARGS))
  })

  it.each(['acp', 'opencode', 'cursor', 'dsh', 'unknown-harness', undefined])('stays full for %s', async (harnessId) => {
    const result = await call(await boot(harnessId), ARGS)
    expect(result.content).toEqual(FULL.content)
  })

  it('stays full for a template call', async () => {
    const result = await call(await boot('claude'), { title: 'panel', template: 'panel-a1b2c3d4' })
    expect(result.content).toEqual(FULL.content)
  })

  it('leaves an error reply as it is', async () => {
    const error = { content: [{ type: 'text', text: 'widget_show requires either widget_code or template.' }], isError: true }
    const result = await call(await boot('claude', error), ARGS)
    expect(result).toMatchObject(error)
  })
})
