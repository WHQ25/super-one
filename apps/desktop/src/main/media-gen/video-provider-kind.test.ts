import { describe, expect, it } from 'vitest'
import type { ResolvedService } from '@superone/shared/platform-registry'
import { videoKindFor } from './providers'
import { resolveVideoDriver } from './video/registry'

/**
 * `videoKindFor` reads the protocol and nothing else — which is what lets a relay reuse the Ark
 * driver by publishing Ark's path. If it ever started checking the platform id, a relay-backed
 * ark-video endpoint would fall through to the wrong driver and send an Ark body to a New API route.
 */
function resolved(over: Partial<ResolvedService>): ResolvedService {
  return {
    platformId: 'custom:relay', brand: 'custom', planId: 'api',
    endpointId: 'ark-video', credentialId: 'relay-key', task: 'video',
    protocol: 'ark-video', auth: 'api-key',
    baseUrl: 'https://super-api.dev/api/v3', apiKey: 'sk-relay', models: [],
    ...over,
  } as ResolvedService
}

describe('videoKindFor', () => {
  it('sends a relay-hosted ark-video endpoint to the ark driver, same as direct Volcengine', () => {
    expect(videoKindFor(resolved({}))).toBe('ark')
    expect(videoKindFor(resolved({ platformId: 'volcengine', brand: 'volcengine' }))).toBe('ark')
  })

  it('separates official Sora from a relay serving the same wire', () => {
    expect(videoKindFor(resolved({ protocol: 'openai-video', platformId: 'openai' }))).toBe('openai')
    expect(videoKindFor(resolved({ protocol: 'openai-video' }))).toBe('openai-compatible')
  })

  it('maps the remaining video wires', () => {
    expect(videoKindFor(resolved({ protocol: 'newapi-video' }))).toBe('newapi')
    expect(videoKindFor(resolved({ protocol: 'google-video' }))).toBe('google')
  })

  it('reaches a usable driver for a relay ark endpoint', () => {
    const service = resolved({})
    const driver = resolveVideoDriver(
      { id: service.credentialId, kind: videoKindFor(service), apiKey: service.apiKey!, baseURL: service.baseUrl, models: [] },
      'doubao-seedance-2-0-fast-260128',
    )
    expect(driver.modelId).toBe('doubao-seedance-2-0-fast-260128')
    expect(typeof driver.submit).toBe('function')
  })
})
