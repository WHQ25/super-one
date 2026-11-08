import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./providers', () => ({
  resolveDefaultSpeechProviderId: vi.fn(() => 'cred-1'),
  resolveDefaultSpeechModel: vi.fn(() => 'eleven_multilingual_v2'),
  resolveSpeechProvider: vi.fn(() => ({
    id: 'cred-1',
    kind: 'elevenlabs',
    apiKey: 'key',
    models: ['eleven_multilingual_v2'],
    platformId: 'elevenlabs',
    label: 'elevenlabs',
  })),
  resolveDefaultTranscriptionProviderId: vi.fn(() => 'cred-1'),
  resolveDefaultTranscriptionModel: vi.fn(() => 'scribe_v2'),
  resolveTranscriptionProvider: vi.fn(() => ({
    id: 'cred-1',
    kind: 'elevenlabs',
    apiKey: 'key',
    models: ['scribe_v2'],
    platformId: 'elevenlabs',
    label: 'elevenlabs',
  })),
}))

vi.mock('./registry', () => ({
  resolveSpeechModel: vi.fn(async () => ({ id: 'speech-model' })),
  resolveTranscriptionModel: vi.fn(async () => ({ id: 'transcription-model' })),
  assertElevenLabsSpeechHost: vi.fn(),
}))

vi.mock('ai', () => ({
  generateSpeech: vi.fn(async () => ({
    audio: { uint8Array: Uint8Array.from([9, 8, 7]), mediaType: 'audio/mpeg' },
  })),
  experimental_streamSpeech: vi.fn(),
  transcribe: vi.fn(async () => ({ text: '你好' })),
}))

import type { AppSettings } from '@superone/shared/agent-types'
import { experimental_streamSpeech as streamSpeech, generateSpeech, transcribe } from 'ai'
import * as appSettings from '../app-settings-service'
import { resolveDefaultSpeechModel, resolveSpeechProvider } from './providers'
import { resolveSpeechModel } from './registry'
import { speakText, synthesizeSpeech, transcribeAudio } from './service'

describe('speech service', () => {
  beforeEach(() => {
    vi.mocked(generateSpeech).mockClear()
    vi.mocked(transcribe).mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      voices: [
        { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', category: 'premade' },
        { voice_id: 'owned-voice', name: 'Owned', category: 'generated' },
      ],
    }), { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('synthesizes mp3 with an owned ElevenLabs voice instead of Rachel', async () => {
    const audio = await synthesizeSpeech({ text: 'Hello' })
    expect(audio.voice).toBe('owned-voice')
    expect(audio.bytes).toEqual(Uint8Array.from([9, 8, 7]))
    expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Hello',
      voice: 'owned-voice',
      outputFormat: 'mp3',
    }))
  })

  it('uses the voice saved for that provider', async () => {
    const spy = vi.spyOn(appSettings, 'readAppSettings').mockReturnValue({
      speechVoices: { 'cred-1': 'custom-voice' },
    } as AppSettings)
    try {
      const audio = await synthesizeSpeech({ text: 'Hello' })
      expect(audio.voice).toBe('custom-voice')
      expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({ voice: 'custom-voice' }))
    } finally {
      spy.mockRestore()
    }
  })

  it('lets an explicit voice replace the saved one', async () => {
    const spy = vi.spyOn(appSettings, 'readAppSettings').mockReturnValue({
      speechVoices: { 'cred-1': 'custom-voice' },
    } as AppSettings)
    try {
      await synthesizeSpeech({ text: 'Hello', voice: '  alloy  ' })
      expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({ voice: 'alloy' }))
    } finally {
      spy.mockRestore()
    }
  })

  it('passes a language hint through the ElevenLabs provider options', async () => {
    const result = await transcribeAudio({ audio: Uint8Array.from([1]), language: 'zh' })
    expect(result.text).toBe('你好')
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({
      providerOptions: { elevenlabs: { languageCode: 'zh' } },
    }))
  })

  it('returns base64 audio for a chat reply and strips markdown', async () => {
    const spoken = await speakText({ text: 'Hello **there**' })
    expect(spoken.ok).toBe(true)
    if (!spoken.ok) return
    expect(Buffer.from(spoken.audioBase64, 'base64')).toEqual(Buffer.from([9, 8, 7]))
    expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello there' }))
  })

  it('reports a missing reply without calling the provider', async () => {
    const spoken = await speakText({ text: '```ts\nconst x = 1\n```' })
    expect(spoken).toEqual({ ok: false, error: 'Nothing to read' })
    expect(generateSpeech).not.toHaveBeenCalled()
  })

  it('returns the provider error instead of hiding it', async () => {
    vi.mocked(generateSpeech).mockRejectedValueOnce(Object.assign(new Error('quota exceeded'), { statusCode: 429 }))
    await expect(speakText({ text: 'Hello' })).resolves.toEqual({ ok: false, error: 'quota exceeded' })
  })

  it('starts a long reply in sentence-sized pieces', async () => {
    const clips: string[] = []
    const spoken = await speakText({ text: `${'Hello there. '.repeat(40)}` }, {
      onClip: (clip) => { clips.push(clip.mediaType) },
    })
    expect(generateSpeech.mock.calls.length).toBeGreaterThan(1)
    expect(clips.length).toBe(generateSpeech.mock.calls.length)
    expect(spoken.ok).toBe(true)
    if (spoken.ok) expect(spoken.audioBase64).toBeUndefined()
  })

  it('streams Gemini audio from streamGenerateContent', async () => {
    vi.mocked(resolveDefaultSpeechModel).mockReturnValueOnce('gemini-2.5-flash-preview-tts')
    vi.mocked(resolveSpeechProvider).mockReturnValueOnce({
      id: 'cred-1',
      kind: 'google',
      apiKey: 'key',
      models: ['gemini-2.5-flash-preview-tts'],
      platformId: 'google',
      label: 'Google',
    })
    const pcm = Buffer.from(Uint8Array.from([1, 0])).toString('base64')
    const fetchImpl = vi.fn(async () => new Response(`data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm } }] } }],
    })}\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchImpl)
    const clips: Array<{ sampleRate?: number }> = []
    const spoken = await speakText({ text: 'Hello' }, { onClip: (clip) => { clips.push(clip) } })
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(':streamGenerateContent')
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('gemini-2.5-flash-preview-tts')
    expect(generateSpeech).not.toHaveBeenCalled()
    expect(clips[0]?.sampleRate).toBe(24000)
    expect(spoken.ok).toBe(true)
  })

  it('uses streamSpeech when the model implements streaming', async () => {
    vi.mocked(resolveSpeechModel).mockResolvedValueOnce({ doStream: () => undefined } as never)
    const chunk = Uint8Array.from([1, 0, 2, 0])
    vi.mocked(streamSpeech).mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: 'audio', audio: chunk, audioFormat: { type: 'audio/pcm', rate: 24000 } }
      })(),
    } as never)
    const clips: Array<{ sampleRate?: number }> = []
    const spoken = await speakText({ text: 'Hello' }, { onClip: (clip) => { clips.push(clip) } })
    expect(streamSpeech).toHaveBeenCalled()
    expect(generateSpeech).not.toHaveBeenCalled()
    expect(clips[0]?.sampleRate).toBe(24000)
    expect(spoken.ok).toBe(true)
  })

  it('falls back to generateSpeech when streaming is refused', async () => {
    vi.mocked(resolveSpeechModel).mockResolvedValueOnce({ doStream: () => undefined } as never)
    vi.mocked(streamSpeech).mockImplementationOnce(() => {
      throw Object.assign(new Error('streaming speech is not supported'), { name: 'AI_UnsupportedFunctionalityError' })
    })
    const spoken = await speakText({ text: 'Hello' })
    expect(generateSpeech).toHaveBeenCalled()
    expect(spoken).toMatchObject({ ok: true, audioBase64: Buffer.from([9, 8, 7]).toString('base64') })
  })
})
