import { describe, it, expect } from 'vitest'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import {
  buildSetModelParams,
  deriveSessionCatalog,
  extractModeConfig,
  extractModelConfig,
  extractModesFromNewSessionResult,
  extractModesFromXaiSessionConfig,
  asEffortLevel,
  asGrokReasoningEffort,
  extractModelsFromInitializeResult,
  extractModelsFromNewSessionResult,
  coalesceModelConfig,
  mergeModelConfig,
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

  it('overlays extraModels contextWindow onto configOptions models', () => {
    const session = deriveSessionCatalog({
      configOptions: [{
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'grok-4.6',
        options: [{ value: 'grok-4.6', name: 'Grok 4.6' }],
      }],
      extraModels: [{ id: 'grok-4.6', name: 'Grok 4.6', description: '', contextWindow: 500_000 }],
      selectedModelId: 'grok-4.6',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(session.models[0]).toMatchObject({ id: 'grok-4.6', contextWindow: 500_000 })
  })

  it('uses extraModes with null modeConfigId for Grok effort', () => {
    const session = deriveSessionCatalog({
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
    })
    expect(session.modes.map((m) => m.id)).toEqual(['low', 'high'])
    expect(session.selectedModeId).toBe('high')
    expect(session.modeConfigId).toBeNull()
  })

  it('drops project-scoped workflows when reading the agent-global cache', () => {
    const session = deriveSessionCatalog({
      configOptions: [],
      slashCommands: [
        {
          name: 'client-cli-coverage-scan',
          description: 'Scan',
          argumentHint: '',
          isSkill: false,
          isWorkflow: true,
          workflowSource: 'project',
        },
        {
          name: 'deep-research',
          description: 'Research',
          argumentHint: '',
          isSkill: false,
          isWorkflow: true,
          workflowSource: 'builtin',
        },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(session.slashCommands.map((c) => c.name)).toEqual(['deep-research'])
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

  it('reads totalContextTokens from model meta for context window', () => {
    const result = extractModelsFromInitializeResult({
      protocolVersion: 1,
      _meta: {
        modelState: {
          currentModelId: 'grok-4.5',
          availableModels: [
            {
              modelId: 'grok-4.5',
              name: 'Grok 4.5',
              _meta: { totalContextTokens: 500_000 },
            },
          ],
        },
      },
    })
    expect(result?.models[0]?.contextWindow).toBe(500_000)
  })

  it('reads grok-4.6 reasoningEfforts from model meta and ignores minimal', () => {
    const result = extractModelsFromInitializeResult({
      protocolVersion: 1,
      _meta: {
        modelState: {
          currentModelId: 'grok-4.6',
          availableModels: [
            {
              modelId: 'grok-4.6',
              name: 'Grok 4.6',
              model_family: 'xai',
              _meta: {
                totalContextTokens: 500_000,
                reasoningEfforts: [
                  { value: 'xhigh' },
                  { value: 'high', default: true },
                  { value: 'medium' },
                  { value: 'low' },
                  { value: 'minimal' },
                ],
              },
            },
          ],
        },
      },
    })
    expect(result?.selectedModelId).toBe('grok-4.6')
    expect(result?.models[0]).toMatchObject({
      id: 'grok-4.6',
      contextWindow: 500_000,
      supportsEffort: true,
      supportedEffortLevels: ['xhigh', 'high', 'medium', 'low'],
    })
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

  it('keeps configOptions as the picker and fills contextWindow from models meta', () => {
    const result = extractModelsFromNewSessionResult({
      sessionId: 's1',
      configOptions: [{
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'grok-4.6',
        options: [
          { value: 'grok-4.6', name: 'Grok 4.6' },
          { value: 'grok-4.5', name: 'Grok 4.5' },
        ],
      }],
      models: {
        currentModelId: 'grok-4.6',
        availableModels: [
          { modelId: 'grok-4.6', name: 'Grok 4.6', _meta: { totalContextTokens: 500_000 } },
          { modelId: 'grok-4.5', name: 'Grok 4.5', _meta: { totalContextTokens: 500_000 } },
        ],
      },
    })
    expect(result?.configId).toBe('model')
    expect(result?.selectedModelId).toBe('grok-4.6')
    expect(result?.models).toEqual([
      { id: 'grok-4.6', name: 'Grok 4.6', description: '', contextWindow: 500_000 },
      { id: 'grok-4.5', name: 'Grok 4.5', description: '', contextWindow: 500_000 },
    ])
  })
})

describe('coalesceModelConfig', () => {
  it('overlays initialize window onto session/new configOptions', () => {
    const merged = coalesceModelConfig(
      {
        configId: 'model',
        selectedModelId: 'grok-4.6',
        models: [{ id: 'grok-4.6', name: 'Grok 4.6', description: '' }],
      },
      {
        configId: null,
        selectedModelId: 'grok-4.6',
        models: [{ id: 'grok-4.6', name: 'Grok 4.6', description: '', contextWindow: 500_000 }],
      },
    )
    expect(merged).toMatchObject({
      configId: 'model',
      selectedModelId: 'grok-4.6',
      models: [{ id: 'grok-4.6', contextWindow: 500_000 }],
    })
  })

  it('does not overwrite a window the winner already has', () => {
    expect(mergeModelConfig(
      { configId: null, selectedModelId: 'a', models: [{ id: 'a', name: 'A', description: '', contextWindow: 200_000 }] },
      { configId: null, selectedModelId: 'a', models: [{ id: 'a', name: 'A', description: '', contextWindow: 500_000 }] },
    ).models[0]?.contextWindow).toBe(200_000)
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

  it('sorts agent high→low emission into ascending slider order', () => {
    const modes = extractModesFromXaiSessionConfig({
      'x.ai/sessionConfig': {
        options: [
          { id: 'high', category: 'mode', label: 'High Effort', selected: true },
          { id: 'medium', category: 'mode', label: 'Medium Effort', selected: false },
          { id: 'low', category: 'mode', label: 'Low Effort', selected: false },
        ],
      },
    })
    expect(modes?.modes.map((m) => m.id)).toEqual(['low', 'medium', 'high'])
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

describe('asGrokReasoningEffort', () => {
  it('accepts Grok effort ids and rejects OpenCode mode ids', () => {
    expect(asGrokReasoningEffort('xhigh')).toBe('xhigh')
    expect(asGrokReasoningEffort('  high  ')).toBe('high')
    expect(asGrokReasoningEffort('ask')).toBeUndefined()
    expect(asGrokReasoningEffort('code')).toBeUndefined()
    expect(asGrokReasoningEffort('')).toBeUndefined()
    expect(asGrokReasoningEffort(null)).toBeUndefined()
  })
})

describe('asEffortLevel', () => {
  it('narrows raw mode ids onto the host EffortLevel union', () => {
    expect(asEffortLevel('low')).toBe('low')
    expect(asEffortLevel('  XHigh  ')).toBe('xhigh')
    expect(asEffortLevel('max')).toBe('max')
  })

  it('rejects ids the host slider cannot represent', () => {
    // Grok ships `minimal` on the wire but the host union stops at `low`;
    // letting it through would stamp an effort no picker can round-trip.
    expect(asEffortLevel('minimal')).toBeUndefined()
    // OpenCode session modes are not efforts at all.
    expect(asEffortLevel('ask')).toBeUndefined()
    expect(asEffortLevel('code')).toBeUndefined()
    expect(asEffortLevel('')).toBeUndefined()
    expect(asEffortLevel(null)).toBeUndefined()
    expect(asEffortLevel(undefined)).toBeUndefined()
  })
})
