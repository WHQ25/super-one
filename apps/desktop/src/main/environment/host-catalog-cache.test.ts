import { describe, expect, it, vi } from 'vitest'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'
import type { NodeRpcClient } from './node-rpc-client'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment'

const descriptor = { environmentId: 'env-1', label: 'b' } as ExecutionEnvironmentDescriptor

function gateway() {
  const getDescriptor = vi.fn(async () => descriptor)
  const rpc = vi.fn(async (method: string) => ({ method }))
  const client = { getDescriptor, rpc } as unknown as NodeRpcClient
  return { gw: new RemoteEnvironmentGateway(client), getDescriptor, rpc }
}

describe('RemoteEnvironmentGateway descriptor cache', () => {
  it('returns a remembered descriptor without dialing again', async () => {
    const { gw, getDescriptor } = gateway()
    gw.rememberDescriptor(descriptor)
    await expect(gw.getDescriptor()).resolves.toBe(descriptor)
    await gw.getDescriptor()
    expect(getDescriptor).not.toHaveBeenCalled()
    expect(gw.cachedDescriptor).toBe(descriptor)
  })

  it('shares one refresh and drops it when the socket clears mid-fetch', async () => {
    const { gw, getDescriptor } = gateway()
    let resolve: (value: ExecutionEnvironmentDescriptor) => void = () => {}
    getDescriptor.mockReturnValue(new Promise((done) => { resolve = done }))
    const first = gw.refreshDescriptor()
    const second = gw.getDescriptor()
    gw.clearDescriptor()
    resolve(descriptor)
    await expect(first).resolves.toBe(descriptor)
    await expect(second).resolves.toBe(descriptor)
    expect(getDescriptor).toHaveBeenCalledTimes(1)
    expect(gw.cachedDescriptor).toBeNull()
    await gw.getDescriptor()
    expect(getDescriptor).toHaveBeenCalledTimes(2)
  })
})

describe('RemoteEnvironmentGateway host catalog', () => {
  it('reuses credential and account lists until a mutation or a forced read', async () => {
    const { gw, rpc } = gateway()
    await gw.providerListCredentials()
    await gw.providerListCredentials()
    await gw.providerListBindings()
    await gw.providerListCustomPlatforms()
    await gw.claudeListAccounts()
    await gw.claudeListAccounts()
    expect(rpc).toHaveBeenCalledTimes(4)

    await gw.claudeListAccounts(true)
    expect(rpc).toHaveBeenLastCalledWith('claude.listAccounts', { force: true })

    await gw.providerCreateCredential({ name: 'new' })
    await gw.providerListCredentials()
    await gw.providerListBindings()
    expect(rpc.mock.calls.filter((call) => call[0] === 'provider.listCredentials')).toHaveLength(2)
    expect(rpc.mock.calls.filter((call) => call[0] === 'provider.listBindings')).toHaveLength(2)
  })

  it('drops the catalog when asked', async () => {
    const { gw, rpc } = gateway()
    await gw.providerListCredentials()
    gw.invalidateHostCatalog()
    await gw.providerListCredentials()
    expect(rpc.mock.calls.filter((call) => call[0] === 'provider.listCredentials')).toHaveLength(2)
  })
})
