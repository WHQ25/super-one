import { describe, expect, it } from 'vitest'
import type { ConsumerBinding, Credential, Platform } from '@superone/shared/platform-registry'
import { resolveEffectiveProviderId } from './provider-resolve'

const platform: Platform = {
  id: 'custom-openai',
  brand: 'custom',
  name: 'Custom OpenAI',
  plans: [{
    id: 'api',
    name: 'API',
    auth: 'api-key',
    baseUrl: 'https://custom.example.com',
    endpoints: [{ id: 'responses', protocols: ['openai-responses'] }],
  }],
}

const credential: Credential = {
  id: 'custom-key',
  platformId: platform.id,
  planId: 'api',
  name: 'Custom key',
  secret: '',
  notes: '',
  sortOrder: 0,
}

describe('resolveEffectiveProviderId', () => {
  it('returns null for the official harness provider', () => {
    expect(resolveEffectiveProviderId([], [], [], 'chat:codex', null)).toBeNull()
  })

  it('keeps an explicit provider selected while metadata is loading', () => {
    expect(resolveEffectiveProviderId([], [], [], 'chat:codex', credential.id)).toBe(credential.id)
  })

  it('resolves the provider selected by the global Codex binding', () => {
    const bindings: ConsumerBinding[] = [{
      consumer: 'chat:codex',
      credentialId: credential.id,
    }]
    expect(resolveEffectiveProviderId(
      [platform],
      [credential],
      bindings,
      'chat:codex',
      null,
    )).toBe(credential.id)
  })
})
