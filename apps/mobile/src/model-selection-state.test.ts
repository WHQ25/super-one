import { describe, expect, it } from 'vitest'
import type { RemoteSystemInfo } from '@superone/shared/agent-types'
import {
  effortOptionsForModel,
  resolveSelectedEffort,
  resolveSelectedModel,
} from './model-selection-state'

const codexInfo: RemoteSystemInfo = {
  models: [{
    id: 'gpt-5.6',
    name: 'GPT-5.6',
    description: '',
    isDefault: true,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [
      { value: 'medium', description: 'Balanced' },
      { value: 'high', description: 'Deeper' },
    ],
  }],
  defaults: { model: 'gpt-5.6', effort: 'high' },
}

describe('mobile model selection state', () => {
  it('resolves the configured model and model-specific Codex efforts', () => {
    const model = resolveSelectedModel(codexInfo)
    const efforts = effortOptionsForModel('codex', codexInfo, model)

    expect(model).toBe('gpt-5.6')
    expect(efforts.map((option) => option.value)).toEqual(['medium', 'high'])
    expect(resolveSelectedEffort(efforts, codexInfo.defaults?.effort)).toBe('high')
  })

  it('uses ACP session modes as effort choices', () => {
    const info: RemoteSystemInfo = {
      models: [{ id: 'grok-4', name: 'Grok 4', description: '' }],
      efforts: [
        { value: 'fast', label: 'Fast' },
        { value: 'deep', label: 'Deep' },
      ],
    }
    expect(effortOptionsForModel('acp', info, 'grok-4')).toEqual(info.efforts)
  })

  const claudeCatalog: RemoteSystemInfo = {
    models: [{
      id: 'sonnet',
      name: 'Sonnet',
      description: '',
      supportedEffortLevels: ['low', 'medium', 'high'],
    }],
  }

  it('hides Claude effort when the model is owned by an API mapping', () => {
    const info: RemoteSystemInfo = {
      ...claudeCatalog,
      activeProvider: {
        id: 'mapped',
        name: 'Mapped provider',
        presetKey: null,
        modelEnv: { default: { id: 'kimi-k2' } },
        forcedEffort: null,
      },
    }
    expect(effortOptionsForModel('claude', info, 'sonnet')).toEqual([])
  })

  it('keeps Claude effort for a credential that remaps no models', () => {
    const info: RemoteSystemInfo = {
      ...claudeCatalog,
      activeProvider: {
        id: 'passthrough',
        name: 'Anthropic-compatible endpoint',
        presetKey: null,
        modelEnv: {},
        forcedEffort: null,
      },
    }
    expect(effortOptionsForModel('claude', info, 'sonnet').map((option) => option.value))
      .toEqual(['low', 'medium', 'high'])
  })

  it('falls back to the catalog default and medium effort', () => {
    const info: RemoteSystemInfo = {
      models: [{
        id: 'cursor-1',
        name: 'Cursor 1',
        description: '',
        isDefault: true,
        supportedEffortLevels: ['low', 'medium', 'high'],
      }],
    }
    const model = resolveSelectedModel(info, 'stale-model')
    const efforts = effortOptionsForModel('cursor', info, model)
    expect(model).toBe('cursor-1')
    expect(resolveSelectedEffort(efforts, 'unsupported')).toBe('medium')
  })
})
