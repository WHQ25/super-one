import { describe, expect, it } from 'vitest'
import type { EndpointTestResult } from '@superone/shared/agent-types'
import type { Plan, ServiceEndpoint } from '@superone/shared/platform-registry'
import {
  formatEndpointTestFailures,
  planTestEndpoints,
  singleTestEndpoint,
} from './test-endpoints'

const anthropic: ServiceEndpoint = {
  id: 'anthropic',
  baseUrl: 'https://api.moonshot.cn/anthropic',
  protocols: ['anthropic-messages'],
}
const openai: ServiceEndpoint = {
  id: 'openai',
  baseUrl: 'https://api.moonshot.cn/v1',
  protocols: ['openai-chat'],
}

const plan: Plan = {
  id: 'api',
  name: 'API',
  auth: 'api-key',
  baseUrl: 'https://api.moonshot.cn',
  endpoints: [anthropic, openai],
}

describe('planTestEndpoints', () => {
  it('returns every endpoint, not only the first', () => {
    const eps = planTestEndpoints(plan, undefined)
    expect(eps.map((e) => e.id)).toEqual(['anthropic', 'openai'])
    expect(eps[0].baseUrl).toBe(anthropic.baseUrl)
    expect(eps[1].baseUrl).toBe(openai.baseUrl)
  })

  it('applies overrides only to the matching endpoint id', () => {
    const eps = planTestEndpoints(plan, {
      openai: { baseUrl: 'https://override.example/v1' },
      anthropic: { baseUrl: 'https://claude.override/anthropic' },
    })
    expect(eps.find((e) => e.id === 'openai')?.baseUrl).toBe('https://override.example/v1')
    expect(eps.find((e) => e.id === 'anthropic')?.baseUrl).toBe('https://claude.override/anthropic')
  })

  it('does not let an openai override change the anthropic base', () => {
    const eps = planTestEndpoints(plan, {
      openai: { baseUrl: 'https://poison.example/v1' },
    })
    expect(eps.find((e) => e.id === 'anthropic')?.baseUrl).toBe(anthropic.baseUrl)
  })
})

describe('singleTestEndpoint', () => {
  it('merges only the given override onto that endpoint', () => {
    const ep = singleTestEndpoint(openai, { baseUrl: 'https://solo.example/v1' })
    expect(ep).toEqual({
      id: 'openai',
      baseUrl: 'https://solo.example/v1',
      protocols: ['openai-chat'],
    })
  })
})

describe('formatEndpointTestFailures', () => {
  it('lists only failed endpoints with id prefix', () => {
    const results: EndpointTestResult[] = [
      { endpointId: 'anthropic', success: false, status: 404, error: 'not found' },
      { endpointId: 'openai', success: true, status: 200 },
    ]
    expect(formatEndpointTestFailures(results)).toBe('anthropic: not found')
  })

  it('falls back to HTTP status when error body is empty', () => {
    const results: EndpointTestResult[] = [
      { endpointId: 'openai', success: false, status: 401 },
    ]
    expect(formatEndpointTestFailures(results)).toBe('openai: HTTP 401')
  })
})
