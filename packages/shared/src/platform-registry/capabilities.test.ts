import { describe, expect, it } from 'vitest'
import { applyCapabilitiesToPlan, capabilityEndpoints, planCapabilities, rebaseEndpoints } from './capabilities'
import { customPlatformEndpoints } from './protocols'
import type { Plan } from './types'

function planOf(endpoints: Plan['endpoints']): Plan {
  return { id: 'api', name: 'API', auth: 'api-key', endpoints }
}

describe('plan capability projection', () => {
  it('round-trips a multi-format plan through its capability selection', () => {
    const endpoints = customPlatformEndpoints(
      { anthropic: ['chat'], openai: ['chat', 'image'] },
      'https://relay.example.com',
      { openai: ['openai-responses'] },
    )
    const plan = planOf(endpoints)

    const caps = planCapabilities(plan)
    expect(caps.families).toEqual(['anthropic', 'openai'])
    expect(caps.tasks.openai).toEqual(['chat', 'image'])
    expect(caps.extras.openai).toEqual(['openai-responses'])
    expect(caps.baseUrl).toBe('https://relay.example.com')

    expect(capabilityEndpoints(caps, caps.baseUrl)).toEqual(endpoints)
  })

  it('recovers a responses-only endpoint as an extra wire without checking chat', () => {
    const plan = planOf(customPlatformEndpoints({ openai: [] }, 'https://relay.example.com', { openai: ['openai-responses'] }))
    const caps = planCapabilities(plan)
    expect(caps.tasks.openai).toEqual([])
    expect(caps.extras.openai).toEqual(['openai-responses'])
  })

  it('preserves an endpoint\'s defaults when its capabilities are re-picked', () => {
    const plan = planOf(
      customPlatformEndpoints({ openai: ['chat'] }, 'https://relay.example.com').map((e) => ({
        ...e,
        defaults: { extraEnv: { KEEP_ME: '1' } },
      })),
    )

    const next = applyCapabilitiesToPlan(
      plan,
      { families: ['openai'], tasks: { openai: ['chat', 'image'] }, extras: {} },
      'https://relay.example.com',
    )

    expect(next[0].protocols).toEqual(['openai-chat', 'openai-images'])
    expect(next[0].defaults).toEqual({ extraEnv: { KEEP_ME: '1' } })
  })

  it('gives a single-capability format its one task implicitly', () => {
    const endpoints = capabilityEndpoints({ families: ['anthropic'], tasks: {}, extras: {} }, 'https://relay.example.com')
    expect(endpoints).toHaveLength(1)
    expect(endpoints[0].protocols).toEqual(['anthropic-messages'])
  })

  it('recovers the site root from an openai-only plan (not the /v1 family URL)', () => {
    const plan = planOf(customPlatformEndpoints({ openai: ['chat'] }, 'https://relay.example.com'))
    expect(plan.endpoints[0].baseUrl).toBe('https://relay.example.com/v1')
    expect(planCapabilities(plan).baseUrl).toBe('https://relay.example.com')
  })

  it('rebases every family URL from a new site root and keeps models', () => {
    const endpoints = customPlatformEndpoints(
      { anthropic: ['chat'], openai: ['chat'] },
      'https://old.example.com',
    ).map((e) => (e.id === 'openai' ? { ...e, models: [{ id: 'gpt-5', tasks: ['chat' as const] }] } : e))

    const next = rebaseEndpoints(endpoints, 'https://new.example.com')
    expect(next.find((e) => e.id === 'openai')?.baseUrl).toBe('https://new.example.com/v1')
    expect(next.find((e) => e.id === 'anthropic')?.baseUrl).toBe('https://new.example.com')
    expect(next.find((e) => e.id === 'openai')?.models).toEqual([{ id: 'gpt-5', tasks: ['chat'] }])
  })
})
