import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
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


it('fetches HTML once per authorized hash across Views, retaining each reference metadata', async () => {
  const reference = { hash: 'a'.repeat(64), meta: { prefersBorder: true } }
  const app: ToolAppAttachment = { appInstanceId: 'view', status: 'result', binding: { node: 'node', session: SESSION.sessionId, server: 'CAD', configGeneration: 1, configFingerprint: 'cfg' }, origin: { providerSessionId: 'thread' }, resourceUri: 'ui://cad' }
  const host = { request: vi.fn(async (command: RemoteCommand) => {
    if (command.type !== 'mcp_app_request') throw new Error('Unexpected request')
    return { response: { ok: true, value: command.request.operation === 'load' && command.request.referenceOnly ? reference : { ...reference, html: 'saved' } } }
  }) }
  const request = { messageId: 'm', appInstanceId: 'view', operation: 'load' as const }
  expect(await requestMcpApp(host, SESSION, request, app)).toMatchObject({ value: { html: 'saved' } })
  const second = { ...app, appInstanceId: 'view-2', resource: { ...reference, meta: {} } }
  expect(await requestMcpApp(host, SESSION, { ...request, appInstanceId: second.appInstanceId }, second)).toMatchObject({ value: { html: 'saved', meta: {} } })
  expect(host.request).toHaveBeenCalledTimes(2)
  for (const [command] of host.request.mock.calls) {
    expect(command.type).toBe('mcp_app_request')
    if (command.type === 'mcp_app_request') expect(command.request).not.toHaveProperty('hash')
  }
  const changed = { ...second, binding: { ...second.binding, configFingerprint: 'changed' } }
  await requestMcpApp(host, SESSION, { ...request, appInstanceId: second.appInstanceId }, changed)
  expect(host.request).toHaveBeenCalledTimes(3)
})

it('single-flights phone hash loads, supports legacy inline hosts, and never caches a denied or mismatched result', async () => {
  const reference = { hash: 'a'.repeat(64), meta: {} }
  const app: ToolAppAttachment = { appInstanceId: 'view', status: 'result', binding: { node: 'node', session: SESSION.sessionId, server: 'CAD', configGeneration: 1, configFingerprint: 'cfg' }, resourceUri: 'ui://cad', resource: reference }
  const request = { messageId: 'm', appInstanceId: 'view', operation: 'load' as const }
  const host = client(async () => ({ response: { ok: true, value: { ...reference, html: 'saved' } } }))
  const [a, b] = await Promise.all([requestMcpApp(host, SESSION, request, app), requestMcpApp(host, SESSION, request, app)])
  expect(a).toEqual(b); expect(host.request).toHaveBeenCalledOnce()
  const legacy = client(async () => ({ response: { ok: true, value: { ...reference, html: 'legacy' } } }))
  expect(await requestMcpApp(legacy, SESSION, request, { ...app, resource: undefined })).toMatchObject({ value: { html: 'legacy' } })
  expect(legacy.request).toHaveBeenCalledOnce()
  for (const response of [{ ok: false, error: { code: 'denied', message: 'Session inaccessible' } }, { ok: true, value: { ...reference, hash: 'b'.repeat(64), html: 'wrong' } }]) {
    const failed = client(async () => ({ response }))
    expect(await requestMcpApp(failed, SESSION, request, app)).toMatchObject({ ok: false })
    expect(await requestMcpApp(failed, SESSION, request, app)).toMatchObject({ ok: false })
    expect(failed.request).toHaveBeenCalledTimes(2)
  }
})
