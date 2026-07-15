import { describe, it, expect } from 'vitest'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import {
  extractModelConfig,
  extractModelsFromInitializeResult,
  extractModelsFromNewSessionResult,
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
