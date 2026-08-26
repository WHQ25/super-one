import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServiceEndpoint } from '@superone/shared/platform-registry'
import {
  authHeaders,
  endpointFamily,
  messagesUrl,
  modelsUrl,
  selectKeyAuthEndpoint,
  testEndpointModelsUrl,
  testServiceEndpoint,
  testServiceEndpoints,
} from './endpoint-test'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status })
}

describe('endpoint-test isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('derives family from each endpoint, not a sibling', () => {
    const anthropic: ServiceEndpoint = {
      id: 'anthropic',
      protocols: ['anthropic-messages'],
    }
    const openai: ServiceEndpoint = {
      id: 'openai',
      protocols: ['openai-chat'],
    }
    expect(endpointFamily(anthropic)).toBe('anthropic')
    expect(endpointFamily(openai)).toBe('openai')
    expect(testEndpointModelsUrl('https://relay.com', anthropic)).toBe('https://relay.com/v1/models')
    expect(testEndpointModelsUrl('https://relay.com', openai)).toBe('https://relay.com/v1/models')
  })

  it('keeps moonshot-style dual paths apart, off one site root', () => {
    // The shape every real relay has: one host, each format on its own path. The probe has to
    // follow the endpoint's route, not the family default, or a routed endpoint tests the wrong URL.
    const anthropic: ServiceEndpoint = {
      id: 'anthropic',
      protocols: ['anthropic-messages'],
      routes: { 'anthropic-messages': '/anthropic/v1/messages' },
    }
    const openai: ServiceEndpoint = { id: 'openai', protocols: ['openai-chat'] }
    expect(testEndpointModelsUrl('https://api.moonshot.cn', anthropic)).toBe('https://api.moonshot.cn/anthropic/v1/models')
    expect(testEndpointModelsUrl('https://api.moonshot.cn', openai)).toBe('https://api.moonshot.cn/v1/models')
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

  it('modelsUrl keeps non-v1 version segments (Zhipu v4, Ark v3)', () => {
    expect(modelsUrl('openai', 'https://open.bigmodel.cn/api/coding/paas/v4')).toBe(
      'https://open.bigmodel.cn/api/coding/paas/v4/models',
    )
    expect(modelsUrl('openai', 'https://ark.cn-beijing.volces.com/api/coding/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/coding/v3/models',
    )
  })

  it('messagesUrl builds anthropic messages path', () => {
    expect(messagesUrl('https://api.deepseek.com/anthropic')).toBe(
      'https://api.deepseek.com/anthropic/v1/messages',
    )
    expect(messagesUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1/messages')
  })

  it('returns empty results for an empty endpoint list', async () => {
    expect(await testServiceEndpoints('https://relay.com', [], 'sk')).toEqual([])
  })

  it('testServiceEndpoint reports network errors without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }))
    const result = await testServiceEndpoint('https://relay.com',
      { id: 'openai', baseUrl: 'https://x/v1', protocols: ['openai-chat'] },
      'sk',
    )
    expect(result).toEqual({ endpointId: 'openai', success: false, error: 'ECONNREFUSED' })
  })

  it('maps 401/403 on models list to Invalid API key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('Unauthorized', 401)))
    const result = await testServiceEndpoint('https://relay.com',
      { id: 'openai', baseUrl: 'https://api.deepseek.com', protocols: ['openai-chat'] },
      'bad-key',
    )
    expect(result).toEqual({ endpointId: 'openai', success: false, status: 401, error: 'Invalid API key' })
  })
})

describe('selectKeyAuthEndpoint', () => {
  it('prefers openai-chat over anthropic on dual-protocol plans', () => {
    const endpoints: ServiceEndpoint[] = [
      { id: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', protocols: ['anthropic-messages'] },
      { id: 'openai', baseUrl: 'https://api.deepseek.com', protocols: ['openai-chat'] },
    ]
    expect(selectKeyAuthEndpoint(endpoints)?.id).toBe('openai')
  })

  it('prefers openai-responses over media-only openai endpoints', () => {
    const endpoints: ServiceEndpoint[] = [
      { id: 'sora', baseUrl: '', protocols: ['openai-video'] },
      { id: 'openai', baseUrl: '', protocols: ['openai-responses', 'openai-images', 'openai-audio'] },
    ]
    expect(selectKeyAuthEndpoint(endpoints)?.id).toBe('openai')
  })

  it('falls back to anthropic when no openai endpoint exists', () => {
    const endpoints: ServiceEndpoint[] = [
      { id: 'anthropic', baseUrl: 'https://api.anthropic.com', protocols: ['anthropic-messages'] },
    ]
    expect(selectKeyAuthEndpoint(endpoints)?.id).toBe('anthropic')
  })

  it('prefers google-generative over google-video', () => {
    const endpoints: ServiceEndpoint[] = [
      { id: 'veo', baseUrl: '', protocols: ['google-video'] },
      { id: 'generative', baseUrl: '', protocols: ['google-generative'] },
    ]
    expect(selectKeyAuthEndpoint(endpoints)?.id).toBe('generative')
  })

  it('returns null for empty list', () => {
    expect(selectKeyAuthEndpoint([])).toBeNull()
  })
})

describe('connection vs endpoint test semantics', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('connection test (multi endpoint) probes only preferred openai auth surface', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        if (url.includes('/anthropic/')) return textResponse('Not Found', 404)
        return jsonResponse({ data: [] }, 200)
      }),
    )

    const endpoints: ServiceEndpoint[] = [
      { id: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', protocols: ['anthropic-messages'] },
      { id: 'openai', baseUrl: 'https://api.deepseek.com', protocols: ['openai-chat'] },
    ]
    const results = await testServiceEndpoints('https://relay.com', endpoints, 'sk-key')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ endpointId: 'openai', success: true, status: 200 })
    expect(calls).toEqual(['https://api.deepseek.com/v1/models'])
  })

  it('endpoint test (single anthropic) keeps its own url and auth', async () => {
    const calls: Array<{ url: string; method?: string; xApiKey?: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        calls.push({ url, method: init?.method, xApiKey: headers['x-api-key'] })
        return textResponse('Not Found', 404)
      }),
    )

    const anthropic: ServiceEndpoint = {
      id: 'anthropic',
      protocols: ['anthropic-messages'],
      routes: { 'anthropic-messages': '/anthropic/v1/messages' },
    }
    const results = await testServiceEndpoints('https://api.deepseek.com', [anthropic], 'sk-key')

    expect(results).toHaveLength(1)
    // models 404 → messages fallback also 404 → failure (endpoint config issue)
    expect(results[0]).toMatchObject({ endpointId: 'anthropic', success: false, status: 404 })
    expect(calls).toEqual([
      { url: 'https://api.deepseek.com/anthropic/v1/models', method: undefined, xApiKey: 'sk-key' },
      {
        url: 'https://api.deepseek.com/anthropic/v1/messages',
        method: 'POST',
        xApiKey: 'sk-key',
      },
    ])
  })

  it('anthropic endpoint falls back to messages on models 404 and accepts 2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/v1/models')) return textResponse('', 404)
        return jsonResponse({ id: 'msg_1', type: 'message', content: [] }, 200)
      }),
    )

    const result = await testServiceEndpoint('https://relay.com',
      { id: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', protocols: ['anthropic-messages'] },
      'sk-key',
    )
    expect(result).toMatchObject({ endpointId: 'anthropic', success: true, status: 200 })
  })

  it('anthropic messages fallback treats 400 as auth accepted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/v1/models')) return textResponse('Not Found', 404)
        return jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message: 'model' } }, 400)
      }),
    )

    const result = await testServiceEndpoint('https://relay.com',
      { id: 'anthropic', baseUrl: 'https://open.bigmodel.cn/api/anthropic', protocols: ['anthropic-messages'] },
      'sk-key',
    )
    expect(result).toMatchObject({ endpointId: 'anthropic', success: true, status: 400 })
  })

  it('anthropic messages fallback maps 401 to Invalid API key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/v1/models')) return textResponse('Not Found', 404)
        return textResponse('Unauthorized', 401)
      }),
    )

    const result = await testServiceEndpoint('https://relay.com',
      { id: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', protocols: ['anthropic-messages'] },
      'bad',
    )
    expect(result).toEqual({
      endpointId: 'anthropic',
      success: false,
      status: 401,
      error: 'Invalid API key',
    })
  })

  it('does not messages-fallback for openai on 404', async () => {
    const fetchMock = vi.fn(async () => textResponse('Not Found', 404))
    vi.stubGlobal('fetch', fetchMock)

    const result = await testServiceEndpoint('https://relay.com',
      { id: 'openai', baseUrl: 'https://x.example/v1', protocols: ['openai-chat'] },
      'sk',
    )
    expect(result).toMatchObject({ endpointId: 'openai', success: false, status: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
