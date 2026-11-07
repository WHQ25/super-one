import { describe, expect, it } from 'vitest'
import { dispatchRpc, type RpcContext } from './handlers'

describe('headless mention catalog', () => {
  const context = (scopes: string[]) => ({
    client: { scopes }, identity: { environmentId: 'node-b', label: 'Build node' },
    projects: { get: (id: string) => id === 'p1' ? { projectId: id, path: '/repo' } : null },
  }) as unknown as RpcContext

  it('advertises its own environment and no controller desktop apps or capabilities', async () => {
    expect(await dispatchRpc('workspace.mentionCatalog', { projectId: 'p1' }, context(['workspace:read']))).toEqual({ result: {
      capabilityIds: [], apps: [], environments: [{ role: 'local', id: 'node-b', label: 'Build node', status: 'connected' }],
    } })
  })
  it('requires workspace:read access', async () => {
    expect(await dispatchRpc('workspace.mentionCatalog', { projectId: 'p1' }, context([]))).toMatchObject({ error: { code: 'forbidden' } })
  })
})
