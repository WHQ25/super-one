import { describe, expect, it } from 'vitest'
import type { ResolvedService } from '@superone/shared/platform-registry'
import { openCodeProviderConfig } from './provider-config'

const service: ResolvedService = { platformId: 'fixture', brand: 'Fixture', planId: 'api', endpointId: 'chat', credentialId: 'credential',
  task: 'chat', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:1234/v1', auth: 'api-key', apiKey: 'fixture-only-key',
  models: [{ id: 'upstream/model', name: 'Model' }] }
describe('native provider-store configuration', () => {
  it('keeps secrets out of configuration and maps namespaced and upstream ids to one credential', () => {
    const result = openCodeProviderConfig(service, JSON.stringify({ warming: false, providers: { original: {} } }))
    const config = JSON.parse(result.env.OPENCODE_CONFIG_CONTENT)
    expect(result.env.SUPERONE_OPENCODE_PROVIDER_KEY).toBe(service.apiKey)
    expect(result.env.OPENCODE_CONFIG_CONTENT.includes(service.apiKey)).toBe(false)
    expect(config.providers.original).toEqual({})
    expect(config.warming).toBe(false)
    expect(result.mapModel('upstream/model')).toBe(result.models[0]!.id)
    expect(result.mapModel(result.models[0]!.id)).toBe(result.models[0]!.id)
    expect(result.mapModel()).toBe(result.models[0]!.id)
    expect(() => result.mapModel('another/model')).toThrow('unavailable')
  })
  it.each(['openai-responses', 'anthropic-messages'] as const)('uses the native %s runtime without a protocol proxy', protocol => {
    const provider = Object.values(JSON.parse(openCodeProviderConfig({ ...service, protocol }).env.OPENCODE_CONFIG_CONTENT).providers)[0] as { package: string }
    expect(provider.package).toBe(protocol === 'openai-responses' ? '@opencode/ai/providers/openai-compatible/responses' : '@opencode/ai/providers/anthropic-compatible')
  })
  it('fails closed for missing credentials, missing catalogs and unsupported protocols', () => {
    expect(() => openCodeProviderConfig({ ...service, apiKey: '' })).toThrow('API key')
    expect(() => openCodeProviderConfig({ ...service, models: [] })).toThrow('at least one model')
    expect(() => openCodeProviderConfig({ ...service, protocol: 'google-generative' })).toThrow('supported chat protocol')
  })
})
