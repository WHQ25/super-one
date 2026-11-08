import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  binding: vi.fn(),
  resolveService: vi.fn(),
  listServiceModels: vi.fn(),
  listCredentials: vi.fn(),
}))

vi.mock('../providers/credential-store', () => ({
  getBinding: mocks.binding,
  listCredentials: mocks.listCredentials,
}))

vi.mock('../providers/resolver', () => ({
  resolveService: mocks.resolveService,
  listServiceModels: mocks.listServiceModels,
}))

import { listSpeechProviders, resolveDefaultSpeechModel } from './providers'

const resolved = {
  credentialId: 'cred-1',
  apiKey: 'test-key',
  platformId: 'elevenlabs',
  protocol: 'elevenlabs-audio' as const,
  baseUrl: 'https://api.elevenlabs.io/v1',
  models: [
    { id: 'eleven_v3', name: 'Eleven v3', tasks: ['tts'] as const },
    { id: 'eleven_v4', name: 'Eleven v4', tasks: ['tts'] as const },
  ],
}

describe('speech model selection', () => {
  beforeEach(() => {
    mocks.binding.mockReset().mockReturnValue({
      consumer: 'tts',
      credentialId: 'cred-1',
      config: { modelId: 'eleven_v4' },
    })
    mocks.resolveService.mockReset().mockImplementation((_consumer: string, override?: { credentialId?: string }) => ({
      ...resolved,
      credentialId: override?.credentialId ?? 'cred-1',
    }))
    mocks.listServiceModels.mockReset().mockReturnValue(resolved.models)
    mocks.listCredentials.mockReset().mockReturnValue([{ id: 'cred-1', name: 'Personal' }])
  })

  it('uses the saved model for the bound account', () => {
    expect(resolveDefaultSpeechModel('cred-1')).toBe('eleven_v4')
    expect(resolveDefaultSpeechModel('cred-2')).toBe('eleven_v3')
  })

  it('falls back to the first enabled model when the saved id is gone', () => {
    mocks.binding.mockReturnValue({ consumer: 'tts', credentialId: 'cred-1', config: { modelId: 'gone' } })
    expect(resolveDefaultSpeechModel('cred-1')).toBe('eleven_v3')
  })

  it('reports the saved model as the provider default', () => {
    expect(listSpeechProviders('tts')[0]?.defaultModel).toBe('eleven_v4')
  })
})
