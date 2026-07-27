import { describe, expect, it } from 'vitest'
import type { CapabilityTask, DiscoveredOpenAiModel } from '@superone/shared/agent-types'
import type { Plan, ServiceEndpoint } from '@superone/shared/platform-registry'
import {
  applyDiscoveredModels,
  discoveryEndpoint,
  excludeDiscoveredIds,
  mergeDiscoveredIntoCustomModels,
  widenedOpenAiEndpoint,
  widenedPlanEndpoints,
} from './discovery-apply'
import type { CustomModel } from './custom-models'

function plan(endpoints: ServiceEndpoint[]): Plan {
  return { id: 'api', name: 'API', auth: 'api-key', endpoints }
}

describe('discoveryEndpoint', () => {
  it('finds the openai-family endpoint among mixed protocol endpoints', () => {
    const anthropicEp: ServiceEndpoint = { id: 'anthropic', baseUrl: 'https://relay.com', protocols: ['anthropic-messages'] }
    const openaiEp: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat'] }
    expect(discoveryEndpoint(plan([anthropicEp, openaiEp]))).toEqual(openaiEp)
  })

  it('synthesizes an openai probe endpoint when the plan has only other families', () => {
    const anthropicEp: ServiceEndpoint = { id: 'anthropic', baseUrl: 'https://relay.com', protocols: ['anthropic-messages'] }
    expect(discoveryEndpoint(plan([anthropicEp]))).toEqual({
      id: 'openai',
      baseUrl: 'https://relay.com/v1',
      protocols: ['openai-chat'],
    })
  })

  it('returns undefined when the plan has no endpoints', () => {
    expect(discoveryEndpoint(plan([]))).toBeUndefined()
  })
})

describe('widenedOpenAiEndpoint', () => {
  const models: DiscoveredOpenAiModel[] = [{ id: 'gpt-image-1', tasks: ['image'], byFamily: { openai: ['image'] } }]

  it('returns undefined when nothing is needed (no discovered models)', () => {
    const ep: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat'] }
    expect(widenedOpenAiEndpoint(ep, 'https://relay.com/v1', [])).toBeUndefined()
  })

  it('returns undefined when the endpoint already serves every needed task', () => {
    const ep: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat', 'openai-images'] }
    expect(widenedOpenAiEndpoint(ep, 'https://relay.com/v1', models)).toBeUndefined()
  })

  it('widens protocols (only additive) when a discovered model needs an unserved task', () => {
    const ep: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat'] }
    const widened = widenedOpenAiEndpoint(ep, 'https://relay.com/v1', models)
    expect(widened).toEqual({ id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat', 'openai-images'] })
  })

  it('synthesizes a brand-new endpoint when the plan has none yet', () => {
    const widened = widenedOpenAiEndpoint(undefined, 'https://relay.com/v1', models)
    expect(widened).toEqual({ id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-images'] })
  })

  it('never drops an existing protocol the endpoint already speaks', () => {
    const ep: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat', 'openai-audio'] }
    const widened = widenedOpenAiEndpoint(ep, 'https://relay.com/v1', models)
    expect(widened?.protocols).toEqual(expect.arrayContaining(['openai-chat', 'openai-audio', 'openai-images']))
  })
})

describe('widenedPlanEndpoints', () => {
  it('adds anthropic and google endpoints when discovered models need them', () => {
    const openaiEp: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat'] }
    const models: DiscoveredOpenAiModel[] = [
      { id: 'gpt-5', tasks: ['chat'], byFamily: { openai: ['chat'] } },
      { id: 'claude-opus', tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
      { id: 'gemini-pro', tasks: ['chat'], byFamily: { google: ['chat'] } },
    ]
    const next = widenedPlanEndpoints(plan([openaiEp]), 'https://relay.com/v1', models)
    expect(next?.map((e) => e.id).sort()).toEqual(['anthropic', 'google', 'openai'])
    expect(next?.find((e) => e.id === 'anthropic')).toEqual({
      id: 'anthropic',
      baseUrl: 'https://relay.com',
      protocols: ['anthropic-messages'],
    })
    expect(next?.find((e) => e.id === 'google')).toEqual({
      id: 'google',
      baseUrl: 'https://relay.com/v1beta',
      protocols: ['google-generative'],
    })
  })

  it('returns undefined when all needed families/tasks already exist', () => {
    const endpoints: ServiceEndpoint[] = [
      { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat'] },
      { id: 'anthropic', baseUrl: 'https://relay.com', protocols: ['anthropic-messages'] },
    ]
    const models: DiscoveredOpenAiModel[] = [
      { id: 'gpt-5', tasks: ['chat'], byFamily: { openai: ['chat'] } },
      { id: 'claude-opus', tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
    ]
    expect(widenedPlanEndpoints(plan(endpoints), 'https://relay.com', models)).toBeUndefined()
  })
})

describe('applyDiscoveredModels', () => {
  const openaiEp: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat', 'openai-images'] }
  const anthropicEp: ServiceEndpoint = { id: 'anthropic', baseUrl: 'https://relay.com', protocols: ['anthropic-messages'] }

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
