import { describe, expect, it, vi } from 'vitest'
import type { RelayClient } from '@superone/relay-client'
import { fetchShellDetails } from './shell-details'

function stubClient() {
  const request = vi.fn(async (command: { type: string }) => {
    if (command.type === 'get_system_info') return { models: [], defaults: { effort: 'high' } }
    if (command.type === 'get_project_resources') return { workspaceDirs: [] }
    return null
  })
  return { client: { request } as unknown as RelayClient, request }
}

const systemInfoCalls = (request: { mock: { calls: [{ type: string }][] } }) =>
  request.mock.calls.filter(([command]) => command.type === 'get_system_info').length

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
      .filter(([command]) => command.type === 'get_project_resources').length
    expect(resourceCalls).toBe(1)
  })
})
