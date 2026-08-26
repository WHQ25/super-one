import { describe, expect, it } from 'vitest'
import {
  applyCapabilitiesToPlan,
  capabilityEndpoints,
  endpointHasConfig,
  overrideEndpointBaseUrl,
  overrideEndpointRoute,
  planCapabilities,
} from './capabilities'
import { ENABLE_TOOL_SEARCH_ENV, withCustomAnthropicDefaults } from './effective-endpoints'
import { customEndpointsFor, endpointBaseUrl } from './protocols'
import type { Plan } from './types'

function planOf(endpoints: Plan['endpoints'], baseUrl = 'https://relay.example.com'): Plan {
  return { id: 'api', name: 'API', auth: 'api-key', baseUrl, endpoints }
}

describe('plan protocol projection', () => {
  it('round-trips a multi-format plan through its protocol selection', () => {
    const protocols = ['anthropic-messages', 'openai-responses', 'openai-chat', 'openai-images'] as const
    const endpoints = customEndpointsFor([...protocols])
    const caps = planCapabilities(planOf(endpoints))

    expect(caps.protocols).toEqual([...protocols])
    expect(capabilityEndpoints(caps)).toEqual(withCustomAnthropicDefaults(endpoints))
  })

  it('recovers a responses-only endpoint without inferring chat/completions alongside it', () => {
    expect(planCapabilities(planOf(customEndpointsFor(['openai-responses']))).protocols).toEqual(['openai-responses'])
  })

  it("preserves an endpoint's defaults and models when a protocol is added", () => {
    const plan = planOf(
      customEndpointsFor(['openai-chat']).map((e) => ({
        ...e,
        defaults: { extraEnv: { KEEP_ME: '1' } },
        models: [{ id: 'gpt-5', tasks: ['chat' as const] }],
      })),
    )

    const next = applyCapabilitiesToPlan(plan, { protocols: ['openai-chat', 'openai-images'] })

    expect(next[0].protocols).toEqual(['openai-chat', 'openai-images'])
    expect(next[0].defaults).toEqual({ extraEnv: { KEEP_ME: '1' } })
    expect(next[0].models).toEqual([{ id: 'gpt-5', tasks: ['chat'] }])
  })

  it('stamps tool search onto a custom anthropic endpoint', () => {
    const endpoints = capabilityEndpoints({ protocols: ['anthropic-messages'] })
    expect(endpoints).toHaveLength(1)
    expect(endpoints[0].defaults?.extraEnv?.[ENABLE_TOOL_SEARCH_ENV]).toBe('true')
  })

  it('moving the site root touches no endpoint at all', () => {
    // The reason the root moved onto the plan: endpoints are relative to it by route, so relocating
    // a relay is one field, not a rewrite of every stored URL.
    const endpoints = customEndpointsFor(['anthropic-messages', 'openai-chat', 'ark-video'])
    const before = planOf(endpoints, 'https://old.example.com')
    const after = planOf(endpoints, 'https://new.example.com')

    expect(after.endpoints).toEqual(before.endpoints)
    expect(endpointBaseUrl(after.baseUrl, after.endpoints[1], 'openai-chat')).toBe('https://new.example.com/v1')
    expect(endpointBaseUrl(after.baseUrl, after.endpoints[2], 'ark-video')).toBe('https://new.example.com/api/v3')
  })
})

describe('route overrides', () => {
  const endpoints = customEndpointsFor(['anthropic-messages', 'openai-chat'])

  it('stores a vendor path and resolves the SDK base from it', () => {
    const next = overrideEndpointRoute(endpoints, 'anthropic', 'anthropic-messages', '/api/anthropic/v1/messages')
    expect(next[0].routes).toEqual({ 'anthropic-messages': '/api/anthropic/v1/messages' })
    expect(endpointBaseUrl('https://open.bigmodel.cn', next[0], 'anthropic-messages')).toBe(
      'https://open.bigmodel.cn/api/anthropic',
    )
  })

  it('clears rather than stores an override equal to the default route', () => {
    const set = overrideEndpointRoute(endpoints, 'openai', 'openai-chat', '/other/chat/completions')
    expect(set[1].routes).toBeDefined()
    const cleared = overrideEndpointRoute(set, 'openai', 'openai-chat', '/v1/chat/completions')
    expect(cleared[1].routes).toBeUndefined()
  })

  it('survives toggling an unrelated protocol', () => {
    const routed = overrideEndpointRoute(endpoints, 'anthropic', 'anthropic-messages', '/api/anthropic/v1/messages')
    const next = applyCapabilitiesToPlan(planOf(routed), {
      protocols: ['anthropic-messages', 'openai-chat', 'openai-images'],
    })
    expect(next.find((e) => e.id === 'anthropic')?.routes).toEqual({
      'anthropic-messages': '/api/anthropic/v1/messages',
    })
  })

  it('keeps a per-endpoint host override too', () => {
    const moved = overrideEndpointBaseUrl(endpoints, 'openai', 'https://elsewhere.example.com')
    const next = applyCapabilitiesToPlan(planOf(moved), { protocols: ['anthropic-messages', 'openai-chat'] })
    expect(next.find((e) => e.id === 'openai')?.baseUrl).toBe('https://elsewhere.example.com')
    const cleared = overrideEndpointBaseUrl(moved, 'openai', '')
    expect(cleared[1].baseUrl).toBeUndefined()
  })
})

describe('switching an endpoint off', () => {
  it('archives a configured endpoint instead of dropping its settings', () => {
    const endpoints = customEndpointsFor(['openai-chat', 'ark-video']).map((e) =>
      e.id === 'ark-video' ? { ...e, models: [{ id: 'seedance', tasks: ['video' as const] }] } : e,
    )
    const next = applyCapabilitiesToPlan(planOf(endpoints), { protocols: ['openai-chat'] })

    const archived = next.find((e) => e.id === 'ark-video')
    expect(archived?.disabled).toBe(true)
    expect(archived?.models).toEqual([{ id: 'seedance', tasks: ['video'] }])
    expect(planCapabilities(planOf(next)).protocols).toEqual(['openai-chat'])
  })

  it('restores the archived configuration when the protocol comes back on', () => {
    const endpoints = customEndpointsFor(['openai-chat', 'ark-video']).map((e) =>
      e.id === 'ark-video' ? { ...e, models: [{ id: 'seedance', tasks: ['video' as const] }] } : e,
    )
    const off = applyCapabilitiesToPlan(planOf(endpoints), { protocols: ['openai-chat'] })
    const backOn = applyCapabilitiesToPlan(planOf(off), { protocols: ['openai-chat', 'ark-video'] })

    const revived = backOn.find((e) => e.id === 'ark-video')
    expect(revived?.disabled).toBeUndefined()
    expect(revived?.models).toEqual([{ id: 'seedance', tasks: ['video'] }])
  })

  it('drops a bare endpoint rather than archiving it forever', () => {
    const next = applyCapabilitiesToPlan(planOf(customEndpointsFor(['openai-chat', 'ark-video'])), {
      protocols: ['openai-chat'],
    })
    expect(next.map((e) => e.id)).toEqual(['openai'])
  })
})

describe('endpointHasConfig', () => {
  it('counts a route override as configuration worth keeping', () => {
    const [bare] = customEndpointsFor(['anthropic-messages'])
    expect(endpointHasConfig(bare)).toBe(false)
    const routed = overrideEndpointRoute([bare], 'anthropic', 'anthropic-messages', '/api/anthropic/v1/messages')
    expect(endpointHasConfig(routed[0])).toBe(true)
  })
})
