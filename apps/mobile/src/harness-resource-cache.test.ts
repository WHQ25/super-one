import { describe, expect, it, vi } from 'vitest'
import { clearHarnessResources, markHarnessResourcesStale, peekHarnessResource, preloadHarnessResources, refreshHarnessResources, requestHarnessResource } from './harness-resource-cache'
import { peekSlashCatalog, requestSlashCatalog } from './slash-catalog'

const makeClient = () => ({ resolveProject: async () => ({ environmentId: 'desk', projectId: 'p' }), rpc: vi.fn(async (..._args: unknown[]) => ({ models: [{ id: 'model' }] })) })

describe('connection harness resources', () => {
  it('forces an explicit refresh on the host and retains the displayed catalog on failure', async () => {
    const client = makeClient()
    await requestHarnessResource(client, 'get_system_info', '/p', 'opencode')
    client.rpc.mockRejectedValueOnce(new Error('offline'))
    await expect(requestHarnessResource(client, 'get_system_info', '/p', 'opencode', { force: true })).rejects.toThrow('offline')
    expect(client.rpc).toHaveBeenLastCalledWith('harness.systemInfo', expect.objectContaining({ harnessId: 'opencode', force: true }), { environmentId: 'desk' })
    expect(peekHarnessResource(client, 'get_system_info', '/p', 'opencode')?.models).toHaveLength(1)
    await requestHarnessResource(client, 'get_system_info', '/p', 'opencode', true)
    expect(client.rpc).toHaveBeenLastCalledWith('harness.systemInfo', expect.not.objectContaining({ force: true }), { environmentId: 'desk' })
  })

  it('marks unused catalogs stale without fetching them and keeps the warm value on revalidation failure', async () => {
    const client = makeClient()
    await requestHarnessResource(client, 'get_system_info', '/p', 'claude')
    markHarnessResourcesStale(client)
    expect(client.rpc).toHaveBeenCalledTimes(1)
    client.rpc.mockRejectedValueOnce(new Error('offline'))
    const value = await requestHarnessResource(client, 'get_system_info', '/p', 'claude')
    expect(value.models).toHaveLength(1)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(peekHarnessResource(client, 'get_system_info', '/p', 'claude')?.models).toHaveLength(1)
  })
  it('preloads every harness once and shares requests with the shell and command catalog', async () => {
    const client = makeClient()
    await preloadHarnessResources(client, '/p', ['claude', 'codex', 'claude'])
    expect(client.rpc).toHaveBeenCalledTimes(4)
    expect(peekHarnessResource(client, 'get_system_info', '/p', 'codex')?.models).toHaveLength(1)
    // Served from the preloaded catalogs, so no new request. The host reported
    // no commands; these two are the ones this client injects for a harness that
    // accepts extra working roots and has a session goal.
    expect(peekSlashCatalog(client, '/p', 'codex')?.map((command) => command.name)).toEqual(['add-dir', 'goal'])
    await requestSlashCatalog(client, '/p', 'codex')
    await requestHarnessResource(client, 'get_system_info', '/p', 'claude')
    expect(client.rpc).toHaveBeenCalledTimes(4)
  })

  it('coalesces pending requests and isolates devices and projects', async () => {
    const a = makeClient(), b = makeClient()
    await Promise.all([
      requestHarnessResource(a, 'get_system_info', '/p', 'claude'),
      requestHarnessResource(a, 'get_system_info', '/p', 'claude'),
      requestHarnessResource(a, 'get_system_info', '/other', 'claude'),
      requestHarnessResource(b, 'get_system_info', '/p', 'claude'),
    ])
    expect(a.rpc).toHaveBeenCalledTimes(2)
    expect(b.rpc).toHaveBeenCalledTimes(1)
  })

  it('retries host error responses instead of caching them', async () => {
    const client = { resolveProject: makeClient().resolveProject, rpc: vi.fn().mockResolvedValueOnce({ error: 'offline' }).mockResolvedValue({ models: [] }) }
    await expect(requestHarnessResource(client, 'get_system_info', '/p', 'claude')).rejects.toThrow('offline')
    expect(peekHarnessResource(client, 'get_system_info', '/p', 'claude')).toBeUndefined()
    await requestHarnessResource(client, 'get_system_info', '/p', 'claude')
    expect(client.rpc).toHaveBeenCalledTimes(2)
  })

  it('refreshes known resources on reconnect and supports connection invalidation', async () => {
    const client = makeClient()
    await preloadHarnessResources(client, '/p', ['claude', 'codex'])
    const refreshing = refreshHarnessResources(client)
    // Stale-while-revalidate: the old value stays peekable until the refresh lands.
    expect(peekHarnessResource(client, 'get_system_info', '/p', 'claude')?.models).toHaveLength(1)
    await refreshing
    expect(client.rpc).toHaveBeenCalledTimes(8)
    clearHarnessResources(client)
    expect(peekSlashCatalog(client, '/p', 'claude')).toBeUndefined()
  })
})
