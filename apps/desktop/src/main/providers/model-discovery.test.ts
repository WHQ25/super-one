import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverModels } from './model-discovery'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function htmlResponse(status = 404): Response {
  return new Response('<html><body>not found</body></html>', { status, headers: { 'content-type': 'text/html' } })
}

const baseUrl = 'https://relay.com/v1'

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function routes(table: Record<string, (url: string, init?: RequestInit) => Response | Promise<Response>>) {
  return (url: string, init?: RequestInit) => {
    for (const [needle, fn] of Object.entries(table)) {
      if (url.includes(needle)) return fn(url, init)
    }
    return htmlResponse(404)
  }
}

describe('discoverModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('merges pricing with models-list and keeps multi-family tags', async () => {
    stubFetch(
      routes({
        '/api/pricing': () =>
          jsonResponse({
            data: [
              { model_name: 'gpt-5', supported_endpoint_types: ['image-generation'] },
              { model_name: 'claude-opus', supported_endpoint_types: ['anthropic'] },
            ],
          }),
        '/v1/models': () =>
          jsonResponse({
            data: [
              { id: 'gpt-5', supported_endpoint_types: ['openai'] },
              { id: 'gpt-5-mini' },
              { id: 'gemini-pro', supported_endpoint_types: ['gemini'] },
            ],
          }),
      }),
    )

    const result = await discoverModels(baseUrl, 'sk-key')

    expect(result.sources).toEqual({ pricing: 'ok', modelsList: 'ok' })
    expect(result.truncated).toBe(false)
    expect(result.models).toEqual([
      { id: 'gpt-5', name: undefined, tasks: ['chat'], byFamily: { openai: ['chat'] } },
      { id: 'gpt-5-mini', name: undefined, tasks: ['chat'], byFamily: { openai: ['chat'] } },
      { id: 'gemini-pro', name: undefined, tasks: ['chat'], byFamily: { google: ['chat'] } },
      { id: 'claude-opus', name: undefined, tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
    ])
    expect(result.relay?.kind).toBe('new-api')
    expect(result.extras).toEqual(['openai-responses'])
  })

  it('requests pricing from the site root without an auth header (public endpoint)', async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url.includes('/api/pricing')) {
        expect(url).toBe('https://relay.com/api/pricing')
        expect(init?.headers).toBeUndefined()
        return jsonResponse({ data: [] })
      }
      return jsonResponse({ data: [] })
    })

    await discoverModels(baseUrl, 'sk-key')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('requests the models list with a bearer auth header', async () => {
    stubFetch((url, init) => {
      if (url.includes('/v1/models')) {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-key')
        return jsonResponse({ data: [] })
      }
      return jsonResponse({ data: [] })
    })

    await discoverModels(baseUrl, 'sk-key')
  })

  it('falls back to models-list when pricing returns a non-NewAPI shape (404 HTML)', async () => {
    stubFetch(
      routes({
        '/api/pricing': () => htmlResponse(404),
        '/v1/models': () => jsonResponse({ data: [{ id: 'gpt-5' }] }),
      }),
    )

    const result = await discoverModels(baseUrl, 'sk-key')
    expect(result.sources).toEqual({ pricing: 'unavailable', modelsList: 'ok' })
    expect(result.models).toEqual([{ id: 'gpt-5', name: undefined, tasks: ['chat'], byFamily: { openai: ['chat'] } }])
  })

  it('returns an empty result (never throws) when both sources fail', async () => {
    stubFetch(async () => {
      throw new Error('network down')
    })

    const result = await discoverModels(baseUrl, 'sk-key')
    expect(result.sources).toEqual({ pricing: 'unavailable', modelsList: 'unavailable' })
    expect(result.models).toEqual([])
    expect(result.relay?.kind).toBe('openai-compatible')
  })

  it('treats a fetch timeout as unavailable rather than throwing', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = discoverModels(baseUrl, 'sk-key')
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.sources).toEqual({ pricing: 'unavailable', modelsList: 'unavailable' })
    expect(result.models).toEqual([])
    vi.useRealTimers()
  })

  it('keeps anthropic-only models tagged for the anthropic family (no longer dropped)', async () => {
    stubFetch(
      routes({
        '/api/pricing': () =>
          jsonResponse({ data: [{ model_name: 'claude-opus', supported_endpoint_types: ['anthropic'] }] }),
        '/v1/models': () => jsonResponse({ data: [] }),
      }),
    )

    const result = await discoverModels(baseUrl, 'sk-key')
    expect(result.models).toEqual([
      { id: 'claude-opus', name: undefined, tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
    ])
  })

  it('identifies New API from /api/status and enables Responses', async () => {
    stubFetch(
      routes({
        '/api/status': () =>
          jsonResponse({
            success: true,
            data: { version: 'v0.9', system_name: 'HiFlowt', enable_task: true, quota_display_type: 'USD' },
          }),
        '/v1/models': () => jsonResponse({ data: [{ id: 'gpt-5' }] }),
      }),
    )

    const result = await discoverModels(baseUrl, 'sk-key')
    expect(result.relay).toEqual({ kind: 'new-api', name: 'HiFlowt' })
    expect(result.extras).toEqual(['openai-responses'])
  })

  it('identifies Sub2API from /api/v1/settings/public and classifies mixed model ids', async () => {
    stubFetch(
      routes({
        '/api/v1/settings/public': () =>
          jsonResponse({ site_name: 'Team Sub', api_base_url: 'https://relay.com/v1' }),
        '/v1/models': () =>
          jsonResponse({
            data: [{ id: 'claude-sonnet-4-5' }, { id: 'gemini-2.5-pro' }, { id: 'gpt-5' }],
          }),
      }),
    )

    const result = await discoverModels(baseUrl, 'sk-key')
    expect(result.relay).toEqual({ kind: 'sub2api', name: 'Team Sub' })
    expect(result.extras).toEqual(['openai-responses'])
    expect(result.models).toEqual([
      { id: 'claude-sonnet-4-5', name: undefined, tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
      { id: 'gemini-2.5-pro', name: undefined, tasks: ['chat'], byFamily: { google: ['chat'] } },
      { id: 'gpt-5', name: undefined, tasks: ['chat'], byFamily: { openai: ['chat'] } },
    ])
  })

  it('places renamed Sub2API models on the wire its key is bound to, not on openai', async () => {
    // A claude-platform Sub2API key with a custom model list: the ids say nothing, and Sub2API
    // sends no supported_endpoint_types or owned_by at all. Without a key-bound family these
    // would all default to openai/chat and be unusable.
    stubFetch(
      routes({
        '/api/v1/settings/public': () => jsonResponse({ site_name: 'Team Sub', custom_endpoints: [] }),
        '/v1beta/models': () => jsonResponse({ error: { message: 'API key group platform is not gemini' } }, 400),
        '/v1/models': () =>
          jsonResponse({
            object: 'list',
            data: [
              { id: 'sonnet-max', type: 'model', display_name: 'Sonnet Max' },
              { id: 'opus-thinking', type: 'model', display_name: 'Opus Thinking' },
            ],
          }),
      }),
    )

    const result = await discoverModels(baseUrl, 'sk-key')
    expect(result.relay?.kind).toBe('sub2api')
    expect(result.models).toEqual([
      { id: 'sonnet-max', name: 'Sonnet Max', tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
      { id: 'opus-thinking', name: 'Opus Thinking', tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
    ])
  })

  it('routes a gemini-platform Sub2API key to google even though the list is Anthropic-shaped', async () => {
    // Sub2API renders gemini-platform lists with the same Anthropic model struct, so only
    // /v1beta/models answering at all separates this from the claude case above.
    stubFetch(
      routes({
        '/api/v1/settings/public': () => jsonResponse({ site_name: 'Team Sub', custom_endpoints: [] }),
        '/v1beta/models': () => jsonResponse({ models: [{ name: 'models/gemini-3-pro' }] }),
        '/v1/models': () =>
          jsonResponse({ object: 'list', data: [{ id: 'pro-max', type: 'model', display_name: 'Pro Max' }] }),
      }),
    )

    const result = await discoverModels(baseUrl, 'sk-key')
    expect(result.models).toEqual([
      { id: 'pro-max', name: 'Pro Max', tasks: ['chat'], byFamily: { google: ['chat'] } },
    ])
  })

  it('ignores the gemini probe on New API, where one key reaches every wire', async () => {
    // New API answers /v1beta/models with its whole catalog restated in Gemini shape. Treating
    // that as "this key is a Google key" would drag every unplaceable model onto the Google
    // endpoint, so the key-bound family is only ever derived for Sub2API.
    stubFetch(
      routes({
        '/api/status': () => jsonResponse({ data: { version: 'v0.9', system_name: 'Relay', enable_task: true } }),
        '/v1beta/models': () => jsonResponse({ models: [{ name: 'models/my-pool-alias' }] }),
        '/v1/models': () => jsonResponse({ data: [{ id: 'my-pool-alias' }] }),
      }),
    )

    const result = await discoverModels(baseUrl, 'sk-key')
    expect(result.relay?.kind).toBe('new-api')
    expect(result.models).toEqual([
      { id: 'my-pool-alias', name: undefined, tasks: ['chat'], byFamily: { openai: ['chat'] } },
    ])
  })

  it('parses One API model_ratio pricing and tags Claude/Gemini ids', async () => {
    stubFetch(
      routes({
        '/api/pricing': () =>
          jsonResponse({
            data: { model_ratio: { 'gpt-4': 15, 'claude-3-opus': 75 }, completion_ratio: {} },
          }),
        '/api/status': () => jsonResponse({ data: { version: 'v0.6', system_name: 'One API', start_time: 1 } }),
        '/v1/models': () => htmlResponse(404),
      }),
    )

    const result = await discoverModels(baseUrl, 'sk-key')
    expect(result.relay).toEqual({ kind: 'one-api', name: 'One API' })
    expect(result.sources.pricing).toBe('ok')
    expect(result.models).toEqual([
      { id: 'gpt-4', name: undefined, tasks: ['chat'], byFamily: { openai: ['chat'] } },
      { id: 'claude-3-opus', name: undefined, tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
    ])
  })

  it('normalizes a pasted /v1/chat/completions URL to the site root and /v1/models', async () => {
    const fetchMock = stubFetch(
      routes({
        '/api/pricing': () => jsonResponse({ data: [] }),
        '/v1/models': () => jsonResponse({ data: [{ id: 'gpt-5' }] }),
      }),
    )

    await discoverModels('https://relay.com/v1/chat/completions', 'sk-key')

    const urls = fetchMock.mock.calls.map((c) => c[0] as string)
    expect(urls).toContain('https://relay.com/api/pricing')
    expect(urls).toContain('https://relay.com/v1/models')
    expect(urls).toContain('https://relay.com/api/status')
    expect(urls).toContain('https://relay.com/api/v1/settings/public')
    expect(urls.some((u) => u.includes('/chat/completions'))).toBe(false)
  })

  it("applies the site's published routes to the models list, which never carries them", async () => {
    // The two sources are fetched in parallel but parsed together: `supported_endpoint` lives only
    // in the pricing payload, while `supported_endpoint_types` lives only on each model. Here the
    // site calls its wire `openai-video` (Sora's name) but publishes New API's own path under it.
    stubFetch(
      routes({
        '/api/pricing': () =>
          jsonResponse({
            data: [],
            supported_endpoint: { 'openai-video': { path: '/v1/video/generations', method: 'POST' } },
          }),
        '/v1/models': () =>
          jsonResponse({
            data: [
              { id: 'doubao-seedance-2-0-260128', supported_endpoint_types: ['openai-video'] },
              { id: 'gpt-5', supported_endpoint_types: ['openai'] },
            ],
          }),
      }),
    )

    const result = await discoverModels(baseUrl, 'sk-key')
    expect(result.models).toEqual([
      { id: 'doubao-seedance-2-0-260128', name: undefined, tasks: ['video'], byFamily: { 'newapi-video': ['video'] } },
      { id: 'gpt-5', name: undefined, tasks: ['chat'], byFamily: { openai: ['chat'] } },
    ])
  })

  it('tags Sora as openai-video and Seedance as newapi-video when types are chat-only', async () => {
    stubFetch(
      routes({
        '/api/pricing': () =>
          jsonResponse({
            data: [
              {
                model_name: 'doubao-seedance-1-5-pro',
                supported_endpoint_types: ['openai', 'anthropic', 'gemini'],
              },
              { model_name: 'sora-2', supported_endpoint_types: ['openai-video'] },
            ],
          }),
        '/v1/models': () => jsonResponse({ data: [] }),
      }),
    )

    const result = await discoverModels(baseUrl, 'sk-key')
    expect(result.models).toEqual([
      { id: 'doubao-seedance-1-5-pro', name: undefined, tasks: ['video'], byFamily: { 'newapi-video': ['video'] } },
      { id: 'sora-2', name: undefined, tasks: ['video'], byFamily: { 'openai-video': ['video'] } },
    ])
  })
})
