import { describe, expect, it, vi } from 'vitest'
import type { McpAppsProviderRpcRequest } from '@superone/shared/environment/mcp-apps-rpc'

const remote = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ ipcMain: {}, shell: {} }))
vi.mock('../environment/environment-host', () => ({ getEnvironmentHost: () => ({ requestMcpAppsProvider: remote }) }))
import { routeMcpAppsProviderRequest } from './provider-ipc'

const input: McpAppsProviderRpcRequest = { binding: { node: 'node', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' }, origin: { providerSessionId: 'thread' }, operation: 'callTool', tool: 'next_page', args: {} }

describe('MCP App provider routing errors', () => {
  it('passes a definite remote provider rejection through unchanged', async () => {
    const response = { ok: false, error: { code: 'not_connected', message: 'Server disconnected before dispatch' } }
    remote.mockResolvedValueOnce(response)
    expect(await routeMcpAppsProviderRequest(() => null, 'connection', input, undefined, { propagateTransportErrors: true })).toBe(response)
  })

  it('lets the executor distinguish transport loss from server-originated RPC errors', async () => {
    const lost = Object.assign(new Error('socket lost'), { transport: true })
    remote.mockRejectedValueOnce(lost)
    await expect(routeMcpAppsProviderRequest(() => null, 'connection', input, undefined, { propagateTransportErrors: true })).rejects.toBe(lost)
    remote.mockRejectedValueOnce(Object.assign(new Error('Invalid control lease'), { transport: false, rpcError: true }))
    expect(await routeMcpAppsProviderRequest(() => null, 'connection', input, undefined, { propagateTransportErrors: true })).toMatchObject({ ok: false, error: { code: 'not_connected', message: 'Invalid control lease' } })
  })

  it('keeps the public provider IPC result structured for transport failures', async () => {
    remote.mockRejectedValueOnce(Object.assign(new Error('socket lost'), { transport: true }))
    expect(await routeMcpAppsProviderRequest(() => null, 'connection', input)).toMatchObject({ ok: false, error: { code: 'not_connected' } })
  })
})
