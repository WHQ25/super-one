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
  },
  configByAgentId: {
    opencode: {
      configOptions: [
        {
          id: 'mode',
          name: 'Session Mode',
          category: 'mode',
          type: 'select',
          currentValue: 'code',
          options: [
            { value: 'ask', name: 'Ask', description: 'prompt first' },
            { value: 'code', name: 'Code', description: 'full access' },
          ],
        },
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'opencode/big-pickle',
          options: [
            { value: 'openai/gpt-5.4', name: 'OpenAI/GPT-5.4' },
            { value: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle' },
          ],
        },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  },
}

describe('getCachedAcpCatalog', () => {
  it('returns per-agent catalog from configByAgentId (models + modes)', () => {
    const catalog = getCachedAcpCatalog(resources, 'opencode')
    expect(catalog?.models).toHaveLength(2)
    expect(catalog?.selectedModelId).toBe('opencode/big-pickle')
    expect(catalog?.modelConfigId).toBe('model')
    expect(catalog?.modes.map((m) => m.id)).toEqual(['ask', 'code'])
    expect(catalog?.selectedModeId).toBe('code')
    expect(catalog?.modeConfigId).toBe('mode')
  })

  it('falls back to legacy modelsByAgentId', () => {
    const catalog = getCachedAcpCatalog(resources, 'grok-build')
    expect(catalog?.models).toEqual([{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }])
    expect(catalog?.modes).toEqual([])
  })

  it('hydrates Grok effort modes from extraModes with null modeConfigId', () => {
    const withEffort: AcpResources = {
      ...resources,
      configByAgentId: {
        ...resources.configByAgentId,
        'grok-build': {
          configOptions: [],
          extraModels: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
          selectedModelId: 'grok-4.5',
          modelConfigId: null,
          extraModes: [
            { id: 'low', name: 'Low', description: '' },
            { id: 'high', name: 'High', description: '' },
          ],
          selectedModeId: 'high',
          modeConfigId: null,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }
    const catalog = getCachedAcpCatalog(withEffort, 'grok-build')
    expect(catalog?.modes.map((m) => m.id)).toEqual(['low', 'high'])
    expect(catalog?.selectedModeId).toBe('high')
    expect(catalog?.modeConfigId).toBeNull()
    const patch = sessionPatchFromAcpCatalog(catalog!)
    expect(patch.acpModes?.map((m) => m.id)).toEqual(['low', 'high'])
    expect(patch.acpModeConfigId).toBeNull()
    expect(patch.selectedAcpModeId).toBe('high')
  })

  it('returns null for missing agent or empty models', () => {
    expect(getCachedAcpCatalog(resources, 'missing')).toBeNull()
    expect(getCachedAcpCatalog(null, 'opencode')).toBeNull()
    expect(getCachedAcpCatalog({
      ...resources,
      modelsByAgentId: {
        empty: { models: [], selectedModelId: null, configId: null, updatedAt: '' },
      },
      configByAgentId: {},
    }, 'empty')).toBeNull()
  })
})

describe('sessionPatchFromAcpCatalog', () => {
  it('hydrates session model, mode, and slash command fields from catalog defaults', () => {
    const withCommands = {
      ...resources,
      configByAgentId: {
        ...resources.configByAgentId,
        opencode: {
          ...resources.configByAgentId!.opencode!,
          slashCommands: [
            { name: 'web', description: 'Search', argumentHint: 'q', isSkill: false },
            { name: 'plan', description: 'Plan', argumentHint: '', isSkill: false },
          ],
        },
      },
    }
    const catalog = getCachedAcpCatalog(withCommands, 'opencode')!
    const patch = sessionPatchFromAcpCatalog(catalog)
    expect(patch.acpModelsStatus).toBe('ready')
    expect(patch.selectedModel).toBe('opencode/big-pickle')
    expect(patch.modelUserChosen).toBe(false)
    expect(patch.acpModelConfigId).toBe('model')
    expect(patch.acpModesStatus).toBe('ready')
    expect(patch.selectedAcpModeId).toBe('code')
    expect(patch.acpModeConfigId).toBe('mode')
    expect(patch.acpModes?.map((m) => m.id)).toEqual(['ask', 'code'])
    expect(patch.acpSlashCommands?.map((c) => c.name)).toEqual(['web', 'plan'])
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
