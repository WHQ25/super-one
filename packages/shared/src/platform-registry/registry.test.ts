import { describe, expect, it } from 'vitest'
import {
  assembleRegistry,
  BUILTIN_PLATFORMS,
  endpointTasks,
  everyHarnessReachable,
  findPlatform,
  PROTOCOL_TASKS,
  selectEndpoint,
  synthesizePlatformFromCatalog,
  validatePlatform,
  validateRegistry,
} from './index'
import type { Platform } from './types'

describe('builtin registry', () => {
  it('passes structural validation (unique ids, tasks ⊆ protocol tasks)', () => {
    expect(validateRegistry(BUILTIN_PLATFORMS)).toEqual([])
  })

  it('every endpoint task is a subset of its protocol tasks', () => {
    for (const platform of BUILTIN_PLATFORMS) {
      for (const plan of platform.plans) {
        for (const endpoint of plan.endpoints) {
          for (const t of endpointTasks(endpoint)) {
            expect(PROTOCOL_TASKS[endpoint.protocol]).toContain(t)
          }
        }
      }
    }
  })

  it('is reachable by both claude and codex chat consumers', () => {
    expect(everyHarnessReachable(BUILTIN_PLATFORMS)).toBe(true)
  })

  it('keeps CN and Global as separate platforms with distinct brands', () => {
    const cn = findPlatform(BUILTIN_PLATFORMS, 'zhipu-cn')
    const global = findPlatform(BUILTIN_PLATFORMS, 'zhipu-global')
    expect(cn?.brand).toBe('zhipu')
    expect(global?.brand).toBe('zai')
    expect(cn?.id).not.toBe(global?.id)
  })

  it('official oauth platforms carry an oauth plan and no api key url', () => {
    const claude = findPlatform(BUILTIN_PLATFORMS, 'claude-official')
    expect(claude?.plans[0].auth).toBe('oauth')
    expect(claude?.plans[0].apiKeyUrl).toBeUndefined()
  })
})

describe('selectEndpoint', () => {
  it('picks the anthropic endpoint for chat:claude and openai for chat:codex on a dual-endpoint plan', () => {
    const openrouter = findPlatform(BUILTIN_PLATFORMS, 'openrouter')!
    const plan = openrouter.plans[0]
    expect(selectEndpoint(plan, 'chat:claude')?.protocol).toBe('anthropic-messages')
    expect(selectEndpoint(plan, 'chat:codex')?.protocol).toBe('openai-chat')
  })

  it('returns undefined when the plan cannot serve the consumer', () => {
    const anthropicPlatform = findPlatform(BUILTIN_PLATFORMS, 'anthropic')!
    expect(selectEndpoint(anthropicPlatform.plans[0], 'chat:codex')).toBeUndefined()
  })

  it('honors an explicit valid endpointId', () => {
    const openrouter = findPlatform(BUILTIN_PLATFORMS, 'openrouter')!
    const plan = openrouter.plans[0]
    expect(selectEndpoint(plan, 'chat:claude', 'anthropic')?.id).toBe('anthropic')
  })
})

describe('validatePlatform', () => {
  it('flags an endpoint task that its protocol does not serve', () => {
    const bad: Platform = {
      id: 'bad',
      brand: 'bad',
      name: 'Bad',
      plans: [
        {
          id: 'api',
          name: 'API',
          auth: 'api-key',
          endpoints: [{ id: 'x', protocol: 'anthropic-messages', baseUrl: '', tasks: ['image'] }],
        },
      ],
    }
    expect(validatePlatform(bad).length).toBeGreaterThan(0)
  })
})

describe('assembleRegistry', () => {
  it('lets a custom platform override a builtin of the same id', () => {
    const custom: Platform = { id: 'anthropic', brand: 'x', name: 'Overridden', plans: [] }
    const merged = assembleRegistry(BUILTIN_PLATFORMS, [custom])
    expect(findPlatform(merged, 'anthropic')?.name).toBe('Overridden')
    expect(merged.filter((p) => p.id === 'anthropic')).toHaveLength(1)
  })
})

describe('synthesizePlatformFromCatalog', () => {
  it('builds a single api plan with one openai-chat endpoint', () => {
    const platform = synthesizePlatformFromCatalog({
      id: 'groq',
      name: 'Groq',
      npm: '@ai-sdk/groq',
      api: 'https://api.groq.com/openai/v1',
      env: ['GROQ_API_KEY'],
      doc: 'https://console.groq.com/docs',
      models: [],
    })
    expect(platform.id).toBe('catalog:groq')
    expect(platform.plans[0].endpoints[0].protocol).toBe('openai-chat')
    expect(platform.plans[0].endpoints[0].baseUrl).toBe('https://api.groq.com/openai/v1')
  })
})
