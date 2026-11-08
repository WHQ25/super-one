import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  providerId: vi.fn(() => 'cred-el'),
  model: vi.fn(() => 'eleven_v3'),
  provider: vi.fn(),
}))

vi.mock('./providers', () => ({
  resolveDefaultSpeechProviderId: mocks.providerId,
  resolveDefaultSpeechModel: mocks.model,
  resolveSpeechProvider: mocks.provider,
}))

import { elevenLabsPreviewUrl, previewSpeechVoice } from './preview'

const eleven = {
  id: 'cred-el',
  kind: 'elevenlabs' as const,
  apiKey: 'test-key',
  baseURL: 'https://api.elevenlabs.io/v1',
  models: ['eleven_v3'],
  platformId: 'elevenlabs',
  label: 'ElevenLabs',
}

describe('elevenLabsPreviewUrl', () => {
  it('keeps the public sample bucket and drops anything else', () => {
    expect(elevenLabsPreviewUrl('https://storage.googleapis.com/eleven-public-prod/premade/voices/rachel.mp3')?.hostname).toBe('storage.googleapis.com')
    expect(elevenLabsPreviewUrl('http://storage.googleapis.com/eleven-public-prod/a.mp3')).toBeNull()
    expect(elevenLabsPreviewUrl('https://evil.example/a.mp3')).toBeNull()
    expect(elevenLabsPreviewUrl('https://user:pass@storage.googleapis.com/a.mp3')).toBeNull()
  })
})

describe('previewSpeechVoice', () => {
  beforeEach(() => {
    mocks.providerId.mockClear()
    mocks.model.mockClear()
    mocks.provider.mockReset().mockReturnValue(eleven)
  })

  it('loads the voice with the account key and downloads the clip without it', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url)
      if (target.startsWith('https://api.elevenlabs.io/v1/voices/')) {
        expect(new Headers(init?.headers).get('xi-api-key')).toBe('test-key')
        expect(target).not.toContain('test-key')
        return new Response(JSON.stringify({
          preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/abc.mp3',
        }), { status: 200 })
      }
      expect(new Headers(init?.headers).get('xi-api-key')).toBeNull()
      expect(init?.redirect).toBe('error')
      return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    })
    const result = await previewSpeechVoice('abcVoice', fetchImpl)
    expect(result).toEqual({ ok: true, mediaType: 'audio/mpeg', audioBase64: Buffer.from([1, 2, 3]).toString('base64') })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not call the API for another provider or a bad id', async () => {
    const fetchImpl = vi.fn()
    mocks.provider.mockReturnValue({ ...eleven, kind: 'google' })
    await expect(previewSpeechVoice('abcVoice', fetchImpl)).resolves.toEqual({ ok: false, error: 'unavailable' })
    await expect(previewSpeechVoice('bad id', fetchImpl)).resolves.toEqual({ ok: false, error: 'invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports a voice the account does not have', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }))
    await expect(previewSpeechVoice('abcVoice', fetchImpl)).resolves.toEqual({ ok: false, error: 'not-found' })
  })
})
