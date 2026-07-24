import { describe, it, expect } from 'vitest'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import {
  buildSetModelParams,
  deriveSessionCatalog,
  extractModeConfig,
  extractModelConfig,
  extractModesFromNewSessionResult,
  extractModesFromXaiSessionConfig,
  extractModelsFromInitializeResult,
  extractModelsFromNewSessionResult,
  serializeConfigOptions,
} from './acp-config'

describe('extractModelConfig', () => {
  it('extracts category=model select options', () => {
    const options = [
      {
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'agent',
        options: [{ value: 'agent', name: 'Agent' }],
      },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'm2',
        options: [
          { value: 'm1', name: 'Model 1', description: 'fast' },
          { value: 'm2', name: 'Model 2' },
        ],
      },
    ] as SessionConfigOption[]

    const result = extractModelConfig(options)
    expect(result?.configId).toBe('model')
    expect(result?.selectedModelId).toBe('m2')
    expect(result?.models).toEqual([
      { id: 'm1', name: 'Model 1', description: 'fast' },
      { id: 'm2', name: 'Model 2', description: '' },
    ])
  })

  it('flattens grouped options', () => {
    const options = [
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'a',
        options: [
          {
            group: 'g1',
            name: 'Group',
            options: [
              { value: 'a', name: 'A' },
              { value: 'b', name: 'B' },
            ],
          },
        ],
      },
    ] as SessionConfigOption[]

    const result = extractModelConfig(options)
    expect(result?.models.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('returns null when no select options', () => {
    expect(extractModelConfig([])).toBeNull()
    expect(extractModelConfig(undefined)).toBeNull()
  })

  it('does not treat mode select as model', () => {
    const options = [
      {
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'ask',
        options: [{ value: 'ask', name: 'Ask' }],
      },
    ] as SessionConfigOption[]
    expect(extractModelConfig(options)).toBeNull()
  })
})

describe('extractModeConfig', () => {
  it('extracts category=mode select options', () => {
    const options = [
      {
        id: 'mode',
        name: 'Session Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'code',
        options: [
          { value: 'ask', name: 'Ask', description: 'prompt first' },
          { value: 'code', name: 'Code' },
        ],
      },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'm1',
        options: [{ value: 'm1', name: 'M1' }],
      },
    ] as SessionConfigOption[]

    const result = extractModeConfig(options)
    expect(result?.configId).toBe('mode')
    expect(result?.selectedModeId).toBe('code')
    expect(result?.modes).toEqual([
      { id: 'ask', name: 'Ask', description: 'prompt first' },
      { id: 'code', name: 'Code', description: '' },
    ])
  })

  it('returns null when no mode select', () => {
    const options = [
      {
        id: 'model',
        category: 'model',
        type: 'select',
        currentValue: 'm1',
        options: [{ value: 'm1', name: 'M1' }],
      },
    ] as SessionConfigOption[]
    expect(extractModeConfig(options)).toBeNull()
    expect(extractModeConfig([])).toBeNull()
  })
})

describe('serializeConfigOptions + deriveSessionCatalog', () => {
  it('round-trips model and mode for cache', () => {
    const serialized = serializeConfigOptions([
      {
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'ask',
        options: [{ value: 'ask', name: 'Ask' }],
      },
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'm1',
        options: [{ value: 'm1', name: 'M1', description: 'fast' }],
      },
    ] as SessionConfigOption[])
    const session = deriveSessionCatalog({
      configOptions: serialized,
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(session.models).toEqual([{ id: 'm1', name: 'M1', description: 'fast' }])
    expect(session.selectedModelId).toBe('m1')
    expect(session.modes[0]?.id).toBe('ask')
    expect(session.modeConfigId).toBe('mode')
  })

  it('uses extraModels when configOptions lack model', () => {
    const session = deriveSessionCatalog({
      configOptions: [{
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'ask',
        options: [{ value: 'ask', name: 'Ask' }],
      }],
      extraModels: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
      selectedModelId: 'grok-4.5',
      modelConfigId: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(session.models[0]?.id).toBe('grok-4.5')
    expect(session.modes[0]?.id).toBe('ask')
  })
})

describe('extractModelsFromInitializeResult (Grok)', () => {
  it('reads _meta.modelState.availableModels', () => {
    const result = extractModelsFromInitializeResult({
      protocolVersion: 1,
      _meta: {
        modelState: {
          currentModelId: 'grok-4.5',
          availableModels: [
            { modelId: 'grok-4.5', name: 'Grok 4.5', description: 'frontier' },
            { modelId: 'composer', name: 'Composer' },
          ],
        },
      },
    })
    expect(result?.selectedModelId).toBe('grok-4.5')
    expect(result?.models.map((m) => m.id)).toEqual(['grok-4.5', 'composer'])
    expect(result?.configId).toBeNull()
  })
})

describe('extractModelsFromNewSessionResult (Grok)', () => {
  it('reads top-level models field', () => {
    const result = extractModelsFromNewSessionResult({
      sessionId: 's1',
      models: {
        currentModelId: 'grok-4.5',
        availableModels: [{ modelId: 'grok-4.5', name: 'Grok 4.5' }],
      },
    })
    expect(result?.models).toHaveLength(1)
    expect(result?.selectedModelId).toBe('grok-4.5')
  })

  it('reads x.ai/sessionConfig model options', () => {
    const result = extractModelsFromNewSessionResult({
      sessionId: 's1',
      _meta: {
        'x.ai/sessionConfig': {
          options: [
            { id: 'a', category: 'model', label: 'A', selected: false },
            { id: 'b', category: 'model', label: 'B', selected: true },
            { id: 'high', category: 'mode', label: 'High', selected: true },
          ],
        },
      },
    })
    expect(result?.models.map((m) => m.id)).toEqual(['a', 'b'])
    expect(result?.selectedModelId).toBe('b')
  })
})

describe('extractModesFromXaiSessionConfig (Grok effort)', () => {
  it('reads category=mode options with configId null', () => {
    const modes = extractModesFromXaiSessionConfig({
      'x.ai/sessionConfig': {
        options: [
          { id: 'a', category: 'model', label: 'A', selected: true },
          { id: 'low', category: 'mode', label: 'Low', selected: false },
          { id: 'high', category: 'mode', label: 'High', selected: true },
        ],
      },
    })
    expect(modes?.configId).toBeNull()
    expect(modes?.modes.map((m) => m.id)).toEqual(['low', 'high'])
    expect(modes?.selectedModeId).toBe('high')
  })

  it('extractModesFromNewSessionResult prefers standard configOptions', () => {
    const result = extractModesFromNewSessionResult({
      configOptions: [
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
      ],
      _meta: {
        'x.ai/sessionConfig': {
          options: [{ id: 'high', category: 'mode', label: 'High', selected: true }],
        },
      },
    })
    expect(result?.configId).toBe('mode')
    expect(result?.selectedModeId).toBe('code')
  })
})

describe('buildSetModelParams', () => {
  it('includes sessionId and modelId', () => {
    expect(buildSetModelParams('s1', 'grok-4.5')).toEqual({
      sessionId: 's1',
      modelId: 'grok-4.5',
    })
  })

  it('adds _meta.reasoningEffort when provided', () => {
    expect(buildSetModelParams('s1', 'grok-4.5', { reasoningEffort: 'xhigh' })).toEqual({
      sessionId: 's1',
      modelId: 'grok-4.5',
      _meta: { reasoningEffort: 'xhigh' },
    })
  })

  it('omits empty effort', () => {
    expect(buildSetModelParams('s1', 'm', { reasoningEffort: '  ' })).toEqual({
      sessionId: 's1',
      modelId: 'm',
    })
  })
})
