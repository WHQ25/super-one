import { describe, expect, it } from 'vitest'
import { applyCapabilitiesToPlan, capabilityEndpoints, planCapabilities } from './capabilities'
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
})
