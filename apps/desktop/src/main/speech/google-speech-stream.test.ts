import { describe, expect, it, vi } from 'vitest'
import { streamGoogleSpeech } from './google-speech-stream'

describe('streamGoogleSpeech', () => {
  it('plays PCM chunks from streamGenerateContent and keeps the key out of the URL', async () => {
    const pcm = Buffer.from(Uint8Array.from([1, 0, 2, 0])).toString('base64')
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-tts:streamGenerateContent?alt=sse')
      expect(String(url)).not.toContain('test-key')
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-key')
      const event = {
        candidates: [{
          content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm } }] },
        }],
      }
      return new Response(`data: ${JSON.stringify(event)}\n\n`, { status: 200 })
    })
    const chunks: Array<{ sampleRate: number; bytes: number[] }> = []
    await streamGoogleSpeech({
      apiKey: 'test-key',
      modelId: 'gemini-tts',
      voice: 'Kore',
      text: 'Hello',
      fetchImpl,
      onChunk: (chunk) => { chunks.push({ sampleRate: chunk.sampleRate, bytes: [...chunk.bytes] }) },
    })
    expect(chunks).toEqual([{ sampleRate: 24000, bytes: [1, 0, 2, 0] }])
  })
})