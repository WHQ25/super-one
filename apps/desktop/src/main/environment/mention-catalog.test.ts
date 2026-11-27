import { describe, expect, it, vi } from 'vitest'
import { EnvironmentHost } from './environment-host'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'
import type { NodeRpcClient } from './node-rpc-client'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/mention-catalog-test' } }))

describe('remote mention catalog', () => {
  it('resolves project identity and reads apps and capabilities from that connection only', async () => {
    const catalog = { capabilityIds: ['browser'], apps: [{ kind: 'miniapp', path: 'remote-board', label: 'Remote board' }] }
    const rpc = vi.fn(async (method: string) => {
      if (method === 'workspace.mentionCatalog') return catalog
      throw new Error(`unexpected RPC ${method}`)
    })
    const gateway = new RemoteEnvironmentGateway({ rpc } as unknown as NodeRpcClient)
    const host = Object.create(EnvironmentHost.prototype) as EnvironmentHost
    Object.assign(host, {
      connections: { listKnown: () => [{ connectionId: 'node-b', environmentId: 'env-b' }], getGateway: () => gateway },
      listProjects: vi.fn(async () => [{ projectId: 'b-project', path: '/repo' }]),
      getGateway: () => gateway,
    })
    expect(await host.getMentionCatalog('remote:node-b:/repo')).toEqual(catalog)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('workspace.mentionCatalog', { projectId: 'b-project' })
  })

  it('does not fall back to local discovery when the node is offline', async () => {
    const host = Object.create(EnvironmentHost.prototype) as EnvironmentHost
    Object.assign(host, {
      connections: { listKnown: () => [{ connectionId: 'node-b', environmentId: 'env-b' }], getGateway: () => null },
      listProjects: vi.fn(async () => { throw new Error('offline') }),
    })
    await expect(host.getMentionCatalog('remote:node-b:/repo')).rejects.toThrow('offline')
  })

  it('uses cached remote descriptors without dialing RPC when cachedDescriptorsOnly is set', async () => {
    const rpc = vi.fn(async (method: string) => {
      throw new Error(`unexpected RPC ${method}`)
    })
    const gateway = new RemoteEnvironmentGateway({ rpc } as unknown as NodeRpcClient)
    gateway.rememberDescriptor({
      environmentId: 'env-b',
      label: 'Build node',
      platform: { os: 'linux', arch: 'arm64' },
      nodeVersion: '22.0.0',
      cliVersion: '0.1.0',
      protocolVersion: 1,
      capabilities: { methods: [], harnessIds: [] },
      generations: { protocol: { current: 1, min: 1 }, databaseSchema: { current: 1, min: 1 } },
    } as never)

    const host = Object.create(EnvironmentHost.prototype) as EnvironmentHost
    Object.assign(host, {
      localDisplayName: 'This Mac',
      registry: {
        getLocal: () => ({
          getDescriptor: async () => ({
            environmentId: 'env-local',
            label: 'This Mac',
            platform: { os: 'darwin', arch: 'arm64' },
            nodeVersion: '22.0.0',
            protocolVersion: 1,
            capabilities: { methods: [], harnessIds: [] },
          }),
        }),
      },
      connections: {
        listKnown: () => [{
          connectionId: 'node-b',
          environmentId: 'env-b',
          label: 'Build node',
          endpointProfiles: [],
          updatedAt: '2026-11-27T00:00:00Z',
        }],
        getGateway: () => gateway,
        getSupervisor: () => ({ state: 'connected' }),
        getActivePath: () => null,
        updateKnown: vi.fn(),
      },
      lastStatus: new Map(),
      credentials: { isSecureStorageAvailable: () => true },
      nodeUpgradeFor: () => undefined,
    })

    const items = await host.listEnvironments({ includeDescriptors: true, cachedDescriptorsOnly: true })
    const remote = items.find((item) => item.environmentId === 'env-b')
    expect(remote?.cliVersion).toBe('0.1.0')
    expect(rpc).not.toHaveBeenCalled()
  })
})
