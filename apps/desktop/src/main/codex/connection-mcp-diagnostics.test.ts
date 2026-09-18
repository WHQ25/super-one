import { afterEach, describe, expect, it, vi } from 'vitest'
import log from '../logger'
import { createCodexConnectionDiagnostics } from './connection-diagnostics'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

function events() {
  return [...vi.mocked(log.info).mock.calls, ...vi.mocked(log.warn).mock.calls]
    .filter(([prefix]) => prefix === '[codex.diagnostic] %s')
    .map(([, json]) => JSON.parse(String(json)))
}

function diagnostics() {
  return createCodexConnectionDiagnostics({
    connectionId: 'conn-mcp', env: {}, provider: null, explicitCliOverrides: false,
  })
}

afterEach(() => vi.clearAllMocks())

describe('Codex MCP production diagnostics', () => {
  it('records omitted MCP injection even when the thread starts successfully', async () => {
    const diagnostic = diagnostics()
    try {
      await diagnostic.request('thread/start', { config: {} }, async () => ({ thread: { id: 'thread-1' } }))
      expect(events()).toContainEqual(expect.objectContaining({
        connectionId: 'conn-mcp', event: 'mcp_config', injected: false,
      }))
      expect(log.warn).toHaveBeenCalled()
    } finally { diagnostic.close() }
  })

  it('correlates a non-fatal MCP failure and tool discovery errors without leaking credentials', async () => {
    const diagnostic = diagnostics()
    const token = 'private-mcp-token'
    try {
      await diagnostic.request('thread/resume', {
        threadId: 'thread-1', config: {
          developer_instructions: 'private instructions',
          mcp_servers: { superone: {
            url: 'http://127.0.0.1:3210/mcp', startup_timeout_sec: 60,
            http_headers: { Authorization: `Bearer ${token}`, 'X-SuperOne-Session-Id': 'session-1' },
          } },
        },
      }, async () => ({ thread: { id: 'thread-1' } }))
      diagnostic.stderr('\x1b[31mERROR\x1b[0m rmcp: connection refused Bearer private-mcp-')
      diagnostic.stderr('token\n')
      diagnostic.notification('mcpServer/startupStatus/updated', {
        threadId: 'thread-1', name: 'superone', status: 'failed',
        error: { message: `connection refused token=${token}` },
      })
      await diagnostic.request('mcpServerStatus/list', { threadId: 'thread-1' }, async () => ({
        data: [{ name: 'superone', runtimeStatus: 'failed', tools: {}, toolsError: `discovery failed ${token}` }],
        nextCursor: null,
      }))
      expect(events()).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: 'mcp_config', sessionId: 'session-1', injected: true, startupTimeoutSec: 60 }),
        expect.objectContaining({ event: 'mcp_stderr', message: expect.stringContaining('connection refused') }),
        expect.objectContaining({ event: 'mcp_startup', sessionId: 'session-1', threadId: 'thread-1', status: 'failed', error: expect.stringContaining('connection refused') }),
        expect.objectContaining({ event: 'mcp_snapshot', present: true, toolCount: 0, toolsError: expect.stringContaining('discovery failed') }),
      ]))
      expect(JSON.stringify(events())).not.toContain(token)
      expect(JSON.stringify(events())).not.toContain('private instructions')
    } finally { diagnostic.close() }
  })

  it('distinguishes a ready server with tools from an absent server snapshot', async () => {
    const diagnostic = diagnostics()
    try {
      diagnostic.notification('mcpServer/startupStatus/updated', { name: 'superone', status: 'ready' })
      await diagnostic.request('mcpServerStatus/list', {}, async () => ({ data: [
        { name: 'superone', runtimeStatus: 'connected', tools: { a: { name: 'a', description: 'private description' } } },
      ] }))
      await diagnostic.request('mcpServerStatus/list', {}, async () => ({ data: [], nextCursor: 'another-page' }))
      expect(events()).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: 'mcp_startup', status: 'ready' }),
        expect.objectContaining({ event: 'mcp_snapshot', present: true, toolCount: 1, runtimeStatus: 'connected' }),
        expect.objectContaining({ event: 'mcp_snapshot', present: false, hasNextPage: true }),
      ]))
      expect(JSON.stringify(events())).not.toContain('private description')
    } finally { diagnostic.close() }
  })
})
