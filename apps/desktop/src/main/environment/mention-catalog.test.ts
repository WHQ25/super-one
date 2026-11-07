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
})
