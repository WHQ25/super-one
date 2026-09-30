import { describe, expect, it, vi } from 'vitest'
import type { McpAppDeviceRequest, RemoteCommand } from '@superone/shared/agent-types'
import { parseMcpAppRequest, requestMcpApp } from './mcp-apps'

const SESSION = { projectPath: '/Users/me/proj', sessionId: 'sess-1' }
const CALL: McpAppDeviceRequest = { messageId: 'm', appInstanceId: 'view-1', operation: 'callTool', tool: 'fixture_next_page', args: { page: 2 } }
const READ: McpAppDeviceRequest = { messageId: 'm', appInstanceId: 'view-1', operation: 'readResource', uri: 'ui://fixture/items.html' }

function client(answer: () => Promise<unknown>) {
  return { request: vi.fn(async (_command: RemoteCommand, _timeoutMs?: number) => answer()) }
}

describe('parseMcpAppRequest', () => {
  it('accepts a named View operation and nothing the phone handles itself', () => {
    expect(parseMcpAppRequest(CALL)).toBe(CALL)
    expect(() => parseMcpAppRequest({ ...CALL, operation: 'openLink' })).toThrow('invalid mcpApp payload')
    expect(() => parseMcpAppRequest({ ...CALL, appInstanceId: '' })).toThrow('invalid mcpApp payload')
    expect(() => parseMcpAppRequest(undefined)).toThrow('invalid mcpApp payload')
  })
})

describe('requestMcpApp', () => {
  it('sends the View identity with the session and passes the host answer through', async () => {
    const response = { ok: false, error: { code: 'approval_required', challenge: 'c1', prompt: { kind: 'callTool' } } }
    const host = client(async () => ({ response }))
    await expect(requestMcpApp(host, SESSION, CALL)).resolves.toBe(response)
    const [command, timeout] = host.request.mock.calls[0]!
    expect(command).toMatchObject({ type: 'mcp_app_request', ...SESSION, request: CALL })
    // Longer than the document's own 120 s, so the document classifies a slow call.
    expect(timeout).toBe(125_000)
  })

  it('reports a tool call lost after sending as an unknown outcome, never a retryable failure', async () => {
    await expect(requestMcpApp(client(async () => { throw new Error('rpc timeout: mcp_app_request') }), SESSION, CALL))
      .resolves.toMatchObject({ ok: false, error: { code: 'unknown_outcome' } })
    await expect(requestMcpApp(client(async () => { throw new Error('rpc timeout: mcp_app_request') }), SESSION, READ))
      .resolves.toMatchObject({ ok: false, error: { code: 'timeout' } })
  })

  it('keeps a call refused before it left the phone retryable', async () => {
    await expect(requestMcpApp(client(async () => { throw new Error('not connected') }), SESSION, CALL))
      .resolves.toMatchObject({ ok: false, error: { code: 'not_connected' } })
  })

  it('turns a host refusal of the command itself into a denial', async () => {
    await expect(requestMcpApp(client(async () => ({ error: 'Session sess-1 does not belong to project /x' })), SESSION, READ))
      .resolves.toMatchObject({ ok: false, error: { code: 'denied', message: 'Session sess-1 does not belong to project /x' } })
  })
})
