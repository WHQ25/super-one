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
    getConfigOptions: () => [
      {
        id: 'mode',
        name: 'Session Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'ask',
        options: [
          { value: 'ask', name: 'Ask' },
          { value: 'code', name: 'Code' },
        ],
      },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'opencode/big-pickle',
        options: [
          { value: 'opencode/big-pickle', name: 'Big Pickle' },
          { value: 'openai/gpt-5.4', name: 'GPT-5.4' },
        ],
      },
    ],
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
  upsertAcpAgentConfig,
  resetAcpModelProbeStateForTests,
  getCachedSessionCatalog,
} from './acp-model-cache'

describe('acp-model-cache', () => {
  beforeEach(() => {
    cacheStore.clear()
    resetAcpModelProbeStateForTests()
  })

  it('upserts full configOptions into configByAgentId and derives modelsByAgentId', () => {
    writeAcpResourcesCache({
      agents: [{ id: 'opencode', name: 'OpenCode', installed: true, commandPreview: 'opencode acp' }],
      selectedAgentId: 'opencode',
      modelsByAgentId: {},
      configByAgentId: {},
    })
    upsertAcpAgentConfig('opencode', [
      {
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'code',
        options: [
          { value: 'ask', name: 'Ask' },
          { value: 'code', name: 'Code' },
        ],
      },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'a',
        options: [{ value: 'a', name: 'A' }],
      },
    ])
    const cached = readAcpResourcesCache()
    expect(cached.configByAgentId?.opencode?.configOptions.map((o) => o.id)).toEqual(['mode', 'model'])
    expect(cached.modelsByAgentId?.opencode?.models).toEqual([
      { id: 'a', name: 'A', description: '' },
    ])
    const session = getCachedSessionCatalog('opencode')
    expect(session?.selectedModeId).toBe('code')
    expect(session?.modes.map((m) => m.id)).toEqual(['ask', 'code'])
  })

  it('upserts models-only (Grok) via extraModels without wiping modes', () => {
    writeAcpResourcesCache({
      agents: [{ id: 'grok-build', name: 'Grok', installed: true, commandPreview: 'grok' }],
      selectedAgentId: 'grok-build',
      configByAgentId: {
        'grok-build': {
          configOptions: [{
            id: 'mode',
            name: 'Mode',
            category: 'mode',
            type: 'select',
            currentValue: 'ask',
            options: [{ value: 'ask', name: 'Ask' }],
          }],
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    })
    upsertAcpAgentModels('grok-build', {
      configId: null,
      selectedModelId: 'grok-4.5',
      models: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
    })
    const cached = readAcpResourcesCache()
    expect(cached.configByAgentId?.['grok-build']?.configOptions[0]?.id).toBe('mode')
    expect(cached.configByAgentId?.['grok-build']?.extraModels?.[0]?.id).toBe('grok-4.5')
    expect(getCachedSessionCatalog('grok-build')?.modes[0]?.id).toBe('ask')
  })

  it('migrates legacy modelsByAgentId into configByAgentId on read', () => {
    cacheStore.set('acp', {
      agents: [{ id: 'opencode', name: 'OpenCode', installed: true, commandPreview: 'opencode acp' }],
      selectedAgentId: 'opencode',
      modelsByAgentId: {
        opencode: {
          models: [{ id: 'a', name: 'A', description: '' }],
          selectedModelId: 'a',
          configId: 'model',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    })
    const cached = readAcpResourcesCache()
    expect(cached.configByAgentId?.opencode?.configOptions[0]?.id).toBe('model')
    expect(getCachedSessionCatalog('opencode')?.models[0]?.id).toBe('a')
  })

  it('probes each agent only once per launch and stores full config', async () => {
    writeAcpResourcesCache({
      agents: [
        { id: 'opencode', name: 'OpenCode', installed: true, commandPreview: 'opencode acp' },
        { id: 'grok-build', name: 'Grok Build', installed: false, commandPreview: 'grok agent stdio' },
      ],
      selectedAgentId: null,
      modelsByAgentId: {},
      configByAgentId: {},
    })
    const first = await refreshAcpModelsOnce()
    expect(first.configByAgentId?.opencode?.configOptions.length).toBe(2)
    expect(first.modelsByAgentId?.opencode?.models.length).toBe(2)
    expect(getCachedSessionCatalog('opencode')?.modes.map((m) => m.id)).toEqual(['ask', 'code'])
    const second = await refreshAcpModelsOnce()
    expect(second.configByAgentId?.opencode?.configOptions.length).toBe(2)
  })
})
