import { afterEach, describe, expect, it } from 'vitest'
import { ensureProxy, proxyInstanceCount, shutdownAll, buildProxyConfig } from './manager'
import { proxyUpstreamFromResolved, PROXY_HARNESS_API_KEY } from './from-resolved'
import type { ProxyUpstream } from './types'
import type { ResolvedService } from '@superone/shared/platform-registry'

const sampleUpstream = (): ProxyUpstream => ({
  name: 'test-relay',
  api_base_url: 'https://example.com/v1/chat/completions',
  api_key: 'sk-upstream-secret',
  models: ['gpt-test'],
  transformerUse: ['openai', 'reasoning'],
})

describe('proxyUpstreamFromResolved', () => {
  it('builds upstream for openai-chat credentials', () => {
    const resolved: ResolvedService = {
      platformId: 'custom:relay',
      brand: 'relay',
      planId: 'api',
      endpointId: 'openai',
      credentialId: 'cred-1',
      task: 'chat',
      protocol: 'openai-chat',
      baseUrl: 'https://relay.example/v1',
      apiKey: 'sk-real-key',
      auth: 'api-key',
      models: [{ id: 'm1', name: 'M1' }],
      modelMapping: { default: { id: 'm1', name: 'M1' } },
    }
    const upstream = proxyUpstreamFromResolved(resolved)
    expect(upstream).not.toBeNull()
    expect(upstream!.api_base_url).toBe('https://relay.example/v1/chat/completions')
    expect(upstream!.api_key).toBe('sk-real-key')
    expect(upstream!.models).toContain('m1')
  })

  it('returns null for native anthropic-messages', () => {
    const resolved: ResolvedService = {
      platformId: 'anthropic',
      brand: 'anthropic',
      planId: 'api',
      endpointId: 'anthropic',
      credentialId: 'cred-1',
      task: 'chat',
      protocol: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant',
      auth: 'api-key',
    }
    expect(proxyUpstreamFromResolved(resolved)).toBeNull()
  })
})

describe('ensureProxy', () => {
  afterEach(async () => {
    await shutdownAll()
  })

  it('returns a loopback base URL for an openai-chat upstream', async () => {
    const { url, port } = await ensureProxy(sampleUpstream())
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(port).toBeGreaterThan(0)
    expect(url).toBe(`http://127.0.0.1:${port}`)

    // /health stays unauthenticated for liveness probes
    const health = await fetch(`${url}/health`)
    expect(health.ok).toBe(true)
    expect(await health.json()).toEqual({ ok: true })
  })

  it('reuses the same instance for identical upstream config', async () => {
    const a = await ensureProxy(sampleUpstream())
    const b = await ensureProxy(sampleUpstream())
    expect(a.port).toBe(b.port)
    expect(proxyInstanceCount()).toBe(1)
  })

  it('serves /v1/models when authorized with harness placeholder key', async () => {
    const { url } = await ensureProxy(sampleUpstream())
    const res = await fetch(`${url}/v1/models`, {
      headers: { Authorization: `Bearer ${PROXY_HARNESS_API_KEY}` },
    })
    expect(res.ok).toBe(true)
    const body = (await res.json()) as { data: Array<{ id: string }> }
    expect(body.data.map((m) => m.id)).toEqual(['gpt-test'])
  })

  it('rejects /v1/models without inbound auth', async () => {
    const { url } = await ensureProxy(sampleUpstream())
    const res = await fetch(`${url}/v1/models`)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error?: { type?: string } }
    expect(body.error?.type).toBe('authentication_error')
  })

  it('accepts x-api-key for Anthropic-style harness clients', async () => {
    const { url } = await ensureProxy(sampleUpstream())
    const res = await fetch(`${url}/v1/models`, {
      headers: { 'x-api-key': PROXY_HARNESS_API_KEY },
    })
    expect(res.ok).toBe(true)
  })

  it('rejects wrong inbound key', async () => {
    const { url } = await ensureProxy(sampleUpstream())
    const res = await fetch(`${url}/v1/models`, {
      headers: { Authorization: 'Bearer sk-not-the-proxy-key' },
    })
    expect(res.status).toBe(401)
  })
})

describe('buildProxyConfig', () => {
  it('maps transformers without leaking reasoningConfig into providers', () => {
    const config = buildProxyConfig(4321, {
      ...sampleUpstream(),
      reasoningConfig: {
        supportsThinking: false,
        supportsEffort: true,
        thinkingParam: 'none',
        effortParam: 'reasoning.effort',
        effortValueMode: 'openrouter',
        supportedEfforts: ['high'],
        defaultEffort: 'high',
      },
    })
    expect(config).toMatchObject({
      PORT: 4321,
      HOST: '127.0.0.1',
      superoneReasoningConfig: { effortParam: 'reasoning.effort' },
    })
    expect((config.providers as Array<Record<string, unknown>>)[0].reasoningConfig).toBeUndefined()
  })
})

describe('PROXY_HARNESS_API_KEY', () => {
  it('is a non-empty placeholder for harness processes', () => {
    expect(PROXY_HARNESS_API_KEY.startsWith('sk-')).toBe(true)
  })
})
