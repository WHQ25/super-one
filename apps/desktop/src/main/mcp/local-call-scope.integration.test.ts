/**
 * Every local dispatcher has to say "this call is local" — not just the stdio
 * bridge. The Claude SDK is handed the `McpServer` instance directly and the
 * HTTP transport calls it directly too, so a tool call arriving either way used
 * to run with no call scope at all. A producer it reaches then marks nothing,
 * and the session's zone directory is kept by the reclaim sweep forever
 * (`docs/design/session-sync-zone.md` §7).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { bindLocalCallScope } from './local-call-scope'
import { collectArtifacts, currentCallOwner } from './artifact-registry'
import { persistTextArtifact } from '../agent/browser-artifact-store'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'local-scope-'))
  state.userData = root
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const owner = (sessionId: string) => readFileSync(join(root, 'sync', sessionId, '.owner'), 'utf8')

/** Register one producing tool the way every register*Tools helper does, and call it. */
function serverWithProducer(sessionId: string, api: 'registerTool' | 'tool') {
  const server = new McpServer({ name: 't', version: '1' })
  bindLocalCallScope(server, sessionId)
  const calls: (string | null | undefined)[] = []
  const handler = async () => {
    calls.push(currentCallOwner())
    persistTextArtifact(sessionId, 'spilled', 'json')
    return { content: [{ type: 'text' as const, text: 'ok' }] }
  }
  if (api === 'registerTool') server.registerTool('t_produce', { description: 'd', inputSchema: {} }, handler)
  else (server as unknown as { tool: (n: string, d: string, s: object, cb: typeof handler) => void }).tool('t_produce', 'd', {}, handler)
  const registered = (server as unknown as { _registeredTools: Record<string, { handler: (a: unknown, e: unknown) => Promise<unknown> }> })._registeredTools
  return { invoke: () => registered.t_produce!.handler({}, {}), calls }
}

/**
 * The shape `installBrowserAliasCallFallback` uses: replace the `tools/call`
 * handler and answer unlisted names directly, delegating the rest.
 */
function installAliasFallback(server: McpServer, run: () => void): void {
  const inner = (server as unknown as {
    server: {
      _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>>
      setRequestHandler: (schema: unknown, handler: (req: unknown, extra: unknown) => Promise<unknown>) => void
    }
  }).server
  const original = inner._requestHandlers.get('tools/call')!
  inner.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = (request as { params?: { name?: string } }).params?.name
    if (typeof name === 'string' && name.startsWith('browser_')) {
      run()
      return { content: [{ type: 'text', text: 'ok' }] }
    }
    return original(request, extra)
  })
}

describe('local call scope on the MCP instance', () => {
  it('marks the zone local for a tool the SDK calls through registerTool', async () => {
    const { invoke, calls } = serverWithProducer('sdk-1', 'registerTool')
    await invoke()
    expect(calls).toEqual([null])
    expect(owner('sdk-1')).toBe('local')
  })

  it('covers the older tool() registration the same way', async () => {
    const { invoke } = serverWithProducer('sdk-2', 'tool')
    await invoke()
    expect(owner('sdk-2')).toBe('local')
  })

  it('leaves a Host Action call attributed to its node, never downgrading it to local', async () => {
    // The same instance serves a remote session's Host Action; the outer scope
    // names the node and must win.
    const { invoke, calls } = serverWithProducer('remote-1', 'registerTool')
    await collectArtifacts('remote-1', 'call-1', () => invoke() as Promise<unknown>, 'node-7')
    expect(calls).toEqual(['node-7'])
    expect(owner('remote-1')).toBe('node-7')
  })

  it('marks the zone local for a tools/call the SDK routes past every registered tool', async () => {
    // The compact browser surface installs its own `tools/call` handler so an
    // unlisted legacy alias from an old transcript still runs — and that branch
    // reaches the executor without ever touching a registered callback. Driven
    // through a real Client and transport, because `_registeredTools` cannot
    // see this path at all.
    const server = new McpServer({ name: 't', version: '1' })
    bindLocalCallScope(server, 'alias-1')
    const seen: (string | null | undefined)[] = []
    // One registered tool, so the SDK installs its `tools/call` handler...
    server.registerTool('t_listed', { description: 'd', inputSchema: {} }, async () => ({ content: [] }))
    // ...then the fallback replaces it, exactly as the browser surface does.
    installAliasFallback(server, () => {
      seen.push(currentCallOwner())
      persistTextArtifact('alias-1', 'spilled', 'json')
    })

    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'c', version: '1' })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    await client.callTool({ name: 'browser_unlisted_alias', arguments: {} })
    await client.close()

    expect(seen).toEqual([null])
    expect(owner('alias-1')).toBe('local')
  })

  it('leaves nothing marked when a producer runs with no call at all', () => {
    persistTextArtifact('ui-1', 'spilled', 'json')
    expect(existsSync(join(root, 'sync', 'ui-1', '.owner'))).toBe(false)
  })
})
