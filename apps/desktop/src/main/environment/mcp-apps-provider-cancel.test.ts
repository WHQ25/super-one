import { describe, expect, it, vi } from 'vitest'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'
import type { NodeRpcClient } from './node-rpc-client'

const input = { binding: { node: 'node', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'c' }, origin: { providerSessionId: 'thread' },
  operation: 'callTool' as const, tool: 'pick', args: {}, leaseId: 'l', generation: 'g' }

function gateway() {
  let finish!: (value: unknown) => void
  const rpc = vi.fn((method: string, _payload?: unknown) => method === 'mcpApps.provider' ? new Promise(resolve => { finish = resolve }) : Promise.resolve(null))
  return { gw: new RemoteEnvironmentGateway({ rpc } as unknown as NodeRpcClient), rpc, finish: (value: unknown) => finish(value) }
}

describe('RemoteEnvironmentGateway MCP App provider cancellation', () => {
  it('tells the node to cancel the same invocation when the View aborts', async () => {
    const { gw, rpc, finish } = gateway()
    const abort = new AbortController()
    const pending = gw.requestMcpAppsProvider(input, abort.signal)
    const { invocationId } = rpc.mock.calls[0][1] as { invocationId: string }
    expect(invocationId).toEqual(expect.any(String))
    abort.abort()
    expect(rpc).toHaveBeenCalledWith('mcpApps.cancel', { invocationId })
    finish({ ok: false, error: { code: 'cancelled', message: 'cancelled' } })
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('sends no cancel once the request has settled', async () => {
    const { gw, rpc, finish } = gateway()
    const abort = new AbortController()
    const pending = gw.requestMcpAppsProvider(input, abort.signal)
    finish({ ok: true, value: {} })
    await pending
    abort.abort()
    expect(rpc.mock.calls.map(([method]) => method)).toEqual(['mcpApps.provider'])
  })

  it('does not send a request that is already cancelled', async () => {
    const { gw, rpc } = gateway()
    await expect(gw.requestMcpAppsProvider(input, AbortSignal.abort())).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(rpc).not.toHaveBeenCalled()
  })
})
