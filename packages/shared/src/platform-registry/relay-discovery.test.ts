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
  parseOneApiRatioPricing,
  parseOpenAiModelsList,
  parseRelayEndpointRoutes,
  parseRelayPricing,
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

  it('does not invent an image task from image-generation when the model is a chat id', () => {
    const json = { data: [{ model_name: 'gpt-5', supported_endpoint_types: ['openai', 'image-generation'] }] }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat'] } },
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
        { model_name: 'gpt-5', supported_endpoint_types: ['anthropic'] },
      ],
    }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat'], anthropic: ['chat'] } },
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

  it('rides openai-video when the gateway actually exposes that type', () => {
    const json = {
      data: [{ model_name: 'doubao-seedance-1-5-pro', supported_endpoint_types: ['openai-video'] }],
    }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'doubao-seedance-1-5-pro', name: undefined, byFamily: { 'openai-video': ['video'] } },
    ])
  })

  it('falls back to newapi-video when a video id is only listed on chat wires', () => {
    const json = {
      data: [{
        model_name: 'doubao-seedance-2-0-260128',
        supported_endpoint_types: ['openai', 'anthropic', 'gemini', 'openai-response'],
      }],
    }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'doubao-seedance-2-0-260128', name: undefined, byFamily: { 'newapi-video': ['video'] } },
    ])
  })

  it('classifies a row with no endpoint types via the model id', () => {
    const json = { data: [{ model_name: 'claude-sonnet-4-5' }] }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'claude-sonnet-4-5', name: undefined, byFamily: { anthropic: ['chat'] } },
    ])
  })

  it('uses owner_by when the model id is a custom alias', () => {
    const json = { data: [{ model_name: 'sonnet-alias', owner_by: 'anthropic' }] }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'sonnet-alias', name: undefined, byFamily: { anthropic: ['chat'] } },
    ])
  })

  it('uses tags and output_modalities as extra capability hints', () => {
    const json = {
      data: [
        { model_name: 'gpt-image-alias', owner_by: 'openai', tags: '图像', output_modalities: ['image'] },
        { model_name: 'dreamina-seedance-2', tags: '视频' },
      ],
    }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'gpt-image-alias', name: undefined, byFamily: { openai: ['image'] } },
      { id: 'dreamina-seedance-2', name: undefined, byFamily: { 'newapi-video': ['video'] } },
    ])
  })
})

describe('parseOneApiRatioPricing', () => {
  it('reads model_ratio keys and classifies them', () => {
    const json = {
      data: {
        model_ratio: { 'gpt-4': 15, 'claude-3-opus': 75, 'gemini-2.5-pro': 1 },
        completion_ratio: { 'gpt-4': 2 },
      },
    }
    expect(parseOneApiRatioPricing(json)).toEqual([
      { id: 'gpt-4', byFamily: { openai: ['chat'] } },
      { id: 'claude-3-opus', byFamily: { anthropic: ['chat'] } },
      { id: 'gemini-2.5-pro', byFamily: { google: ['chat'] } },
    ])
  })

  it('returns null for the NewAPI array shape (caller uses parseNewApiPricing)', () => {
    expect(parseOneApiRatioPricing({ data: [{ model_name: 'gpt-5' }] })).toBeNull()
  })
})

describe('parseRelayPricing', () => {
  it('prefers the NewAPI array shape and falls back to One API model_ratio', () => {
    expect(parseRelayPricing({ data: [{ model_name: 'gpt-5', supported_endpoint_types: ['openai'] }] })).toEqual([
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat'] } },
    ])
    expect(parseRelayPricing({ data: { model_ratio: { 'gpt-4': 1 } } })).toEqual([
      { id: 'gpt-4', byFamily: { openai: ['chat'] } },
    ])
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
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat'] } },
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

  it('uses catalog tasks and only consults endpoint types for the wire', () => {
    const catalogIndex: Map<string, CapabilityTask[]> = new Map([['gpt-5', ['image']]])
    const json = { data: [{ id: 'gpt-5', supported_endpoint_types: ['openai'] }] }
    expect(parseOpenAiModelsList(json, catalogIndex)).toEqual([
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['image'] } },
    ])
  })

  it('routes Claude / Gemini ids to their families when the list has no endpoint types (Sub2API)', () => {
    const json = {
      data: [{ id: 'claude-sonnet-4-5' }, { id: 'gemini-2.5-pro' }, { id: 'gpt-5' }],
    }
    expect(parseOpenAiModelsList(json)).toEqual([
      { id: 'claude-sonnet-4-5', name: undefined, byFamily: { anthropic: ['chat'] } },
      { id: 'gemini-2.5-pro', name: undefined, byFamily: { google: ['chat'] } },
      { id: 'gpt-5', name: undefined, byFamily: { openai: ['chat'] } },
    ])
  })

  it('puts a Gemini image model on the openai image wire when types are openai-only', () => {
    const json = {
      data: [{ id: 'gemini-3.1-flash-image', supported_endpoint_types: ['openai'] }],
    }
    expect(parseOpenAiModelsList(json)).toEqual([
      { id: 'gemini-3.1-flash-image', name: undefined, byFamily: { openai: ['image'] } },
    ])
  })

  it('puts a Gemini image model on google when the gateway actually exposes gemini', () => {
    const json = {
      data: [{ id: 'gemini-3.1-flash-image', supported_endpoint_types: ['gemini'] }],
    }
    expect(parseOpenAiModelsList(json)).toEqual([
      { id: 'gemini-3.1-flash-image', name: undefined, byFamily: { google: ['image'] } },
    ])
  })

  it('classifies a Gemini image id as google image when the list has no endpoint types', () => {
    const json = { data: [{ id: 'gemini-3.1-flash-image' }] }
    expect(parseOpenAiModelsList(json)).toEqual([
      { id: 'gemini-3.1-flash-image', name: undefined, byFamily: { google: ['image'] } },
    ])
  })

  it('uses official catalog tasks and openai types together (Nano Banana via OpenAI wire)', () => {
    const catalogIndex: Map<string, CapabilityTask[]> = new Map([
      ['gemini-3.1-flash-image', ['image']],
    ])
    const json = { data: [{ id: 'gemini-3.1-flash-image', supported_endpoint_types: ['openai'] }] }
    expect(parseOpenAiModelsList(json, catalogIndex)).toEqual([
      { id: 'gemini-3.1-flash-image', name: undefined, byFamily: { openai: ['image'] } },
    ])
  })

  it('does not put Seedance video onto chat families even when types list them all', () => {
    const json = {
      data: [{
        id: 'doubao-seedance-2-0-260128',
        owned_by: 'newapi',
        supported_endpoint_types: ['openai', 'openai-response', 'anthropic', 'gemini'],
      }],
    }
    expect(parseOpenAiModelsList(json)).toEqual([
      { id: 'doubao-seedance-2-0-260128', name: undefined, byFamily: { 'newapi-video': ['video'] } },
    ])
  })

  it('rides openai-video when the list actually tags Seedance as openai-video', () => {
    const json = { data: [{ id: 'doubao-seedance-1-5-pro', supported_endpoint_types: ['openai-video'] }] }
    expect(parseOpenAiModelsList(json)).toEqual([
      { id: 'doubao-seedance-1-5-pro', name: undefined, byFamily: { 'openai-video': ['video'] } },
    ])
  })

  it('uses owned_by from /v1/models when the id is a renamed alias', () => {
    const json = { data: [{ id: 'cc-sonnet', owned_by: 'anthropic', object: 'model' }] }
    expect(parseOpenAiModelsList(json)).toEqual([
      { id: 'cc-sonnet', name: undefined, byFamily: { anthropic: ['chat'] } },
    ])
  })
})

describe('parseRelayEndpointRoutes', () => {
  it('resolves each declared path to the protocol that speaks it', () => {
    const json = {
      supported_endpoint: {
        anthropic: { path: '/v1/messages', method: 'POST' },
        openai: { path: '/v1/chat/completions', method: 'POST' },
      },
    }
    expect(parseRelayEndpointRoutes(json)).toEqual({
      anthropic: 'anthropic-messages',
      openai: 'openai-chat',
    })
  })

  it("reads through a relay's own naming: the path decides, not the type name", () => {
    // New API has one `openai-video` type name for two different wires. A site that publishes
    // `/v1/video/generations` under that name is declaring the New API wire, not Sora's.
    const json = { supported_endpoint: { 'openai-video': { path: '/v1/video/generations' } } }
    expect(parseRelayEndpointRoutes(json)).toEqual({ 'openai-video': 'newapi-video' })
  })

  it('accepts a bare string value and drops paths we do not implement', () => {
    const json = {
      supported_endpoint: {
        openai: '/v1/chat/completions',
        'jina-rerank': { path: '/v1/rerank' },
        broken: { method: 'POST' },
      },
    }
    expect(parseRelayEndpointRoutes(json)).toEqual({ openai: 'openai-chat' })
  })

  it('returns an empty map when the site publishes nothing (One API, Sub2API)', () => {
    expect(parseRelayEndpointRoutes({ data: [] })).toEqual({})
    expect(parseRelayEndpointRoutes(null)).toEqual({})
  })
})

describe('declared routes override endpoint-type names', () => {
  it('routes Seedance onto newapi-video when the site publishes that path under openai-video', () => {
    const json = {
      supported_endpoint: { 'openai-video': { path: '/v1/video/generations', method: 'POST' } },
      data: [{ model_name: 'doubao-seedance-2-0-260128', supported_endpoint_types: ['openai-video'] }],
    }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'doubao-seedance-2-0-260128', name: undefined, byFamily: { 'newapi-video': ['video'] } },
    ])
  })

  it('keeps Sora on openai-video when the site publishes /v1/videos under the same name', () => {
    const json = {
      supported_endpoint: { 'openai-video': { path: '/v1/videos', method: 'POST' } },
      data: [{ model_name: 'sora-2', supported_endpoint_types: ['openai-video'] }],
    }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'sora-2', name: undefined, byFamily: { 'openai-video': ['video'] } },
    ])
  })

  it('applies pricing routes to the models list, which carries no routes of its own', () => {
    const routes = parseRelayEndpointRoutes({
      supported_endpoint: { 'openai-video': { path: '/v1/video/generations' } },
    })
    const json = { data: [{ id: 'kling-v2', supported_endpoint_types: ['openai-video'] }] }
    expect(parseOpenAiModelsList(json, undefined, { routes })).toEqual([
      { id: 'kling-v2', name: undefined, byFamily: { 'newapi-video': ['video'] } },
    ])
  })

  it('recognises a name it has no convention for, purely from the published path', () => {
    const json = {
      supported_endpoint: { 'ark-native': { path: '/api/v3/contents/generations/tasks' } },
      data: [{ model_name: 'doubao-seedance-2-0-260128', supported_endpoint_types: ['ark-native'] }],
    }
    expect(parseNewApiPricing(json)).toEqual([
      { id: 'doubao-seedance-2-0-260128', name: undefined, byFamily: { 'ark-video': ['video'] } },
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

  it('prefers first-party vendor with list price over aggregator null-cost on bare-id collision', () => {
    const catalog: ModelCatalog = {
      generatedAt: '2026-01-01',
      source: 'snapshot',
      providers: [
        {
          id: 'anyapi',
          name: 'AnyAPI',
          npm: '',
          env: [],
          doc: '',
          models: [
            {
              id: 'deepseek/deepseek-v4-flash',
              name: 'DeepSeek V4 Flash (proxy)',
              providerId: 'anyapi',
              inputModalities: ['text'],
              outputModalities: ['text'],
              reasoning: false,
              toolCall: true,
              attachment: false,
            },
          ],
        },
        {
          id: 'deepseek',
          name: 'DeepSeek',
          npm: '',
          env: [],
          doc: '',
          models: [
            {
              id: 'deepseek-v4-flash',
              name: 'DeepSeek V4 Flash',
              providerId: 'deepseek',
              cost: { input: 0.14, output: 0.28, cacheRead: 0.0028 },
              inputModalities: ['text'],
              outputModalities: ['text'],
              reasoning: false,
              toolCall: true,
              attachment: false,
            },
          ],
        },
      ],
    }
    const index = buildCatalogModelIndex(catalog)
    expect(index.get('deepseek-v4-flash')?.providerId).toBe('deepseek')
    expect(index.get('deepseek-v4-flash')?.cost).toEqual({
      input: 0.14,
      output: 0.28,
      cacheRead: 0.0028,
    })
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
