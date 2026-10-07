import { expect, it, vi } from 'vitest'
import type { EnvironmentHost } from '../environment/environment-host'
import { routedResources } from './environment-session-resources'

it('loads the target node catalog and preserves its session model and defaults', async () => {
  const host = { getRemoteHarnessResources: vi.fn().mockResolvedValue({ codex: { models: [{ id: 'node-model' }], prompts: [] } }), listRemoteModels: vi.fn(), getRemoteSessionProvider: vi.fn().mockResolvedValue({ config: {} }) }
  const result = await routedResources(host as unknown as EnvironmentHost, 'route', { projectId: 'p', harnessId: 'codex', providerId: 'codex-base', apiProviderId: 'node-credential', model: 'node-model', effort: 'high', permissionMode: 'auto' }, '/node/app', 'get_system_info')
  expect(host.getRemoteHarnessResources).toHaveBeenCalledWith('route', { projectId: 'p', harnessId: 'codex', apiProviderId: 'node-credential' })
  expect(result).toMatchObject({ models: [{ id: 'node-model' }], defaults: { model: 'node-model', effort: 'high', permissionMode: 'auto' } })
  expect(host.listRemoteModels).not.toHaveBeenCalled()
})
