import { describe, expect, it } from 'vitest'
import type { CapabilityTask, DiscoveredOpenAiModel } from '@superone/shared/agent-types'
import type { Plan, ServiceEndpoint } from '@superone/shared/platform-registry'
import {
  applyCatalogDisplayNames,
  applyDiscoveredModels,
  cachedDiscoveredModels,
  discoveredFromEndpoints,
  discoveryEndpoint,
  excludeDiscoveredIds,
  mergeDiscoveredIntoCustomModels,
  modelSlotsByTask,
  patchDiscoveredModel,
  slotOptionsForTask,
  widenedOpenAiEndpoint,
  widenedPlanEndpoints,
} from './discovery-apply'
import type { CustomModel } from './custom-models'

function plan(endpoints: ServiceEndpoint[]): Plan {
  return { id: 'api', name: 'API', auth: 'api-key', baseUrl: 'https://relay.com', endpoints }
}

describe('discoveryEndpoint', () => {
  it('finds the openai-family endpoint among mixed protocol endpoints', () => {
    const anthropicEp: ServiceEndpoint = { id: 'anthropic', protocols: ['anthropic-messages'] }
    const openaiEp: ServiceEndpoint = { id: 'openai', protocols: ['openai-chat'] }
    expect(discoveryEndpoint(plan([anthropicEp, openaiEp]))).toEqual(openaiEp)
  })

  it('synthesizes an openai probe endpoint when the plan has only other families', () => {
    const anthropicEp: ServiceEndpoint = { id: 'anthropic', protocols: ['anthropic-messages'] }
    expect(discoveryEndpoint(plan([anthropicEp]))).toEqual({ id: 'openai', protocols: ['openai-chat'],
    })
  })

  it('returns undefined when the plan has no endpoints', () => {
    expect(discoveryEndpoint(plan([]))).toBeUndefined()
  })
})

describe('widenedOpenAiEndpoint', () => {
  const models: DiscoveredOpenAiModel[] = [{ id: 'gpt-image-1', tasks: ['image'], byFamily: { openai: ['image'] } }]

  it('returns undefined when nothing is needed (no discovered models)', () => {
    const ep: ServiceEndpoint = { id: 'openai', protocols: ['openai-chat'] }
    expect(widenedOpenAiEndpoint(ep, 'https://relay.com/v1', [])).toBeUndefined()
  })

  it('returns undefined when the endpoint already serves every needed task', () => {
    const ep: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat', 'openai-images'] }
    expect(widenedOpenAiEndpoint(ep, 'https://relay.com/v1', models)).toBeUndefined()
  })

  it('widens protocols (only additive) when a discovered model needs an unserved task', () => {
    const ep: ServiceEndpoint = { id: 'openai', protocols: ['openai-chat'] }
    const widened = widenedOpenAiEndpoint(ep, 'https://relay.com/v1', models)
    expect(widened).toEqual({ id: 'openai', protocols: ['openai-chat', 'openai-images'] })
  })

  it('synthesizes a brand-new endpoint when the plan has none yet', () => {
    const widened = widenedOpenAiEndpoint(undefined, 'https://relay.com/v1', models)
    expect(widened).toEqual({ id: 'openai', protocols: ['openai-images'] })
  })

  it('never drops an existing protocol the endpoint already speaks', () => {
    const ep: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat', 'openai-audio'] }
    const widened = widenedOpenAiEndpoint(ep, 'https://relay.com/v1', models)
    expect(widened?.protocols).toEqual(expect.arrayContaining(['openai-chat', 'openai-audio', 'openai-images']))
  })
})

describe('widenedPlanEndpoints', () => {
  it('adds anthropic and google endpoints when discovered models need them', () => {
    const openaiEp: ServiceEndpoint = { id: 'openai', protocols: ['openai-chat'] }
    const models: DiscoveredOpenAiModel[] = [
      { id: 'gpt-5', tasks: ['chat'], byFamily: { openai: ['chat'] } },
      { id: 'claude-opus', tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
      { id: 'gemini-pro', tasks: ['chat'], byFamily: { google: ['chat'] } },
    ]
    const next = widenedPlanEndpoints(plan([openaiEp]), models)
    expect(next?.map((e) => e.id).sort()).toEqual(['anthropic', 'google', 'openai'])
    // Widening now goes through capabilityEndpoints, so a synthesized anthropic endpoint gets the
    // same tool-search default a hand-picked one does — it used to skip that stamp.
    expect(next?.find((e) => e.id === 'anthropic')).toEqual({ id: 'anthropic', protocols: ['anthropic-messages'],
      defaults: { extraEnv: { ENABLE_TOOL_SEARCH: 'true' } },
    })
    expect(next?.find((e) => e.id === 'google')).toEqual({ id: 'google', protocols: ['google-generative'],
    })
  })

  it('returns undefined when all needed families/tasks already exist', () => {
    const endpoints: ServiceEndpoint[] = [
      { id: 'openai', protocols: ['openai-chat'] },
      { id: 'anthropic', protocols: ['anthropic-messages'] },
    ]
    const models: DiscoveredOpenAiModel[] = [
      { id: 'gpt-5', tasks: ['chat'], byFamily: { openai: ['chat'] } },
      { id: 'claude-opus', tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
    ]
    expect(widenedPlanEndpoints(plan(endpoints), models)).toBeUndefined()
  })

  it('adds a newapi-video endpoint and openai-responses when extras/models need them', () => {
    const openaiEp: ServiceEndpoint = { id: 'openai', protocols: ['openai-chat'] }
    const models: DiscoveredOpenAiModel[] = [
      { id: 'doubao-seedance-1-5-pro', tasks: ['video'], byFamily: { 'newapi-video': ['video'] } },
    ]
    const next = widenedPlanEndpoints(plan([openaiEp]), models, ['openai-responses'])
    expect(next?.find((e) => e.id === 'newapi-video')).toEqual({ id: 'newapi-video', protocols: ['newapi-video'],
    })
    expect(next?.find((e) => e.id === 'openai')?.protocols).toEqual(['openai-responses', 'openai-chat'])
  })

  it('gives each video wire its own endpoint so one relay can serve Sora and Seedance at once', () => {
    const openaiEp: ServiceEndpoint = { id: 'openai', protocols: ['openai-chat'] }
    const models: DiscoveredOpenAiModel[] = [
      { id: 'sora-2', tasks: ['video'], byFamily: { 'openai-video': ['video'] } },
      { id: 'doubao-seedance-2-0-260128', tasks: ['video'], byFamily: { 'newapi-video': ['video'] } },
    ]
    const next = widenedPlanEndpoints(plan([openaiEp]), models)
    expect(next?.find((e) => e.id === 'openai-video')?.protocols).toEqual(['openai-video'])
    expect(next?.find((e) => e.id === 'newapi-video')?.protocols).toEqual(['newapi-video'])
    // The shared family endpoint must not absorb either wire, or per-model routing has nothing to pick from.
    expect(next?.find((e) => e.id === 'openai')?.protocols).toEqual(['openai-chat'])
  })
})

describe('applyDiscoveredModels', () => {
  const openaiEp: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat', 'openai-images'] }
  const anthropicEp: ServiceEndpoint = { id: 'anthropic', protocols: ['anthropic-messages'] }

  it('writes every discovered model into the endpoint override in one batch', () => {
    const models: DiscoveredOpenAiModel[] = [
      { id: 'gpt-5', tasks: ['chat'], byFamily: { openai: ['chat'] } },
      { id: 'gpt-image-1', tasks: ['image'], byFamily: { openai: ['image'] } },
    ]
    const result = applyDiscoveredModels(undefined, plan([openaiEp]), models)
    expect(result.openai.models).toEqual(
      expect.arrayContaining([
        { id: 'gpt-5', name: undefined, tasks: ['chat'] },
        { id: 'gpt-image-1', name: undefined, tasks: ['image'] },
      ]),
    )
  })

  it('routes anthropic models only onto the anthropic endpoint', () => {
    const models: DiscoveredOpenAiModel[] = [
      { id: 'gpt-5', tasks: ['chat'], byFamily: { openai: ['chat'] } },
      { id: 'claude-opus', tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
    ]
    const result = applyDiscoveredModels(undefined, plan([openaiEp, anthropicEp]), models)
    expect(result.openai.models).toEqual([{ id: 'gpt-5', name: undefined, tasks: ['chat'] }])
    expect(result.anthropic.models).toEqual([{ id: 'claude-opus', name: undefined, tasks: ['chat'] }])
  })

  it('preserves models already present in overrides that are untouched by this batch', () => {
    const existing = { openai: { models: [{ id: 'existing-model', tasks: ['chat'] as CapabilityTask[] }] } }
    const models: DiscoveredOpenAiModel[] = [{ id: 'gpt-5', tasks: ['chat'], byFamily: { openai: ['chat'] } }]
    const result = applyDiscoveredModels(existing, plan([openaiEp]), models)
    expect(result.openai.models?.map((m) => m.id).sort()).toEqual(['existing-model', 'gpt-5'])
  })
})

describe('mergeDiscoveredIntoCustomModels', () => {
  it('appends discovered models not already present by id', () => {
    const existing: CustomModel[] = [{ id: 'my-manual-model', tasks: ['chat'] }]
    const discovered: DiscoveredOpenAiModel[] = [
      { id: 'gpt-5', name: 'GPT-5', tasks: ['chat'], byFamily: { openai: ['chat'] } },
    ]
    expect(mergeDiscoveredIntoCustomModels(existing, discovered)).toEqual([
      { id: 'my-manual-model', tasks: ['chat'] },
      { id: 'gpt-5', name: 'GPT-5', tasks: ['chat'], byFamily: { openai: ['chat'] } },
    ])
  })

  it('does not overwrite a manually-entered model sharing the same id (user wins)', () => {
    const existing: CustomModel[] = [{ id: 'gpt-5', name: 'My Custom Name', tasks: ['image'] }]
    const discovered: DiscoveredOpenAiModel[] = [
      { id: 'gpt-5', name: 'GPT-5', tasks: ['chat'], byFamily: { openai: ['chat'] } },
    ]
    expect(mergeDiscoveredIntoCustomModels(existing, discovered)).toEqual(existing)
  })
})

describe('excludeDiscoveredIds', () => {
  it('filters out custom models that are also present in the discovered pool', () => {
    const customModels: CustomModel[] = [
      { id: 'gpt-5', tasks: ['chat'] },
      { id: 'my-manual-model', tasks: ['chat'] },
    ]
    const discovered: DiscoveredOpenAiModel[] = [{ id: 'gpt-5', tasks: ['chat'], byFamily: { openai: ['chat'] } }]
    expect(excludeDiscoveredIds(customModels, discovered)).toEqual([{ id: 'my-manual-model', tasks: ['chat'] }])
  })

  it('keeps all custom models when none overlap with the discovered pool', () => {
    const customModels: CustomModel[] = [{ id: 'my-manual-model', tasks: ['chat'] }]
    expect(excludeDiscoveredIds(customModels, [])).toEqual(customModels)
  })
})

describe('applyCatalogDisplayNames', () => {
  const index = new Map<string, { name: string }>([
    ['gpt-4o', { name: 'GPT-4o' }],
    ['claude-sonnet-4', { name: 'Claude Sonnet 4' }],
  ])

  it('fills official names when the row still shows a raw id', () => {
    const models: DiscoveredOpenAiModel[] = [
      { id: 'gpt-4o', tasks: ['chat'], byFamily: { openai: ['chat'] } },
      { id: 'vendor/claude-sonnet-4', name: 'vendor/claude-sonnet-4', tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
    ]
    expect(applyCatalogDisplayNames(models, index).map((m) => m.name)).toEqual(['GPT-4o', 'Claude Sonnet 4'])
  })

  it('does not overwrite a name the user or relay already set', () => {
    const models: DiscoveredOpenAiModel[] = [
      { id: 'gpt-4o', name: 'My GPT', tasks: ['chat'], byFamily: { openai: ['chat'] } },
    ]
    expect(applyCatalogDisplayNames(models, index)).toBe(models)
  })
})

describe('patchDiscoveredModel', () => {
  it('rewrites display name and redistributes new tasks onto existing families', () => {
    const model: DiscoveredOpenAiModel = {
      id: 'gpt-4o',
      name: 'GPT-4o',
      tasks: ['chat'],
      byFamily: { openai: ['chat'] },
    }
    expect(patchDiscoveredModel(model, { name: '  4o  ', tasks: ['chat', 'image'] })).toEqual({
      id: 'gpt-4o',
      name: '4o',
      tasks: ['chat', 'image'],
      byFamily: { openai: ['chat', 'image'] },
    })
  })

  it('routes a task the current family cannot serve onto a family that can', () => {
    const model: DiscoveredOpenAiModel = {
      id: 'claude-opus',
      tasks: ['chat'],
      byFamily: { anthropic: ['chat'] },
    }
    const next = patchDiscoveredModel(model, { tasks: ['chat', 'image'] })
    expect(next.byFamily.anthropic).toEqual(['chat'])
    expect(next.byFamily.openai).toEqual(['image'])
    expect(next.tasks).toEqual(['chat', 'image'])
  })
})

describe('discoveredFromEndpoints', () => {
  it('rebuilds a discovered list from enabled endpoint models', () => {
    const endpoints: ServiceEndpoint[] = [
      { id: 'openai', protocols: ['openai-chat'], models: [{ id: 'gpt-5', name: 'GPT-5', tasks: ['chat'] }] },
      { id: 'anthropic', protocols: ['anthropic-messages'], models: [{ id: 'claude-opus', tasks: ['chat'] }] },
    ]
    expect(discoveredFromEndpoints(endpoints)).toEqual([
      { id: 'gpt-5', name: 'GPT-5', tasks: ['chat'], byFamily: { openai: ['chat'] } },
      { id: 'claude-opus', name: undefined, tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
    ])
  })

  it('unions the same model id across families', () => {
    const endpoints: ServiceEndpoint[] = [
      { id: 'openai', protocols: ['openai-chat'], models: [{ id: 'glm-5', tasks: ['chat'] }] },
      { id: 'anthropic', protocols: ['anthropic-messages'], models: [{ id: 'glm-5', tasks: ['chat'] }] },
    ]
    expect(discoveredFromEndpoints(endpoints)).toEqual([
      { id: 'glm-5', name: undefined, tasks: ['chat'], byFamily: { openai: ['chat'], anthropic: ['chat'] } },
    ])
  })
})

describe('cachedDiscoveredModels', () => {
  it('prefers the persisted cache over endpoint inference', () => {
    const cached: DiscoveredOpenAiModel[] = [{ id: 'gpt-5', tasks: ['chat'], byFamily: { openai: ['chat'] } }]
    const endpoints: ServiceEndpoint[] = [
      { id: 'openai', protocols: ['openai-chat'], models: [{ id: 'other', tasks: ['chat'] }] },
    ]
    expect(cachedDiscoveredModels(cached, endpoints)).toBe(cached)
  })

  it('falls back to endpoint models when the cache is empty', () => {
    const endpoints: ServiceEndpoint[] = [
      { id: 'openai', protocols: ['openai-chat'], models: [{ id: 'gpt-5', tasks: ['chat'] }] },
    ]
    expect(cachedDiscoveredModels([], endpoints)).toEqual([
      { id: 'gpt-5', name: undefined, tasks: ['chat'], byFamily: { openai: ['chat'] } },
    ])
  })
})

describe('pinning a model to an endpoint', () => {
  const seedance: DiscoveredOpenAiModel = {
    id: 'doubao-seedance-2-0-260128',
    tasks: ['video'],
    byFamily: { 'newapi-video': ['video'] },
  }

  it('reports the endpoint currently serving each task', () => {
    expect(modelSlotsByTask(seedance)).toEqual({ video: 'newapi-video' })
  })

  it('moves the model onto the endpoint the user picked', () => {
    const next = patchDiscoveredModel(seedance, { tasks: ['video'], slots: { video: 'ark-video' } })
    expect(next.byFamily).toEqual({ 'ark-video': ['video'] })
    expect(next.tasks).toEqual(['video'])
  })

  it('keeps inferring when no pin is given, rather than resetting to a default wire', () => {
    const next = patchDiscoveredModel(seedance, { tasks: ['video'] })
    expect(next.byFamily).toEqual({ 'newapi-video': ['video'] })
  })

  it('drops a pin for a task the user unticked', () => {
    const both: DiscoveredOpenAiModel = {
      id: 'omni',
      tasks: ['image', 'video'],
      byFamily: { openai: ['image'], 'ark-video': ['video'] },
    }
    const next = patchDiscoveredModel(both, { tasks: ['image'], slots: { image: 'openai' } })
    expect(next.byFamily).toEqual({ openai: ['image'] })
    expect(next.tasks).toEqual(['image'])
  })

  it('offers only endpoints this key actually has, and never an archived one', () => {
    const endpoints: ServiceEndpoint[] = [
      { id: 'openai-video', protocols: ['openai-video'] },
      { id: 'newapi-video', protocols: ['newapi-video'] },
      { id: 'ark-video', protocols: ['ark-video'], disabled: true },
      { id: 'openai', protocols: ['openai-chat'] },
    ]
    expect(slotOptionsForTask(endpoints, 'video')).toEqual(['openai-video', 'newapi-video'])
    expect(slotOptionsForTask(endpoints, 'chat')).toEqual(['openai'])
  })
})
