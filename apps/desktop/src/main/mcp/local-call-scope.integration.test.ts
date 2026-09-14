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

  it('leaves nothing marked when a producer runs with no call at all', () => {
    persistTextArtifact('ui-1', 'spilled', 'json')
    expect(existsSync(join(root, 'sync', 'ui-1', '.owner'))).toBe(false)
  })
})
