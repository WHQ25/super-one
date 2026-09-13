import { describe, expect, it, vi } from 'vitest'
import { clearHarnessResources, peekHarnessResource, preloadHarnessResources, refreshHarnessResources, requestHarnessResource } from './harness-resource-cache'
import { peekSlashCatalog, requestSlashCatalog } from './slash-catalog'

const makeClient = () => ({ request: vi.fn(async () => ({ models: [{ id: 'model' }] })) })

describe('connection harness resources', () => {
  it('preloads every harness once and shares requests with the shell and command catalog', async () => {
    const client = makeClient()
    await preloadHarnessResources(client, '/p', ['claude', 'codex', 'claude'])
    expect(client.request).toHaveBeenCalledTimes(4)
    expect(peekHarnessResource(client, 'get_system_info', '/p', 'codex')?.models).toHaveLength(1)
    // Served from the preloaded catalogs, so no new request. The host reported no
    // commands; `/add-dir` is the one this client injects for a harness that
    // accepts extra working roots.
    expect(peekSlashCatalog(client, '/p', 'codex')?.map((command) => command.name)).toEqual(['add-dir'])
    await requestSlashCatalog(client, '/p', 'codex')
    await requestHarnessResource(client, 'get_system_info', '/p', 'claude')
    expect(client.request).toHaveBeenCalledTimes(4)
  })

  it('coalesces pending requests and isolates devices and projects', async () => {
    const a = makeClient(), b = makeClient()
    await Promise.all([
      requestHarnessResource(a, 'get_system_info', '/p', 'claude'),
      requestHarnessResource(a, 'get_system_info', '/p', 'claude'),
      requestHarnessResource(a, 'get_system_info', '/other', 'claude'),
      requestHarnessResource(b, 'get_system_info', '/p', 'claude'),
    ])
    expect(a.request).toHaveBeenCalledTimes(2)
    expect(b.request).toHaveBeenCalledTimes(1)
  })

  it('retries host error responses instead of caching them', async () => {
    const client = { request: vi.fn().mockResolvedValueOnce({ error: 'offline' }).mockResolvedValue({ models: [] }) }
    await expect(requestHarnessResource(client, 'get_system_info', '/p', 'claude')).rejects.toThrow('offline')
    expect(peekHarnessResource(client, 'get_system_info', '/p', 'claude')).toBeUndefined()
    await requestHarnessResource(client, 'get_system_info', '/p', 'claude')
    expect(client.request).toHaveBeenCalledTimes(2)
  })

  it('refreshes known resources on reconnect and supports connection invalidation', async () => {
    const client = makeClient()
    await preloadHarnessResources(client, '/p', ['claude', 'codex'])
    const refreshing = refreshHarnessResources(client)
    // Stale-while-revalidate: the old value stays peekable until the refresh lands.
    expect(peekHarnessResource(client, 'get_system_info', '/p', 'claude')?.models).toHaveLength(1)
    await refreshing
    expect(client.request).toHaveBeenCalledTimes(8)
    clearHarnessResources(client)
    expect(peekSlashCatalog(client, '/p', 'claude')).toBeUndefined()
  })
})
