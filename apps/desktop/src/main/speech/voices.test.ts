import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openAIVoices, googleVoices, parseElevenLabsVoices, pickElevenLabsDefaultVoice, listElevenLabsVoices, listSpeechVoiceCatalog } from './voices'

const mocks = vi.hoisted(() => ({
  providerId: vi.fn(() => 'cred-1'),
  model: vi.fn(() => 'gpt-4o-mini-tts'),
  provider: vi.fn(() => ({
    id: 'cred-1',
    kind: 'openai' as const,
    apiKey: 'test-key',
    models: ['gpt-4o-mini-tts'],
    platformId: 'openai',
    label: 'OpenAI',
  })),
  saved: vi.fn((): string | undefined => undefined),
}))

vi.mock('./providers', () => ({
  resolveDefaultSpeechProviderId: mocks.providerId,
  resolveDefaultSpeechModel: mocks.model,
  resolveSpeechProvider: mocks.provider,
}))

vi.mock('./voice-preference', () => ({
  savedSpeechVoice: mocks.saved,
}))

describe('speech voice catalogs', () => {
  beforeEach(() => {
    mocks.providerId.mockReset().mockReturnValue('cred-1')
    mocks.model.mockReset().mockReturnValue('gpt-4o-mini-tts')
    mocks.provider.mockReset().mockReturnValue({
      id: 'cred-1',
      kind: 'openai',
      apiKey: 'test-key',
      models: ['gpt-4o-mini-tts'],
      platformId: 'openai',
      label: 'OpenAI',
    })
    mocks.saved.mockReset().mockReturnValue(undefined)
  })

  it('lists the OpenAI voices the active model accepts', () => {
    expect(openAIVoices('gpt-4o-mini-tts').map((voice) => voice.id)).toEqual([
      'alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse',
    ])
    expect(openAIVoices('tts-1').map((voice) => voice.id)).toEqual([
      'alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer',
    ])
    expect(openAIVoices('tts-1-hd').some((voice) => voice.id === 'marin')).toBe(false)
  })

  it('lists the 30 Gemini prebuilt voices, including Kore', () => {
    const voices = googleVoices()
    expect(voices).toHaveLength(30)
    expect(new Set(voices.map((voice) => voice.id)).size).toBe(30)
    expect(voices).toContainEqual({ id: 'Kore', label: 'Kore' })
  })

  it('keeps named ElevenLabs voices and drops blanks', () => {
    expect(parseElevenLabsVoices({
      voices: [
        { voice_id: 'b', name: '  Bella ' },
        { voice_id: 'a', name: 'Adam' },
        { voice_id: 'b', name: 'Duplicate' },
        { voice_id: '  ', name: 'Missing' },
        { voice_id: 'c' },
      ],
    })).toEqual([
      { id: 'a', label: 'Adam' },
      { id: 'b', label: 'Bella' },
      { id: 'c', label: 'c' },
    ])
  })

  it('prefers a Voice Design voice over a library voice and Rachel', () => {
    expect(pickElevenLabsDefaultVoice([
      { id: 'lib', label: 'A Library', category: 'professional' },
      { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel', category: 'premade' },
      { id: 'clone', label: 'Clone', category: 'cloned' },
      { id: 'mine', label: 'Mine', category: 'generated' },
    ])?.id).toBe('mine')
    expect(pickElevenLabsDefaultVoice([
      { id: 'lib', label: 'A Library', category: 'professional' },
      { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel', category: 'premade' },
    ])?.id).toBe('21m00Tcm4TlvDq8ikWAM')
  })

  it('selects the saved voice for the resolved provider', async () => {
    mocks.saved.mockReturnValue('marin')
    const catalog = await listSpeechVoiceCatalog()
    expect(catalog).toMatchObject({
      credentialId: 'cred-1',
      defaultVoice: 'alloy',
      selectedVoice: 'marin',
    })
    expect(catalog).not.toHaveProperty('customVoice')
    if (!('voices' in catalog)) throw new Error('expected a catalog')
    expect(catalog.voices.find((voice) => voice.id === 'marin')?.label).toBe('Marin')
  })

  it('reports an unconfigured speech provider', async () => {
    mocks.providerId.mockImplementation(() => { throw new Error('No speech provider is configured') })
    await expect(listSpeechVoiceCatalog()).resolves.toEqual({ error: 'unconfigured' })
  })

  it('loads ElevenLabs account voices with the account key', async () => {
    mocks.model.mockReturnValue('eleven_multilingual_v2')
    mocks.provider.mockReturnValue({
      id: 'cred-el',
      kind: 'elevenlabs',
      apiKey: 'test-key',
      baseURL: 'https://api.elevenlabs.io/v1',
      models: ['eleven_multilingual_v2'],
      platformId: 'elevenlabs',
      label: 'ElevenLabs',
    })
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.elevenlabs.io/v1/voices')
      expect(new Headers(init?.headers).get('xi-api-key')).toBe('test-key')
      expect(String(url)).not.toContain('test-key')
      return new Response(JSON.stringify({
        voices: [
          { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', category: 'premade' },
          { voice_id: 'custom', name: 'Mine', category: 'generated' },
        ],
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchImpl)
    try {
      await expect(listElevenLabsVoices('test-key', 'https://api.elevenlabs.io/v1', fetchImpl)).resolves.toEqual([
        { id: 'custom', label: 'Mine', category: 'generated' },
        { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel', category: 'premade' },
      ])
      const catalog = await listSpeechVoiceCatalog()
      expect(catalog).toMatchObject({
        credentialId: 'cred-el',
        defaultVoice: 'custom',
        selectedVoice: 'custom',
        customVoice: true,
        voices: [
          { id: 'custom', label: 'Mine' },
          { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' },
        ],
      })
      if (!('voices' in catalog)) throw new Error('expected a catalog')
      expect(catalog.fallback).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to Rachel when the ElevenLabs voice list fails', async () => {
    mocks.model.mockReturnValue('eleven_multilingual_v2')
    mocks.provider.mockReturnValue({
      id: 'cred-el',
      kind: 'elevenlabs',
      apiKey: 'test-key',
      baseURL: 'https://relay.example/v1',
      models: ['eleven_multilingual_v2'],
      platformId: 'elevenlabs',
      label: 'ElevenLabs',
    })
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    try {
      const catalog = await listSpeechVoiceCatalog()
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(catalog).toMatchObject({
        fallback: true,
        customVoice: true,
        defaultVoice: '21m00Tcm4TlvDq8ikWAM',
        selectedVoice: '21m00Tcm4TlvDq8ikWAM',
        voices: [{ id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' }],
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
