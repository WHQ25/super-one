import { beforeEach, describe, expect, it, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import log from '../logger'
import { bindLocalCallScope } from './local-call-scope'
import { bindToolErrorLog, logToolFailure } from './tool-error-log'

const warn = vi.mocked(log.warn)

beforeEach(() => {
  warn.mockClear()
})

describe('logToolFailure', () => {
  it('logs an isError result with its text, truncated, and returns it unchanged', async () => {
    const result = { isError: true, content: [{ type: 'text', text: 'x'.repeat(600) }] }

    await expect(logToolFailure('s1', 'session_collab_request', () => result)).resolves.toBe(result)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0].slice(0, 3)).toEqual(['[superone-mcp] tool %s failed sid=%s: %s', 'session_collab_request', 's1'])
    expect(warn.mock.calls[0][3]).toBe(`${'x'.repeat(500)}…`)
  })

  it('stays quiet for a successful call and for a cancelled one', async () => {
    await logToolFailure('s1', 'ok_tool', () => ({ content: [{ type: 'text', text: 'done' }] }))
    const aborted = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    await expect(logToolFailure('s1', 'slow_tool', () => Promise.reject(aborted))).rejects.toBe(aborted)

    expect(warn).not.toHaveBeenCalled()
  })

  it('logs a thrown error and rethrows it', async () => {
    const error = new Error('boom')

    await expect(logToolFailure('s1', 'bad_tool', () => { throw error })).rejects.toBe(error)

    expect(warn.mock.calls).toEqual([['[superone-mcp] tool %s threw sid=%s: %s', 'bad_tool', 's1', 'boom']])
  })
})

describe('bindToolErrorLog', () => {
  /** Built the way createSuperoneMcpServer does, then called over the real protocol. */
  async function connectedClient() {
    const server = new McpServer({ name: 't', version: '1' })
    bindLocalCallScope(server, 'sid')
    bindToolErrorLog(server, 'sid')
    server.registerTool('t_ok', { description: 'd', inputSchema: {} }, async () => ({
      content: [{ type: 'text' as const, text: 'fine' }],
    }))
    server.registerTool('t_refused', { description: 'd', inputSchema: {} }, async () => ({
      content: [{ type: 'text' as const, text: 'not allowed' }],
      isError: true,
    }))
    server.registerTool('t_throws', { description: 'd', inputSchema: {} }, async () => {
      throw new Error('exploded')
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'c', version: '1' })
    await client.connect(clientTransport)
    return client
  }

  it('logs each failed protocol call exactly once and leaves successes alone', async () => {
    const client = await connectedClient()

    await client.callTool({ name: 't_ok', arguments: {} })
    await client.callTool({ name: 't_refused', arguments: {} })
    await client.callTool({ name: 't_throws', arguments: {} })

    expect(warn.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      ['t_refused', 'not allowed'],
      ['t_throws', 'exploded'],
    ])
  })
})
