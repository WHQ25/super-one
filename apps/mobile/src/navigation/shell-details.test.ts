import { describe, expect, it, vi } from 'vitest'
import type { RelayClient } from '@superone/relay-client'
import { resolveTestProject } from '../project-rpc.test-fixtures'
import { fetchShellDetails } from './shell-details'

function stubClient() {
  const request = vi.fn(async (method: string) => {
    if (method === 'harness.systemInfo') return { models: [], defaults: { effort: 'high' } }
    if (method === 'harness.projectResources') return { workspaceDirs: [] }
    return null
  })
  return { client: { rpc: request, resolveProject: resolveTestProject } as unknown as RelayClient, request }
}

const systemInfoCalls = (request: { mock: { calls: [string, ...unknown[]][] } }) =>
  request.mock.calls.filter(([method]) => method === 'harness.systemInfo').length

describe('fetchShellDetails', () => {
  it('serves the harness catalog from the per-connection cache by default', async () => {
    const { client, request } = stubClient()

    await fetchShellDetails(client, '/repo', 'claude')
    await fetchShellDetails(client, '/repo', 'claude')

    expect(systemInfoCalls(request)).toBe(1)
  })

  /**
   * The catalog carries the desktop's configured defaults and the cache has no
   * TTL, so a default changed on the desktop would never reach a phone that
   * stayed connected. Configuring a new session is where those defaults are read.
   */
  it('re-fetches the catalog when the caller is about to read the host defaults', async () => {
    const { client, request } = stubClient()

    await fetchShellDetails(client, '/repo', 'claude')
    await fetchShellDetails(client, '/repo', 'claude', true)

    expect(systemInfoCalls(request)).toBe(2)
  })

  it('leaves the other project resources on the cache when the catalog refreshes', async () => {
    const { client, request } = stubClient()

    await fetchShellDetails(client, '/repo', 'claude')
    await fetchShellDetails(client, '/repo', 'claude', true)

    const resourceCalls = request.mock.calls
      .filter(([method]) => method === 'harness.projectResources').length
    expect(resourceCalls).toBe(1)
  })
})
