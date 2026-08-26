import { describe, expect, it } from 'vitest'
import {
  cloneEndpoints,
  effectiveEndpoints,
  ENABLE_TOOL_SEARCH_ENV,
  foldOverridesIntoEndpoints,
  isCustomPlatform,
  withCustomAnthropicDefaults,
} from './effective-endpoints'
import type { Plan, Platform, ServiceEndpoint } from './types'

const anthropic: ServiceEndpoint = {
  id: 'anthropic',
  baseUrl: 'https://relay.com',
  protocols: ['anthropic-messages'],
  defaults: { modelMapping: { default: { id: 'claude-a' } }, extraEnv: { A: '1' } },
}
const openai: ServiceEndpoint = {
  id: 'openai',
  baseUrl: 'https://relay.com/v1',
  protocols: ['openai-chat'],
}

const customPlatform: Platform = {
  id: 'custom:abc',
  brand: 'custom',
  name: 'Relay',
  plans: [{ id: 'api', name: 'API', auth: 'api-key', endpoints: [anthropic, openai] }],
}

const plan: Plan = customPlatform.plans[0]

describe('foldOverridesIntoEndpoints', () => {
  it('merges baseUrl/models/env/mapping onto the matching endpoint only', () => {
    const folded = foldOverridesIntoEndpoints(plan.endpoints, {
      anthropic: {
        baseUrl: 'https://key-a.example',
        modelMapping: { sonnet: { id: 's' } },
        extraEnv: { B: '2' },
      },
      openai: { models: [{ id: 'gpt-x', tasks: ['chat'] }] },
    })
    expect(folded[0].baseUrl).toBe('https://key-a.example')
    expect(folded[0].defaults?.extraEnv).toEqual({ A: '1', B: '2' })
    expect(folded[0].defaults?.modelMapping).toEqual({
      default: { id: 'claude-a' },
      sonnet: { id: 's' },
    })
    expect(folded[1].baseUrl).toBe(openai.baseUrl)
    expect(folded[1].models).toEqual([{ id: 'gpt-x', tasks: ['chat'] }])
  })
})

describe('effectiveEndpoints', () => {
  it('returns plan endpoints for builtin platforms', () => {
    const builtin: Platform = { id: 'openrouter', brand: 'openrouter', name: 'OR', plans: [plan] }
    expect(effectiveEndpoints(builtin, plan, { endpoints: [anthropic] })).toEqual(plan.endpoints)
  })

  it('prefers credential.endpoints for custom platforms and defaults tool search on', () => {
    const keyOnly: ServiceEndpoint[] = [
      { id: 'anthropic', baseUrl: 'https://key-only', protocols: ['anthropic-messages'] },
    ]
    expect(effectiveEndpoints(customPlatform, plan, { endpoints: keyOnly })).toEqual(
      withCustomAnthropicDefaults(keyOnly),
    )
  })

  it('falls back to plan + overrides when custom key has no endpoints yet', () => {
    const eps = effectiveEndpoints(customPlatform, plan, {
      overrides: { openai: { baseUrl: 'https://over/v1' } },
    })
    expect(eps.find((e) => e.id === 'openai')?.baseUrl).toBe('https://over/v1')
    expect(eps.find((e) => e.id === 'anthropic')?.baseUrl).toBe(anthropic.baseUrl)
  })

  it('defaults ENABLE_TOOL_SEARCH=true on custom anthropic endpoints', () => {
    const bare: ServiceEndpoint = {
      id: 'anthropic',
      baseUrl: 'https://relay.com',
      protocols: ['anthropic-messages'],
    }
    const platform: Platform = {
      id: 'custom:tool-search',
      brand: 'custom',
      name: 'Relay',
      plans: [{ id: 'api', name: 'API', auth: 'api-key', endpoints: [bare, openai] }],
    }
    const eps = effectiveEndpoints(platform, platform.plans[0])
    expect(eps.find((e) => e.id === 'anthropic')?.defaults?.extraEnv).toEqual({
      [ENABLE_TOOL_SEARCH_ENV]: 'true',
    })
    expect(eps.find((e) => e.id === 'openai')?.defaults?.extraEnv).toBeUndefined()
  })

  it('does not override an explicit ENABLE_TOOL_SEARCH on a custom anthropic endpoint', () => {
    const off: ServiceEndpoint = {
      id: 'anthropic',
      baseUrl: 'https://relay.com',
      protocols: ['anthropic-messages'],
      defaults: { extraEnv: { [ENABLE_TOOL_SEARCH_ENV]: 'false', KEEP: '1' } },
    }
    const platform: Platform = {
      id: 'custom:tool-search-off',
      brand: 'custom',
      name: 'Relay',
      plans: [{ id: 'api', name: 'API', auth: 'api-key', endpoints: [off] }],
    }
    expect(effectiveEndpoints(platform, platform.plans[0])[0].defaults?.extraEnv).toEqual({
      [ENABLE_TOOL_SEARCH_ENV]: 'false',
      KEEP: '1',
    })
  })
})

describe('cloneEndpoints', () => {
  it('deep-clones so mutating the clone does not touch the source', () => {
    const cloned = cloneEndpoints([anthropic])
    cloned[0].baseUrl = 'mutated'
    cloned[0].protocols.push('openai-chat' as never)
    expect(anthropic.baseUrl).toBe('https://relay.com')
    expect(anthropic.protocols).toEqual(['anthropic-messages'])
  })
})

describe('isCustomPlatform', () => {
  it('detects custom: prefix', () => {
    expect(isCustomPlatform(customPlatform)).toBe(true)
    expect(isCustomPlatform({ id: 'moonshot' })).toBe(false)
  })
})

describe('routes survive the credential layer', () => {
  // A route override is the only record of "this relay answers Anthropic at /api/anthropic/v1".
  // Anything that copies an endpoint and drops it silently sends the harness to the default path.
  const routed: ServiceEndpoint = {
    id: 'anthropic',
    protocols: ['anthropic-messages'],
    routes: { 'anthropic-messages': '/api/anthropic/v1/messages' },
  }

  it('foldOverridesIntoEndpoints keeps a route the endpoint already carries', () => {
    const [folded] = foldOverridesIntoEndpoints([routed], { anthropic: { models: [] } })
    expect(folded.routes).toEqual({ 'anthropic-messages': '/api/anthropic/v1/messages' })
  })

  it('foldOverridesIntoEndpoints lets the override replace the route', () => {
    const [folded] = foldOverridesIntoEndpoints([routed], {
      anthropic: { routes: { 'anthropic-messages': '/relay/v1/messages' } },
    })
    expect(folded.routes).toEqual({ 'anthropic-messages': '/relay/v1/messages' })
  })

  it('cloneEndpoints deep-copies routes so keys never share one object', () => {
    const [clone] = cloneEndpoints([routed])
    expect(clone.routes).toEqual(routed.routes)
    clone.routes!['anthropic-messages'] = '/mutated'
    expect(routed.routes!['anthropic-messages']).toBe('/api/anthropic/v1/messages')
  })
})
