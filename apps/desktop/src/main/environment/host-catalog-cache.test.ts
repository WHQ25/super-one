import { describe, expect, it, vi } from 'vitest'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'
import type { NodeRpcClient } from './node-rpc-client'
import type { ExecutionEnvironmentDescriptor } from '@superone/shared/environment'

const descriptor = { environmentId: 'env-1', label: 'b' } as ExecutionEnvironmentDescriptor
const syncDescriptor: ExecutionEnvironmentDescriptor = {
  environmentId: 'env-1',
  label: 'node',
  platform: { os: 'linux', arch: 'x64' },
  nodeVersion: 'v22.0.0',
  protocolVersion: 1,
  syncRoot: '/home/node/.superone/node/sync',
  capabilities: {
    methods: ['artifact.put'],
    harnessIds: ['claude'],
    coldSessionResume: true,
    turnReattach: false,
    hostActionV1: true,
  },
}

function gateway() {
  const getDescriptor = vi.fn(async () => descriptor)
  const rpc = vi.fn(async (method: string) => ({ method }))
  const client = { getDescriptor, rpc } as unknown as NodeRpcClient
  return { gw: new RemoteEnvironmentGateway(client), getDescriptor, rpc }
}

describe('RemoteEnvironmentGateway descriptor cache', () => {
  it('keeps sync identity and capability gates across the 60-second refresh boundary', async () => {
    vi.useFakeTimers()
    try {
      const { gw, getDescriptor, rpc } = gateway()
      gw.rememberDescriptor(syncDescriptor)
      const zone = { syncRoot: syncDescriptor.syncRoot, os: 'linux' }
      vi.advanceTimersByTime(59_999)
      expect(gw.syncZone()).toEqual(zone)
      expect(gw.drafts).toBeUndefined()
      vi.advanceTimersByTime(1)
      expect(gw.syncZone()).toEqual(zone)
      expect(gw.cachedDescriptor).toBe(syncDescriptor)
      expect(gw.drafts).toBeUndefined()
      await expect(gw.providerExportBundle()).rejects.toMatchObject({ code: 'failed_precondition' })
      vi.advanceTimersByTime(60_000)
      expect(gw.syncZone()).toEqual(zone)
      expect(getDescriptor).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
      gw.clearDescriptor()
      expect(gw.cachedDescriptor).toBeNull()
      expect(gw.syncZone()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts harness catalog events after the descriptor refresh deadline', () => {
    vi.useFakeTimers()
    try {
      const { gw, getDescriptor } = gateway()
      gw.rememberDescriptor(syncDescriptor)
      vi.advanceTimersByTime(60_001)
      gw.replaceAdvertisedHarnesses(['codex'])
      expect(gw.cachedDescriptor?.capabilities.harnessIds).toEqual(['codex'])
      expect(gw.syncZone()?.syncRoot).toBe(syncDescriptor.syncRoot)
      expect(getDescriptor).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the connection snapshot during refresh failures and replaces it on success', async () => {
    const { gw, getDescriptor } = gateway()
    gw.rememberDescriptor(syncDescriptor)
    let reject: (reason: Error) => void = () => {}
    getDescriptor.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    const refresh = gw.refreshDescriptor()
    expect(gw.cachedDescriptor).toBe(syncDescriptor)
    reject(new Error('temporarily unavailable'))
    await expect(refresh).rejects.toThrow('temporarily unavailable')
    expect(gw.cachedDescriptor).toBe(syncDescriptor)
    const next = { ...syncDescriptor, syncRoot: '/new/sync' }
    getDescriptor.mockResolvedValueOnce(next)
    await expect(gw.getDescriptor()).resolves.toBe(next)
    expect(gw.syncZone()).toEqual({ syncRoot: '/new/sync', os: 'linux' })
  })

  it('does not let an older fetch overwrite a remembered connection snapshot', async () => {
    const { gw, getDescriptor } = gateway()
    let resolve: (value: ExecutionEnvironmentDescriptor) => void = () => {}
    getDescriptor.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const old = gw.getDescriptor()
    const next = { ...syncDescriptor, syncRoot: '/new/sync' }
    gw.rememberDescriptor(next)
    resolve(syncDescriptor)
    await old
    expect(gw.cachedDescriptor).toBe(next)
    expect(gw.syncZone()?.syncRoot).toBe('/new/sync')
  })

  it('revokes a previously supported sync zone when a new descriptor removes it', async () => {
    const { gw, getDescriptor } = gateway()
    gw.rememberDescriptor(syncDescriptor)
    getDescriptor.mockResolvedValueOnce({
      ...syncDescriptor,
      capabilities: { ...syncDescriptor.capabilities, methods: [] },
    })
    await gw.refreshDescriptor()
    expect(gw.syncZone()).toBeNull()
    getDescriptor.mockResolvedValueOnce({ ...syncDescriptor, syncRoot: undefined })
    await gw.refreshDescriptor()
    expect(gw.syncZone()).toBeNull()
  })

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
    resolve(syncDescriptor)
    await expect(first).resolves.toBe(syncDescriptor)
    await expect(second).resolves.toBe(syncDescriptor)
    expect(getDescriptor).toHaveBeenCalledTimes(1)
    expect(gw.cachedDescriptor).toBeNull()
    expect(gw.syncZone()).toBeNull()
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

  it('a forced account read does not join an ordinary in-flight read', async () => {
    const { gw, rpc } = gateway()
    let releaseOrdinary: (value: unknown) => void = () => {}
    rpc.mockImplementation((method: string, payload?: { force?: boolean }) => {
      if (method === 'claude.listAccounts' && !payload?.force) {
        return new Promise((resolve) => { releaseOrdinary = resolve })
      }
      return Promise.resolve({ method, payload })
    })
    const ordinary = gw.claudeListAccounts()
    const forced = gw.claudeListAccounts(true)
    releaseOrdinary({ accounts: ['stale'] })
    await expect(ordinary).resolves.toEqual({ accounts: ['stale'] })
    await expect(forced).resolves.toEqual({ method: 'claude.listAccounts', payload: { force: true } })
    await expect(gw.claudeListAccounts()).resolves.toEqual({ method: 'claude.listAccounts', payload: { force: true } })
    expect(rpc.mock.calls.filter((call) => call[0] === 'claude.listAccounts')).toHaveLength(2)
  })

  it('refreshes claude accounts after their ttl and keeps other lists', async () => {
    vi.useFakeTimers()
    try {
      const { gw, rpc } = gateway()
      await gw.claudeListAccounts()
      await gw.providerListCredentials()
      vi.advanceTimersByTime(60_000)
      await gw.claudeListAccounts()
      await gw.providerListCredentials()
      expect(rpc.mock.calls.filter((call) => call[0] === 'claude.listAccounts')).toHaveLength(2)
      expect(rpc.mock.calls.filter((call) => call[0] === 'provider.listCredentials')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-reads a descriptor after its ttl', async () => {
    vi.useFakeTimers()
    try {
      const { gw, getDescriptor } = gateway()
      gw.rememberDescriptor(syncDescriptor)
      await gw.getDescriptor()
      expect(getDescriptor).not.toHaveBeenCalled()
      const next = { ...syncDescriptor, syncRoot: '/refreshed/sync' }
      getDescriptor.mockResolvedValueOnce(next)
      vi.advanceTimersByTime(60_000)
      expect(gw.syncZone()?.syncRoot).toBe(syncDescriptor.syncRoot)
      await expect(gw.getDescriptor()).resolves.toBe(next)
      expect(getDescriptor).toHaveBeenCalledTimes(1)
      expect(gw.syncZone()?.syncRoot).toBe(next.syncRoot)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops the catalog when asked', async () => {
    const { gw, rpc } = gateway()
    await gw.providerListCredentials()
    gw.invalidateHostCatalog()
    await gw.providerListCredentials()
    expect(rpc.mock.calls.filter((call) => call[0] === 'provider.listCredentials')).toHaveLength(2)
  })
})
