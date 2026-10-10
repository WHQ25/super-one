import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { describe, expect, it, vi } from 'vitest'
import type { McpAppDeviceRequest } from '@superone/shared/agent-types'
import type { SessionRef } from '@superone/shared/environment/refs'
import { parseMcpAppRequest, requestMcpApp } from './mcp-apps'

const SESSION = { projectPath: '/Users/me/proj', sessionId: 'sess-1' }
const CALL: McpAppDeviceRequest = { messageId: 'm', appInstanceId: 'view-1', operation: 'callTool', tool: 'fixture_next_page', args: { page: 2 } }
const READ: McpAppDeviceRequest = { messageId: 'm', appInstanceId: 'view-1', operation: 'readResource', uri: 'ui://fixture/items.html' }

function client(answer: () => Promise<unknown>) {
  return { environmentId: 'desk', rpc: vi.fn(async (_method: string, _payload?: unknown, _options?: unknown) => answer()), controlledRpc: vi.fn(async (_session: SessionRef, _method: string, _payload?: unknown, _options?: unknown) => answer()) }
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
    const host = client(async () => response)
    await expect(requestMcpApp(host, SESSION, CALL)).resolves.toBe(response)
    const [session, method, payload, options] = host.controlledRpc.mock.calls[0]!
    expect(session).toEqual({ environmentId: 'desk', sessionId: SESSION.sessionId })
    expect(method).toBe('mcpApps.request')
    expect(payload).toEqual({ request: CALL })
    // Longer than the document's own 120 s, so the document classifies a slow call.
    expect(options).toEqual({ timeoutMs: 125_000 })
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
    await expect(requestMcpApp(client(async () => { throw Object.assign(new Error('Session sess-1 does not belong to project /x'), { code: 'forbidden' }) }), SESSION, READ))
      .resolves.toMatchObject({ ok: false, error: { code: 'denied', message: 'Session sess-1 does not belong to project /x' } })
  })
})


it('fetches HTML once per authorized hash across Views, retaining each reference metadata', async () => {
  const reference = { hash: 'a'.repeat(64), meta: { prefersBorder: true } }
  const app: ToolAppAttachment = { appInstanceId: 'view', status: 'result', binding: { node: 'node', session: SESSION.sessionId, server: 'CAD', configGeneration: 1, configFingerprint: 'cfg' }, origin: { providerSessionId: 'thread' }, resourceUri: 'ui://cad' }
  const host = client(async () => ({}))
  host.rpc.mockImplementation(async (method, payload) => {
    expect(method).toBe('mcpApps.request')
    const command = payload as { request: McpAppDeviceRequest }
    return { ok: true, value: command.request.operation === 'load' && command.request.referenceOnly ? reference : { ...reference, html: 'saved' } }
  })
  const request = { messageId: 'm', appInstanceId: 'view', operation: 'load' as const }
  expect(await requestMcpApp(host, SESSION, request, app)).toMatchObject({ value: { html: 'saved' } })
  const second = { ...app, appInstanceId: 'view-2', resource: { ...reference, meta: {} } }
  expect(await requestMcpApp(host, SESSION, { ...request, appInstanceId: second.appInstanceId }, second)).toMatchObject({ value: { html: 'saved', meta: {} } })
  expect(host.rpc).toHaveBeenCalledTimes(2)
  for (const [method, payload] of host.rpc.mock.calls) {
    expect(method).toBe('mcpApps.request')
    expect((payload as { request: unknown }).request).not.toHaveProperty('hash')
  }
  const changed = { ...second, binding: { ...second.binding, configFingerprint: 'changed' } }
  await requestMcpApp(host, SESSION, { ...request, appInstanceId: second.appInstanceId }, changed)
  expect(host.rpc).toHaveBeenCalledTimes(3)
})

it('single-flights phone hash loads, supports inline saved resources, and never caches a denied or mismatched result', async () => {
  const reference = { hash: 'a'.repeat(64), meta: {} }
  const app: ToolAppAttachment = { appInstanceId: 'view', status: 'result', binding: { node: 'node', session: SESSION.sessionId, server: 'CAD', configGeneration: 1, configFingerprint: 'cfg' }, resourceUri: 'ui://cad', resource: reference }
  const request = { messageId: 'm', appInstanceId: 'view', operation: 'load' as const }
  const host = client(async () => ({ ok: true, value: { ...reference, html: 'saved' } }))
  const [a, b] = await Promise.all([requestMcpApp(host, SESSION, request, app), requestMcpApp(host, SESSION, request, app)])
  expect(a).toEqual(b); expect(host.rpc).toHaveBeenCalledOnce()
  const legacy = client(async () => ({ ok: true, value: { ...reference, html: 'legacy' } }))
  expect(await requestMcpApp(legacy, SESSION, request, { ...app, resource: undefined })).toMatchObject({ value: { html: 'legacy' } })
  expect(legacy.rpc).toHaveBeenCalledOnce()
  for (const response of [{ ok: false, error: { code: 'denied', message: 'Session inaccessible' } }, { ok: true, value: { ...reference, hash: 'b'.repeat(64), html: 'wrong' } }]) {
    const failed = client(async () => response)
    expect(await requestMcpApp(failed, SESSION, request, app)).toMatchObject({ ok: false })
    expect(await requestMcpApp(failed, SESSION, request, app)).toMatchObject({ ok: false })
    expect(failed.rpc).toHaveBeenCalledTimes(2)
  }
})
