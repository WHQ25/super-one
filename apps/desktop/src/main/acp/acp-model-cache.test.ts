import { describe, it, expect, vi, beforeEach } from 'vitest'

const cacheStore = new Map<string, unknown>()

vi.mock('../database', () => ({
  getCachedHarnessResources: (id: string) => cacheStore.get(id) ?? null,
  setCachedHarnessResources: (id: string, value: unknown) => { cacheStore.set(id, value) },
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('./acp-runtime', () => ({
  createAcpRuntime: vi.fn(async () => ({
    sessionId: 's',
    launch: { agentId: 'opencode', command: 'opencode', args: ['acp'], env: {}, cwd: '/' },
    getConfigOptions: () => [],
    getModelConfig: () => ({
      configId: 'model',
      selectedModelId: 'opencode/big-pickle',
      models: [
        { id: 'opencode/big-pickle', name: 'Big Pickle', description: '' },
        { id: 'openai/gpt-5.4', name: 'GPT-5.4', description: '' },
      ],
    }),
    setConfigOption: async () => [],
    prompt: async () => {},
    cancel: async () => {},
    close: async () => {},
  })),
}))

import {
  readAcpResourcesCache,
  writeAcpResourcesCache,
  refreshAcpModelsOnce,
  upsertAcpAgentModels,
  resetAcpModelProbeStateForTests,
} from './acp-model-cache'

describe('acp-model-cache', () => {
  beforeEach(() => {
    cacheStore.clear()
    resetAcpModelProbeStateForTests()
  })

  it('upserts models into cache', () => {
    writeAcpResourcesCache({
      agents: [{ id: 'opencode', name: 'OpenCode', installed: true, commandPreview: 'opencode acp' }],
      selectedAgentId: 'opencode',
      modelsByAgentId: {},
    })
    upsertAcpAgentModels('opencode', {
      configId: 'model',
      selectedModelId: 'a',
      models: [{ id: 'a', name: 'A', description: '' }],
    })
    const cached = readAcpResourcesCache()
    expect(cached.modelsByAgentId?.opencode?.models).toEqual([
      { id: 'a', name: 'A', description: '' },
    ])
  })

  it('probes each agent only once per launch', async () => {
    writeAcpResourcesCache({
      agents: [
        { id: 'opencode', name: 'OpenCode', installed: true, commandPreview: 'opencode acp' },
        { id: 'grok-build', name: 'Grok Build', installed: false, commandPreview: 'grok agent stdio' },
      ],
      selectedAgentId: null,
      modelsByAgentId: {},
    })
    const first = await refreshAcpModelsOnce()
    expect(first.modelsByAgentId?.opencode?.models.length).toBe(2)
    // Second call should not re-probe (installed+already probed)
    const second = await refreshAcpModelsOnce()
    expect(second.modelsByAgentId?.opencode?.models.length).toBe(2)
  })
})
