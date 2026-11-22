import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Credential, Platform } from '@superone/shared/platform-registry'
import type { ModelCatalog } from '@superone/shared/model-catalog-types'

const { mockListCredentials, mockGetCredentialDecrypted, mockGetPlatforms, mockResolveService } = vi.hoisted(() => ({
  mockListCredentials: vi.fn<() => Credential[]>(),
  mockGetCredentialDecrypted: vi.fn<(id: string) => Credential | undefined>(),
  mockGetPlatforms: vi.fn<() => Platform[]>(),
  mockResolveService: vi.fn(),
}))

vi.mock('../providers/credential-store', () => ({
  listCredentials: mockListCredentials,
  getCredentialDecrypted: mockGetCredentialDecrypted,
}))

vi.mock('../providers/registry', () => ({
  getPlatforms: mockGetPlatforms,
}))

vi.mock('../providers/resolver', () => ({
  resolveService: mockResolveService,
}))

import {
  buildDshPiAiProvidersSync,
  DEEPSEEK_OFFICIAL_DEFAULT_MODEL,
  DEEPSEEK_OFFICIAL_PROVIDER,
  dshProviderRouteForCredential,
  resolveDshRoute,
} from './deepseek-providers'
import { dshCredentialRefForId, resolveDshCredential } from './deepseek-credentials'

const PLATFORMS: Platform[] = [
  {
    id: 'openai',
    brand: 'openai',
    name: 'OpenAI',
    catalogProviderId: 'openai',
    plans: [
      {
        id: 'api',
        name: 'API',
        auth: 'api-key',
        baseUrl: '',
        endpoints: [{ id: 'openai', protocols: ['openai-responses', 'openai-chat'] }],
      },
    ],
  },
  {
    id: 'custom-relay',
    brand: 'custom',
    name: 'My Relay',
    plans: [
      {
        id: 'default',
        name: 'Default',
        auth: 'api-key',
        baseUrl: 'https://relay.example.com',
        endpoints: [
          {
            id: 'anthropic',
            protocols: ['anthropic-messages'],
            models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', tasks: ['chat'] }],
          },
        ],
      },
    ],
  },
]

const CATALOG: ModelCatalog = {
  generatedAt: '2026-11-22T00:00:00.000Z',
  source: 'snapshot',
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      npm: '@ai-sdk/openai',
      env: ['OPENAI_API_KEY'],
      doc: '',
      models: [
        {
          id: 'gpt-5',
          name: 'GPT-5',
          providerId: 'openai',
          contextWindow: 400_000,
          maxOutput: 128_000,
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          reasoning: true,
          toolCall: true,
          attachment: true,
        },
      ],
    },
  ],
}

describe('deepseek-providers', () => {
  beforeEach(() => {
    mockListCredentials.mockReset()
    mockGetCredentialDecrypted.mockReset()
    mockGetPlatforms.mockReset().mockReturnValue(PLATFORMS)
    mockResolveService.mockReset()
  })

  it('falls back to deepseek-official when chat:dsh has no resolved service and no credentials', () => {
    mockResolveService.mockReturnValue(null)
    mockListCredentials.mockReturnValue([])
    expect(resolveDshRoute(null)).toEqual({
      provider: DEEPSEEK_OFFICIAL_PROVIDER,
      defaultModel: DEEPSEEK_OFFICIAL_DEFAULT_MODEL,
    })
  })

  it('routes to superone-<credentialId> when chat:dsh resolves a SuperOne credential', () => {
    mockResolveService.mockReturnValue({
      platformId: 'custom-relay',
      brand: 'custom',
      planId: 'default',
      endpointId: 'anthropic',
      credentialId: 'cred-1',
      task: 'chat',
      protocol: 'anthropic-messages',
      baseUrl: 'https://relay.example.com',
      apiKey: 'sk-test',
      auth: 'api-key',
      models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', tasks: ['chat'] }],
    })
    expect(resolveDshRoute('cred-1')).toEqual({
      provider: dshProviderRouteForCredential('cred-1'),
      defaultModel: 'claude-sonnet-4-5',
      credentialId: 'cred-1',
    })
  })

  it('builds pi-ai provider profiles using catalog models and custom endpoint models', () => {
    const openaiCred: Credential = { id: 'c-openai', platformId: 'openai', planId: 'api', name: 'Work', secret: 'sk-oai' }
    const relayCred: Credential = { id: 'c-relay', platformId: 'custom-relay', planId: 'default', name: 'Relay', secret: 'sk-rel' }
    mockListCredentials.mockReturnValue([openaiCred, relayCred])
    mockResolveService.mockImplementation((_consumer, opts?: { credentialId?: string }) => {
      if (opts?.credentialId === 'c-openai') {
        return {
          platformId: 'openai',
          brand: 'openai',
          planId: 'api',
          endpointId: 'openai',
          credentialId: 'c-openai',
          task: 'chat',
          protocol: 'openai-chat',
          baseUrl: '',
          apiKey: 'sk-oai',
          auth: 'api-key',
          models: [],
        }
      }
      if (opts?.credentialId === 'c-relay') {
        return {
          platformId: 'custom-relay',
          brand: 'custom',
          planId: 'default',
          endpointId: 'anthropic',
          credentialId: 'c-relay',
          task: 'chat',
          protocol: 'anthropic-messages',
          baseUrl: 'https://relay.example.com',
          apiKey: 'sk-rel',
          auth: 'api-key',
          models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', tasks: ['chat'] }],
        }
      }
      return null
    })

    const profiles = buildDshPiAiProvidersSync(CATALOG)
    expect(profiles['superone-c-openai']).toEqual({
      displayName: 'OpenAI (Work)',
      apiKeyEnv: dshCredentialRefForId('c-openai'),
      api: 'openai-completions',
      baseURL: 'https://api.openai.com/v1',
      models: [
        {
          id: 'gpt-5',
          name: 'GPT-5',
          contextWindow: 400_000,
          maxTokens: 128_000,
          input: ['text', 'image'],
          reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', max: 'max' },
        },
      ],
    })
    expect(profiles['superone-c-relay']).toEqual({
      displayName: 'My Relay (Relay)',
      apiKeyEnv: dshCredentialRefForId('c-relay'),
      api: 'anthropic-messages',
      baseURL: 'https://relay.example.com',
      models: [
        {
          id: 'claude-sonnet-4-5',
          name: 'Claude Sonnet 4.5',
          input: ['text'],
        },
      ],
    })
  })

  it('resolves dshCredentialRefForId without exposing secrets in config', () => {
    mockGetCredentialDecrypted.mockReturnValue({
      id: 'c-openai',
      platformId: 'openai',
      planId: 'api',
      name: 'Work',
      secret: 'sk-secret-123',
    })
    const ref = dshCredentialRefForId('c-openai')
    expect(ref).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
    expect(resolveDshCredential(ref)).toBe('sk-secret-123')
    expect(resolveDshCredential('UNKNOWN_REF')).toBeUndefined()
  })
})
