import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServiceEndpoint } from '@superone/shared/platform-registry'
import {
  authHeaders,
  endpointFamily,
  modelsUrl,
  testEndpointModelsUrl,
  testServiceEndpoint,
  testServiceEndpoints,
} from './endpoint-test'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('endpoint-test isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('derives family from each endpoint, not a sibling', () => {
    const anthropic: ServiceEndpoint = {
      id: 'anthropic',
      baseUrl: 'https://relay.com',
      protocols: ['anthropic-messages'],
    }
    const openai: ServiceEndpoint = {
      id: 'openai',
      baseUrl: 'https://relay.com/v1',
      protocols: ['openai-chat'],
    }
    expect(endpointFamily(anthropic)).toBe('anthropic')
    expect(endpointFamily(openai)).toBe('openai')
    expect(testEndpointModelsUrl(anthropic)).toBe('https://relay.com/v1/models')
    expect(testEndpointModelsUrl(openai)).toBe('https://relay.com/v1/models')
  })

  it('keeps moonshot-style dual bases on separate paths', () => {
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
    expect(testEndpointModelsUrl(anthropic)).toBe('https://api.moonshot.cn/anthropic/v1/models')
    expect(testEndpointModelsUrl(openai)).toBe('https://api.moonshot.cn/v1/models')
  })

  it('auth headers follow the family of the endpoint under test', () => {
    expect(authHeaders('anthropic', 'sk-a')).toEqual({
      'x-api-key': 'sk-a',
      'anthropic-version': '2023-06-01',
    })
    expect(authHeaders('openai', 'sk-a')).toEqual({ Authorization: 'Bearer sk-a' })
  })

  it('modelsUrl does not strip non-trailing path segments', () => {
    expect(modelsUrl('openai', 'https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1/models')
    expect(modelsUrl('openai', 'https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/models')
  })

  it('tests every endpoint with its own url and auth (no first-only shortcut)', async () => {
    const calls: Array<{ url: string; auth?: string; xApiKey?: string }> = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({ url, auth: headers.Authorization, xApiKey: headers['x-api-key'] })
      if (url.includes('/anthropic/')) return jsonResponse({ data: [] }, 404)
      return jsonResponse({ data: [] }, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const endpoints: ServiceEndpoint[] = [
      { id: 'anthropic', baseUrl: 'https://api.moonshot.cn/anthropic', protocols: ['anthropic-messages'] },
      { id: 'openai', baseUrl: 'https://api.moonshot.cn/v1', protocols: ['openai-chat'] },
    ]
    const results = await testServiceEndpoints(endpoints, 'sk-key')

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ endpointId: 'anthropic', success: false, status: 404 })
    expect(results[1]).toMatchObject({ endpointId: 'openai', success: true, status: 200 })

    expect(calls).toHaveLength(2)
    expect(calls).toContainEqual({
      url: 'https://api.moonshot.cn/anthropic/v1/models',
      auth: undefined,
      xApiKey: 'sk-key',
    })
    expect(calls).toContainEqual({
      url: 'https://api.moonshot.cn/v1/models',
      auth: 'Bearer sk-key',
      xApiKey: undefined,
    })
  })

  it('returns empty results for an empty endpoint list', async () => {
    expect(await testServiceEndpoints([], 'sk')).toEqual([])
  })

  it('testServiceEndpoint reports network errors without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }))
    const result = await testServiceEndpoint(
      { id: 'openai', baseUrl: 'https://x/v1', protocols: ['openai-chat'] },
      'sk',
    )
    expect(result).toEqual({ endpointId: 'openai', success: false, error: 'ECONNREFUSED' })
  })
})
