import { describe, expect, it, vi } from 'vitest'
const probe = vi.hoisted(() => vi.fn(async () => [{ id: 'grok-live', name: 'Grok Live', description: '' }]))
vi.mock('@superone/acp/model-catalog', () => ({ probeAcpModels: probe }))
vi.mock('./acp-launch', () => ({ resolveProductionAcpLaunch: () => ({ binaryPath: '/fake/grok', args: ['agent', 'stdio'], agentId: 'grok-build' }) }))
import { listNodeLiveHarnessModels } from './harness-model-catalog'
import type { ProviderStore } from '../provider/provider-store'

describe('node ACP catalog discovery', () => {
  it('queries the node ACP agent instead of returning a Default-only catalog', async () => {
    const store = { listBindings: () => [], listCustomPlatforms: () => [] } as unknown as ProviderStore
    const models = await listNodeLiveHarnessModels({ store, harness: 'acp', apiProviderId: null })
    expect(models).toEqual([{ id: 'grok-live', name: 'Grok Live', description: '' }])
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ launch: {
      command: '/fake/grok', args: ['agent', 'stdio'], agentId: 'grok-build',
    } }))
  })
})
