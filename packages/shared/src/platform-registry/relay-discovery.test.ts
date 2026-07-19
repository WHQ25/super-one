import { describe, expect, it } from 'vitest'
import type { CapabilityTask } from '../agent-types'
import type { ModelCatalog } from '../model-catalog-types'
import {
  MAX_DISCOVERED_MODELS,
  buildCatalogModelIndex,
  buildCatalogTaskIndex,
  flattenDiscoveredTasks,
  mergeDiscovered,
  parseNewApiPricing,
  parseOpenAiModelsList,
  type DiscoveredModel,
} from './relay-discovery'

describe('parseNewApiPricing', () => {
  it('maps image-generation to openai family image task', () => {
    const json = { data: [{ model_name: 'gpt-image-1', supported_endpoint_types: ['image-generation'] }] }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'gpt-image-1', name: undefined, byFamily: { openai: ['image'] } },
    ])
  })

  it('maps openai/openai-response/anthropic/gemini endpoint types to chat', () => {
    const json = {
      data: [
        { model_name: 'gpt-5', supported_endpoint_types: ['openai', 'openai-response'] },
        { model_name: 'claude-opus', supported_endpoint_types: ['anthropic'] },
        { model_name: 'gemini-pro', supported_endpoint_types: ['gemini'] },
      ],
    }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat'] } },
      { id: 'claude-opus', name: undefined, byFamily: { anthropic: ['chat'] } },
      { id: 'gemini-pro', name: undefined, byFamily: { google: ['chat'] } },
    ])
  })

  it('unions multiple tasks for a model spanning several endpoint types', () => {
    const json = { data: [{ model_name: 'gpt-5', supported_endpoint_types: ['openai', 'image-generation'] }] }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat', 'image'] } },
    ])
  })

  it('drops a model whose endpoint types have no CapabilityTask mapping (rerank/embeddings only)', () => {
    const json = {
      data: [
        { model_name: 'jina-reranker', supported_endpoint_types: ['jina-rerank'] },
        { model_name: 'text-embedding-3', supported_endpoint_types: ['embeddings'] },
      ],
    }
    expect(parseNewApiPricing(json)).toEqual([])
  })

  it('merges duplicate model_name entries across channels, unioning capabilities', () => {
    const json = {
      data: [
        { model_name: 'gpt-5', supported_endpoint_types: ['openai'] },
        { model_name: 'gpt-5', supported_endpoint_types: ['image-generation'] },
      ],
    }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat', 'image'] } },
    ])
  })

  it('carries the description as name when present', () => {
    const json = { data: [{ model_name: 'gpt-5', description: 'GPT-5', supported_endpoint_types: ['openai'] }] }
    expect(parseNewApiPricing(json)).toEqual([{ id: 'gpt-5', name: 'GPT-5', byFamily: { openai: ['chat'] } }])
  })

  it('returns null when the response has no data array (not a NewAPI pricing shape)', () => {
    expect(parseNewApiPricing({ success: true })).toBeNull()
    expect(parseNewApiPricing({ data: 'not-an-array' })).toBeNull()
  })

  it('returns null for non-object json', () => {
    expect(parseNewApiPricing(null)).toBeNull()
    expect(parseNewApiPricing('<html>404</html>')).toBeNull()
    expect(parseNewApiPricing(42)).toBeNull()
  })

  it('skips malformed entries (missing model_name) without throwing', () => {
    const json = { data: [{ supported_endpoint_types: ['openai'] }, { model_name: 'gpt-5', supported_endpoint_types: ['openai'] }] }
    expect(parseNewApiPricing(json)).toEqual([{ id: 'gpt-5', name: undefined, byFamily: { openai: ['chat'] } }])
  })
})

describe('parseOpenAiModelsList', () => {
  it('maps ids to openai family chat task by default when no supported_endpoint_types', () => {
    const json = { data: [{ id: 'gpt-5', object: 'model' }, { id: 'gpt-5-mini', object: 'model' }] }
    expect(parseOpenAiModelsList(json)).toEqual([
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat'] } },
      { id: 'gpt-5-mini', name: undefined, byFamily: { openai: ['chat'] } },
    ])
  })

  it('maps NewAPI supported_endpoint_types onto openai/anthropic/google families', () => {
    const json = {
      data: [
        { id: 'gpt-5', supported_endpoint_types: ['openai', 'image-generation'] },
        { id: 'claude-opus', supported_endpoint_types: ['anthropic'] },
        { id: 'gemini-pro', supported_endpoint_types: ['gemini'] },
      ],
    }
    expect(parseOpenAiModelsList(json)).toEqual([
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat', 'image'] } },
      { id: 'claude-opus', name: undefined, byFamily: { anthropic: ['chat'] } },
      { id: 'gemini-pro', name: undefined, byFamily: { google: ['chat'] } },
    ])
  })

  it('returns null when data is not an array', () => {
    expect(parseOpenAiModelsList({ data: null })).toBeNull()
    expect(parseOpenAiModelsList({})).toBeNull()
  })

  it('returns null for non-object json', () => {
    expect(parseOpenAiModelsList(null)).toBeNull()
    expect(parseOpenAiModelsList('nope')).toBeNull()
  })

  it('skips malformed entries (missing id) without throwing', () => {
    const json = { data: [{ object: 'model' }, { id: 'gpt-5' }] }
    expect(parseOpenAiModelsList(json)).toEqual([{ id: 'gpt-5', name: undefined, byFamily: { openai: ['chat'] } }])
  })

  it('classifies an id via the catalog index when supported_endpoint_types is absent', () => {
    const catalogIndex: Map<string, CapabilityTask[]> = new Map([
      ['gpt-image-1', ['image']],
      ['dall-e-3', ['image']],
    ])
    const json = { data: [{ id: 'gpt-image-1' }, { id: 'dall-e-3' }, { id: 'gpt-5' }] }
    expect(parseOpenAiModelsList(json, catalogIndex)).toEqual([
      { id: 'gpt-image-1', name: undefined, byFamily: { openai: ['image'] } },
      { id: 'dall-e-3', name: undefined, byFamily: { openai: ['image'] } },
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat'] } },
    ])
  })

  it('prefers supported_endpoint_types over the catalog index when both are present', () => {
    const catalogIndex: Map<string, CapabilityTask[]> = new Map([['gpt-5', ['image']]])
    const json = { data: [{ id: 'gpt-5', supported_endpoint_types: ['openai'] }] }
    expect(parseOpenAiModelsList(json, catalogIndex)).toEqual([
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat'] } },
    ])
  })
})

describe('buildCatalogTaskIndex', () => {
  it('indexes catalog models by bare id (vendor namespace stripped) with their capability tasks', () => {
    const catalog: ModelCatalog = {
      generatedAt: '2026-01-01',
      source: 'snapshot',
      providers: [
        {
          id: 'openrouter',
          name: 'OpenRouter',
          npm: '',
          env: [],
          doc: '',
          models: [
            {
              id: 'openai/gpt-image-1',
              name: 'GPT Image 1',
              providerId: 'openrouter',
              inputModalities: ['text'],
              outputModalities: ['image'],
              reasoning: false,
              toolCall: false,
              attachment: false,
            },
          ],
        },
      ],
    }
    const index = buildCatalogTaskIndex(catalog)
    expect(index.get('gpt-image-1')).toEqual(['image'])
  })

  it('prefers a canonical vendor (openai/anthropic/google) over other providers on id collision', () => {
    const catalog: ModelCatalog = {
      generatedAt: '2026-01-01',
      source: 'snapshot',
      providers: [
        {
          id: 'some-reseller',
          name: 'Reseller',
          npm: '',
          env: [],
          doc: '',
          models: [
            {
              id: 'gpt-4o',
              name: 'GPT-4o (reseller)',
              providerId: 'some-reseller',
              inputModalities: ['text'],
              outputModalities: ['text'],
              reasoning: false,
              toolCall: false,
              attachment: false,
            },
          ],
        },
        {
          id: 'openai',
          name: 'OpenAI',
          npm: '',
          env: [],
          doc: '',
          models: [
            {
              id: 'gpt-4o',
              name: 'GPT-4o',
              providerId: 'openai',
              inputModalities: ['text', 'image'],
              outputModalities: ['text'],
              reasoning: false,
              toolCall: false,
              attachment: true,
            },
          ],
        },
      ],
    }
    const index = buildCatalogTaskIndex(catalog)
    expect(index.get('gpt-4o')).toEqual(['chat'])
  })

  it('omits catalog models with no CapabilityTask-mapped modality (e.g. text-only embeddings)', () => {
    const catalog: ModelCatalog = {
      generatedAt: '2026-01-01',
      source: 'snapshot',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          npm: '',
          env: [],
          doc: '',
          models: [
            {
              id: 'text-embedding-3-large',
              name: 'text-embedding-3-large',
              providerId: 'openai',
              inputModalities: ['text'],
              outputModalities: [],
              reasoning: false,
              toolCall: false,
              attachment: false,
            },
          ],
        },
      ],
    }
    expect(buildCatalogTaskIndex(catalog).has('text-embedding-3-large')).toBe(false)
  })
})

describe('buildCatalogModelIndex', () => {
  it('indexes catalog models by bare id (vendor namespace stripped), keeping the full model', () => {
    const catalog: ModelCatalog = {
      generatedAt: '2026-01-01',
      source: 'snapshot',
      providers: [
        {
          id: 'openrouter',
          name: 'OpenRouter',
          npm: '',
          env: [],
          doc: '',
          models: [
            {
              id: 'openai/gpt-image-1',
              name: 'GPT Image 1',
              providerId: 'openrouter',
              contextWindow: 128000,
              inputModalities: ['text'],
              outputModalities: ['image'],
              reasoning: false,
              toolCall: false,
              attachment: false,
            },
          ],
        },
      ],
    }
    const index = buildCatalogModelIndex(catalog)
    expect(index.get('gpt-image-1')).toEqual(catalog.providers[0].models[0])
  })

  it('prefers a canonical vendor (openai/anthropic/google) over other providers on id collision', () => {
    const catalog: ModelCatalog = {
      generatedAt: '2026-01-01',
      source: 'snapshot',
      providers: [
        {
          id: 'some-reseller',
          name: 'Reseller',
          npm: '',
          env: [],
          doc: '',
          models: [
            {
              id: 'gpt-4o',
              name: 'GPT-4o (reseller)',
              providerId: 'some-reseller',
              inputModalities: ['text'],
              outputModalities: ['text'],
              reasoning: false,
              toolCall: false,
              attachment: false,
            },
          ],
        },
        {
          id: 'openai',
          name: 'GPT-4o',
          npm: '',
          env: [],
          doc: '',
          models: [
            {
              id: 'gpt-4o',
              name: 'GPT-4o',
              providerId: 'openai',
              inputModalities: ['text', 'image'],
              outputModalities: ['text'],
              reasoning: false,
              toolCall: false,
              attachment: true,
            },
          ],
        },
      ],
    }
    const index = buildCatalogModelIndex(catalog)
    expect(index.get('gpt-4o')?.providerId).toBe('openai')
  })
})

describe('mergeDiscovered', () => {
  const pricing: DiscoveredModel[] = [{ id: 'gpt-5', name: 'GPT-5', byFamily: { openai: ['image'] } }]
  const modelsList: DiscoveredModel[] = [
    { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat'] } },
    { id: 'gpt-5-mini', name: undefined, byFamily: { openai: ['chat'] } },
    { id: 'claude-opus', name: undefined, byFamily: { anthropic: ['chat'] } },
  ]

  it('unions capabilities from both sources for the same id and prefers pricing name', () => {
    const merged = mergeDiscovered(pricing, modelsList)
    expect(merged.find((m) => m.id === 'gpt-5')).toEqual({
      id: 'gpt-5',
      name: 'GPT-5',
      byFamily: { openai: ['chat', 'image'] },
    })
  })

  it('fills gaps from modelsList when pricing lacks an id', () => {
    const merged = mergeDiscovered(pricing, modelsList)
    expect(merged.find((m) => m.id === 'gpt-5-mini')).toEqual(modelsList[1])
    expect(merged.find((m) => m.id === 'claude-opus')).toEqual(modelsList[2])
  })

  it('falls back entirely to modelsList when pricing is null', () => {
    expect(mergeDiscovered(null, modelsList)).toEqual(modelsList)
  })

  it('uses only pricing when modelsList is null', () => {
    expect(mergeDiscovered(pricing, null)).toEqual(pricing)
  })

  it('returns an empty array when both sources are null', () => {
    expect(mergeDiscovered(null, null)).toEqual([])
  })

  it('truncates to MAX_DISCOVERED_MODELS', () => {
    const many: DiscoveredModel[] = Array.from({ length: MAX_DISCOVERED_MODELS + 50 }, (_, i) => ({
      id: `model-${i}`,
      byFamily: { openai: ['chat'] },
    }))
    expect(mergeDiscovered(many, null)).toHaveLength(MAX_DISCOVERED_MODELS)
  })
})

describe('flattenDiscoveredTasks', () => {
  it('returns tasks across families in canonical order', () => {
    expect(flattenDiscoveredTasks({ openai: ['image', 'chat'], anthropic: ['chat'] })).toEqual(['chat', 'image'])
  })
})
