import { expect, it, vi } from 'vitest'
import { PhoneProjectCatalog } from './project-catalog'

it('resolves exact registered paths and never invents a project id from a path', async () => {
  const rpc = vi.fn(async () => [{ projectId: 'p1', path: '/app' }])
  const catalog = new PhoneProjectCatalog(rpc as never, () => 'desk')
  expect(await catalog.resolve('/app')).toEqual({ environmentId: 'desk', projectId: 'p1' })
  await expect(catalog.resolve('/other')).rejects.toMatchObject({ code: 'not_found' })
  expect(rpc).toHaveBeenCalledWith('project.list', {}, { environmentId: 'desk' })
  await catalog.resolve('/app')
  expect(rpc).toHaveBeenCalledTimes(3)
})
it('refreshes a cached catalog once when another surface registers a new project', async () => {
  const projects = [{ projectId: 'p1', path: '/app' }]
  const rpc = vi.fn(async () => projects.slice())
  const catalog = new PhoneProjectCatalog(rpc as never, () => 'desk')
  await catalog.resolve('/app')
  projects.push({ projectId: 'p2', path: '/new' })
  expect(await catalog.resolve('/new')).toEqual({ environmentId: 'desk', projectId: 'p2' })
  expect(rpc).toHaveBeenCalledTimes(2)
})
it('resolves a routed shell key only through the paired environment catalog', async () => {
  const rpc = vi.fn(async (method: string) => method === 'environment.list'
    ? { environments: [{ connectionId: 'paired-node', environmentId: 'canonical-node' }] }
    : [{ projectId: 'node-p', path: '/app' }])
  const catalog = new PhoneProjectCatalog(rpc as never, () => 'desk')
  expect(await catalog.resolve('remote:paired-node:/app')).toEqual({ environmentId: 'canonical-node', projectId: 'node-p' })
  expect(rpc).toHaveBeenCalledWith('project.list', {}, { environmentId: 'canonical-node' })
  await expect(catalog.resolve('remote:unpaired:/app')).rejects.toMatchObject({ code: 'not_found' })
  expect(rpc.mock.calls.filter(([method]) => method === 'project.list')).toHaveLength(1)
})
it('forgets a failed catalog read and rereads after the channel changes', async () => {
  const rpc = vi.fn().mockRejectedValueOnce(new Error('closed')).mockResolvedValue([{ projectId: 'p', path: '/app' }])
  const catalog = new PhoneProjectCatalog(rpc, () => 'desk')
  await expect(catalog.resolve('/app')).rejects.toThrow('closed')
  await catalog.resolve('/app'); catalog.invalidate(); await catalog.resolve('/app')
  expect(rpc).toHaveBeenCalledTimes(3)
})
