import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumerBinding, Credential, Platform } from '@superone/shared/platform-registry'

vi.mock('./credential-store', () => ({
  getBinding: vi.fn(),
  getCredentialDecrypted: vi.fn(),
}))
vi.mock('./registry', () => ({
  getPlatforms: vi.fn(),
}))

import { getBinding, getCredentialDecrypted } from './credential-store'
import { getPlatforms } from './registry'
import { buildClaudeEnv, buildRemoteActiveService, resolveService } from './resolver'

const platform: Platform = {
  id: 'zhipu-cn',
  brand: 'zhipu',
  name: 'GLM (CN)',
  plans: [
    {
      id: 'coding',
      name: 'Coding Plan',
      auth: 'api-key',
      endpoints: [
        {
          id: 'anthropic',
          baseUrl: 'https://base',
          protocols: ['anthropic-messages'],
          defaults: {
            extraEnv: { API_TIMEOUT_MS: '3000000', ANTHROPIC_AUTH_TOKEN: '' },
            modelMapping: { opus: { id: 'glm-opus' } },
          },
        },
      ],
    },
  ],
}

const cred: Credential = {
  id: 'cred1',
  platformId: 'zhipu-cn',
  planId: 'coding',
  name: 'my key',
  secret: 'sk-123',
  notes: '',
  sortOrder: 0,
}

const googlePlatform: Platform = {
  id: 'custom:google-relay',
  brand: 'custom',
  name: 'Google relay',
  plans: [
    {
      id: 'api',
      name: 'API',
      auth: 'api-key',
      endpoints: [{ id: 'google', baseUrl: 'https://relay.example.com', protocols: ['google-generative'] }],
    },
  ],
}

const openAiChatPlatform: Platform = {
  id: 'custom:openai-chat',
  brand: 'custom',
  name: 'OpenAI Chat relay',
  plans: [{
    id: 'api',
    name: 'API',
    auth: 'api-key',
    endpoints: [{ id: 'openai', baseUrl: 'https://relay.example.com/v1', protocols: ['openai-chat'] }],
  }],
}

const mockedGetBinding = vi.mocked(getBinding)
const mockedGetCred = vi.mocked(getCredentialDecrypted)
const mockedGetPlatforms = vi.mocked(getPlatforms)

function bind(binding: ConsumerBinding | undefined, creds: Credential[]): void {
  mockedGetBinding.mockImplementation((c) => (binding && binding.consumer === c ? binding : undefined))
  mockedGetCred.mockImplementation((id) => creds.find((x) => x.id === id))
  mockedGetPlatforms.mockReturnValue([platform])
}

describe('resolveService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves the global binding through the registry, merging endpoint defaults', () => {
    bind({ consumer: 'chat:claude', credentialId: 'cred1' }, [cred])
    const r = resolveService('chat:claude')!
    expect(r.protocol).toBe('anthropic-messages')
    expect(r.baseUrl).toBe('https://base')
    expect(r.apiKey).toBe('sk-123')
    expect(r.brand).toBe('zhipu')
    expect(r.extraEnv?.API_TIMEOUT_MS).toBe('3000000')
    expect(r.modelMapping?.opus?.id).toBe('glm-opus')
  })

  it('applies credential overrides: replace baseUrl, key-merge extraEnv', () => {
    const withOverride: Credential = {
      ...cred,
      overrides: { anthropic: { baseUrl: 'https://override', extraEnv: { EXTRA: '1' } } },
    }
    bind({ consumer: 'chat:claude', credentialId: 'cred1' }, [withOverride])
    const r = resolveService('chat:claude')!
    expect(r.baseUrl).toBe('https://override')
    expect(r.extraEnv).toMatchObject({ API_TIMEOUT_MS: '3000000', EXTRA: '1' })
  })

  it('lets a session override credentialId win over the global binding', () => {
    const other: Credential = { ...cred, id: 'cred2', name: 'other' }
    bind({ consumer: 'chat:claude', credentialId: 'cred1' }, [cred, other])
    const r = resolveService('chat:claude', { credentialId: 'cred2' })!
    expect(r.credentialId).toBe('cred2')
  })

  it('falls back to the global binding when the override credential no longer exists', () => {
    bind({ consumer: 'chat:claude', credentialId: 'cred1' }, [cred])
    const r = resolveService('chat:claude', { credentialId: 'deleted' })!
    expect(r.credentialId).toBe('cred1')
  })

  it('returns null when nothing is bound', () => {
    bind(undefined, [])
    expect(resolveService('chat:claude')).toBeNull()
  })

  it('reads the api key from secretEnv when set', () => {
    process.env.MY_TEST_KEY = 'env-secret'
    bind({ consumer: 'chat:claude', credentialId: 'cred1' }, [{ ...cred, secret: '', secretEnv: 'MY_TEST_KEY' }])
    expect(resolveService('chat:claude')!.apiKey).toBe('env-secret')
    delete process.env.MY_TEST_KEY
  })

  it('adds /v1beta when resolving an existing custom google endpoint with a root URL', () => {
    const googleCred: Credential = {
      ...cred,
      platformId: 'custom:google-relay',
      planId: 'api',
      overrides: { google: { models: [{ id: 'gemini-3.1-flash-lite-image', tasks: ['image'] }] } },
    }
    mockedGetBinding.mockImplementation((consumer) =>
      consumer === 'media:image' ? { consumer, credentialId: googleCred.id } : undefined,
    )
    mockedGetCred.mockImplementation((id) => (id === googleCred.id ? googleCred : undefined))
    mockedGetPlatforms.mockReturnValue([googlePlatform])

    expect(resolveService('media:image')?.baseUrl).toBe('https://relay.example.com/v1beta')
  })

  it('requires the experiment before resolving openai-chat for Claude', () => {
    const openAiChatCred: Credential = {
      ...cred,
      platformId: openAiChatPlatform.id,
      planId: 'api',
    }
    mockedGetBinding.mockReturnValue({ consumer: 'chat:claude', credentialId: openAiChatCred.id })
    mockedGetCred.mockReturnValue(openAiChatCred)
    mockedGetPlatforms.mockReturnValue([openAiChatPlatform])

    expect(resolveService('chat:claude')).toBeNull()
    expect(resolveService('chat:claude', {
      experimentalClaudeOpenAiChatEnabled: true,
    })?.protocol).toBe('openai-chat')
  })

  it('defaults ENABLE_TOOL_SEARCH=true for a custom anthropic provider', () => {
    const customAnthropic: Platform = {
      id: 'custom:relay',
      brand: 'custom',
      name: 'Relay',
      plans: [{
        id: 'api',
        name: 'API',
        auth: 'api-key',
        endpoints: [{ id: 'anthropic', baseUrl: 'https://relay.example.com', protocols: ['anthropic-messages'] }],
      }],
    }
    const customCred: Credential = {
      ...cred,
      platformId: customAnthropic.id,
      planId: 'api',
    }
    mockedGetBinding.mockReturnValue({ consumer: 'chat:claude', credentialId: customCred.id })
    mockedGetCred.mockReturnValue(customCred)
    mockedGetPlatforms.mockReturnValue([customAnthropic])

    expect(resolveService('chat:claude')?.extraEnv).toEqual({ ENABLE_TOOL_SEARCH: 'true' })
  })

  it('keeps an explicit ENABLE_TOOL_SEARCH=false on a custom anthropic provider', () => {
    const customAnthropic: Platform = {
      id: 'custom:relay-off',
      brand: 'custom',
      name: 'Relay',
      plans: [{
        id: 'api',
        name: 'API',
        auth: 'api-key',
        endpoints: [{
          id: 'anthropic',
          baseUrl: 'https://relay.example.com',
          protocols: ['anthropic-messages'],
          defaults: { extraEnv: { ENABLE_TOOL_SEARCH: 'false' } },
        }],
      }],
    }
    const customCred: Credential = {
      ...cred,
      platformId: customAnthropic.id,
      planId: 'api',
    }
    mockedGetBinding.mockReturnValue({ consumer: 'chat:claude', credentialId: customCred.id })
    mockedGetCred.mockReturnValue(customCred)
    mockedGetPlatforms.mockReturnValue([customAnthropic])

    expect(resolveService('chat:claude')?.extraEnv).toEqual({ ENABLE_TOOL_SEARCH: 'false' })
  })
})

describe('buildClaudeEnv', () => {
  it('emits ANTHROPIC_* keys, mirrors the key into AUTH_TOKEN, and expands the model mapping', () => {
    const env = buildClaudeEnv({
      platformId: 'zhipu-cn',
      brand: 'zhipu',
      planId: 'coding',
      endpointId: 'anthropic',
      credentialId: 'cred1',
      task: 'chat',
      protocol: 'anthropic-messages',
      baseUrl: 'https://base',
      apiKey: 'sk-123',
      auth: 'api-key',
      models: [],
      modelMapping: { opus: { id: 'glm-opus', name: 'GLM Opus' } },
      extraEnv: { API_TIMEOUT_MS: '3000000', ANTHROPIC_AUTH_TOKEN: '' },
    })
    expect(env.ANTHROPIC_API_KEY).toBe('sk-123')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-123')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://base')
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-opus')
  })

  it('returns an empty env for a null service (oauth default login)', () => {
    expect(buildClaudeEnv(null)).toEqual({})
  })
})

describe('buildRemoteActiveService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps brand into presetKey', () => {
    bind({ consumer: 'chat:claude', credentialId: 'cred1' }, [cred])
    const remote = buildRemoteActiveService(resolveService('chat:claude'), 'claude')
    expect(remote?.presetKey).toBe('zhipu')
    expect(remote?.id).toBe('cred1')
  })
})

/**
 * A relay that publishes both Ark's official video path and its own serves the same Seedance model
 * on two wires. Which one a generation actually takes is decided here, and the answer has to survive
 * all the way to the driver — `videoKindFor` reads only the protocol, so picking the wrong endpoint
 * silently sends an Ark-shaped request to a New API-shaped route.
 */
describe('media:video on a relay serving two video wires', () => {
  const seedance = { id: 'doubao-seedance-2-0-fast-260128' }
  const sora = { id: 'sora-2' }

  const relay: Platform = {
    id: 'custom:relay',
    brand: 'custom',
    name: 'Relay',
    plans: [{
      id: 'api',
      name: 'API',
      auth: 'api-key',
      baseUrl: 'https://super-api.dev',
      endpoints: [
        // Order as customEndpointsFor() derives it — volcengine before newapi.
        { id: 'ark-video', protocols: ['ark-video'], routes: { 'ark-video': '/api/v3/contents/generations/tasks' } },
        { id: 'newapi-video', protocols: ['newapi-video'] },
      ],
    }],
  }
  const relayCred: Credential = {
    id: 'relay-key',
    platformId: 'custom:relay',
    planId: 'api',
    name: 'relay',
    secret: 'sk-relay',
    baseUrl: 'https://super-api.dev',
    endpoints: [
      { id: 'ark-video', protocols: ['ark-video'], routes: { 'ark-video': '/api/v3/contents/generations/tasks' }, models: [seedance] },
      { id: 'newapi-video', protocols: ['newapi-video'], models: [seedance, sora] },
    ],
    notes: '',
    sortOrder: 0,
  }

  beforeEach(() => vi.clearAllMocks())

  it('prefers the vendor-official wire when nothing pins an endpoint', () => {
    bind({ consumer: 'media:video', credentialId: 'relay-key' }, [relayCred])
    mockedGetPlatforms.mockReturnValue([relay])
    const resolved = resolveService('media:video')
    expect(resolved?.endpointId).toBe('ark-video')
    expect(resolved?.protocol).toBe('ark-video')
    // The site root plus the relay's published route, minus what the Ark driver re-appends.
    expect(resolved?.baseUrl).toBe('https://super-api.dev/api/v3')
  })

  it('honours a binding that pins the relay wire instead', () => {
    bind({ consumer: 'media:video', credentialId: 'relay-key', endpointId: 'newapi-video' }, [relayCred])
    mockedGetPlatforms.mockReturnValue([relay])
    const resolved = resolveService('media:video')
    expect(resolved?.endpointId).toBe('newapi-video')
    expect(resolved?.protocol).toBe('newapi-video')
    expect(resolved?.baseUrl).toBe('https://super-api.dev/v1')
  })

  it('routes by model id over the bound endpoint, so Sora does not ride the Ark wire', () => {
    bind({ consumer: 'media:video', credentialId: 'relay-key', endpointId: 'ark-video' }, [relayCred])
    mockedGetPlatforms.mockReturnValue([relay])
    const resolved = resolveService('media:video', { modelId: 'sora-2' })
    expect(resolved?.endpointId).toBe('newapi-video')
    expect(resolved?.protocol).toBe('newapi-video')
  })
})
