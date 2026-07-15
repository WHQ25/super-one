import { describe, it, expect } from 'vitest'
import type { AcpResources } from '@superone/shared/agent-types'
import { getCachedAcpCatalog, sessionPatchFromAcpCatalog } from './acp-handler'

const resources: AcpResources = {
  agents: [
    { id: 'grok-build', name: 'Grok Build', installed: true, commandPreview: 'grok agent stdio' },
    { id: 'opencode', name: 'OpenCode', installed: true, commandPreview: 'opencode acp' },
  ],
  selectedAgentId: 'opencode',
  modelsByAgentId: {
    'grok-build': {
      models: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
      selectedModelId: 'grok-4.5',
      configId: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    opencode: {
      models: [
        { id: 'openai/gpt-5.4', name: 'OpenAI/GPT-5.4', description: '' },
        { id: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle', description: '' },
      ],
      selectedModelId: 'opencode/big-pickle',
      configId: 'model',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  },
}

describe('getCachedAcpCatalog', () => {
  it('returns per-agent catalog', () => {
    const catalog = getCachedAcpCatalog(resources, 'opencode')
    expect(catalog?.models).toHaveLength(2)
    expect(catalog?.selectedModelId).toBe('opencode/big-pickle')
  })

  it('returns null for missing agent or empty models', () => {
    expect(getCachedAcpCatalog(resources, 'missing')).toBeNull()
    expect(getCachedAcpCatalog(null, 'opencode')).toBeNull()
    expect(getCachedAcpCatalog({ ...resources, modelsByAgentId: { empty: {
      models: [], selectedModelId: null, configId: null, updatedAt: '',
    } } }, 'empty')).toBeNull()
  })
})

describe('sessionPatchFromAcpCatalog', () => {
  it('hydrates session model fields from catalog defaults', () => {
    const catalog = getCachedAcpCatalog(resources, 'opencode')!
    const patch = sessionPatchFromAcpCatalog(catalog)
    expect(patch.acpModelsStatus).toBe('ready')
    expect(patch.selectedModel).toBe('opencode/big-pickle')
    expect(patch.modelUserChosen).toBe(false)
    expect(patch.acpModelConfigId).toBe('model')
  })

  it('honors preferSelected when present in catalog', () => {
    const catalog = getCachedAcpCatalog(resources, 'opencode')!
    const patch = sessionPatchFromAcpCatalog(catalog, { preferSelected: 'openai/gpt-5.4' })
    expect(patch.selectedModel).toBe('openai/gpt-5.4')
  })

  it('ignores preferSelected when not in catalog', () => {
    const catalog = getCachedAcpCatalog(resources, 'opencode')!
    const patch = sessionPatchFromAcpCatalog(catalog, { preferSelected: 'missing' })
    expect(patch.selectedModel).toBe('opencode/big-pickle')
  })
})
