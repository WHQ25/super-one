import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServiceEndpoint } from '@superone/shared/platform-registry'
import { discoverModels } from './model-discovery'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function htmlResponse(status = 404): Response {
  return new Response('<html><body>not found</body></html>', { status, headers: { 'content-type': 'text/html' } })
}

const endpoint: ServiceEndpoint = { id: 'openai', baseUrl: 'https://relay.com/v1', protocols: ['openai-chat'] }

describe('discoverModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('merges pricing with models-list and keeps multi-family tags', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/pricing')) {
        return jsonResponse({
          data: [
            { model_name: 'gpt-5', supported_endpoint_types: ['image-generation'] },
            { model_name: 'claude-opus', supported_endpoint_types: ['anthropic'] },
          ],
        })
      }
      if (url.includes('/v1/models')) {
        return jsonResponse({
          data: [
            { id: 'gpt-5', supported_endpoint_types: ['openai'] },
            { id: 'gpt-5-mini' },
            { id: 'gemini-pro', supported_endpoint_types: ['gemini'] },
          ],
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await discoverModels(endpoint, 'sk-key')

    expect(result.sources).toEqual({ pricing: 'ok', modelsList: 'ok' })
    expect(result.truncated).toBe(false)
    expect(result.models).toEqual([
      { id: 'gpt-5', name: undefined, tasks: ['chat', 'image'], byFamily: { openai: ['chat', 'image'] } },
      { id: 'gpt-5-mini', name: undefined, tasks: ['chat'], byFamily: { openai: ['chat'] } },
      { id: 'gemini-pro', name: undefined, tasks: ['chat'], byFamily: { google: ['chat'] } },
      { id: 'claude-opus', name: undefined, tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
    ])
  })

  it('requests pricing from the site root without an auth header (public endpoint)', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/pricing')) {
        expect(url).toBe('https://relay.com/api/pricing')
        expect(init?.headers).toBeUndefined()
        return jsonResponse({ data: [] })
      }
      return jsonResponse({ data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await discoverModels(endpoint, 'sk-key')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('requests the models list with a bearer auth header', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/models')) {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-key')
        return jsonResponse({ data: [] })
      }
      return jsonResponse({ data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await discoverModels(endpoint, 'sk-key')
  })

  it('falls back to models-list when pricing returns a non-NewAPI shape (404 HTML)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/pricing')) return htmlResponse(404)
      if (url.includes('/v1/models')) return jsonResponse({ data: [{ id: 'gpt-5' }] })
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await discoverModels(endpoint, 'sk-key')
    expect(result.sources).toEqual({ pricing: 'unavailable', modelsList: 'ok' })
    expect(result.models).toEqual([{ id: 'gpt-5', name: undefined, tasks: ['chat'], byFamily: { openai: ['chat'] } }])
  })

  it('returns an empty result (never throws) when both sources fail', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await discoverModels(endpoint, 'sk-key')
    expect(result.sources).toEqual({ pricing: 'unavailable', modelsList: 'unavailable' })
    expect(result.models).toEqual([])
  })

  it('treats a fetch timeout as unavailable rather than throwing', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = discoverModels(endpoint, 'sk-key')
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.sources).toEqual({ pricing: 'unavailable', modelsList: 'unavailable' })
    expect(result.models).toEqual([])
    vi.useRealTimers()
  })

  it('keeps anthropic-only models tagged for the anthropic family (no longer dropped)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/pricing')) {
        return jsonResponse({ data: [{ model_name: 'claude-opus', supported_endpoint_types: ['anthropic'] }] })
      }
      return jsonResponse({ data: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await discoverModels(endpoint, 'sk-key')
    expect(result.models).toEqual([
      { id: 'claude-opus', name: undefined, tasks: ['chat'], byFamily: { anthropic: ['chat'] } },
    ])
  })
})
