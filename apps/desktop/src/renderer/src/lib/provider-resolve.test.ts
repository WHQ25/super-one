import { describe, expect, it } from 'vitest'
import { BUILTIN_PLATFORMS, type ConsumerBinding, type Credential, type Platform } from '@superone/shared/platform-registry'
import { resolveEffectiveProviderId, selectedSpeechModel, speechModelGroups } from './provider-resolve'

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

function speechCredential(partial: Pick<Credential, 'id' | 'platformId' | 'name' | 'overrides'>): Credential {
  return { planId: 'api', secret: '', notes: '', sortOrder: 0, ...partial }
}

describe('speechModelGroups', () => {
  const platforms = BUILTIN_PLATFORMS.filter((platform) => platform.id === 'openai' || platform.id === 'elevenlabs')
  const credentials = [
    speechCredential({
      id: 'oa',
      platformId: 'openai',
      name: 'Work',
      overrides: {
        audio: {
          models: [
            { id: 'gpt-4o-mini-tts', name: 'GPT-4o mini TTS', tasks: ['tts'] },
            { id: 'whisper-1', name: 'Whisper', tasks: ['asr'] },
          ],
        },
      },
    }),
    speechCredential({
      id: 'el',
      platformId: 'elevenlabs',
      name: 'Personal',
      overrides: {
        elevenlabs: {
          models: [
            { id: 'eleven_v4', name: 'Eleven v4', tasks: ['tts'] },
            { id: 'scribe_v2', name: 'Scribe v2', tasks: ['asr'] },
          ],
        },
      },
    }),
    speechCredential({ id: 'bare', platformId: 'openai', name: 'Unused' }),
  ]

  it('groups enabled speech models by account and drops transcription models', () => {
    expect(speechModelGroups(platforms, credentials)).toEqual([
      { credential: credentials[0], models: [{ id: 'gpt-4o-mini-tts', name: 'GPT-4o mini TTS' }] },
      { credential: credentials[1], models: [{ id: 'eleven_v4', name: 'Eleven v4' }] },
    ])
  })

  it('uses the saved model, then the account default', () => {
    const groups = speechModelGroups(platforms, credentials)
    const saved: ConsumerBinding = { consumer: 'tts', credentialId: 'el', config: { modelId: 'eleven_v4' } }
    expect(selectedSpeechModel(groups, saved)?.modelId).toBe('eleven_v4')
    const stale: ConsumerBinding = { consumer: 'tts', credentialId: 'oa', config: { modelId: 'missing' } }
    expect(selectedSpeechModel(groups, stale)?.modelId).toBe('gpt-4o-mini-tts')
    expect(selectedSpeechModel(groups, undefined)).toBeNull()
  })
})
