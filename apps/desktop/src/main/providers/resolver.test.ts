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
