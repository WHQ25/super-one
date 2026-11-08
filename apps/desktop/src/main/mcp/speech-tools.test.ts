import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../speech/providers', () => ({
  listSpeechProviders: vi.fn(() => [
    {
      id: 'cred-1',
      label: 'ElevenLabs',
      platformId: 'elevenlabs',
      kind: 'elevenlabs',
      task: 'tts',
      defaultModel: 'eleven_multilingual_v2',
      defaultVoice: '21m00Tcm4TlvDq8ikWAM',
      models: [{ id: 'eleven_multilingual_v2', name: 'Multilingual v2' }],
    },
  ]),
}))

vi.mock('../speech/service', () => ({
  synthesizeSpeech: vi.fn(async () => ({
    bytes: Uint8Array.from([1, 2, 3]),
    mediaType: 'audio/mpeg',
    providerId: 'cred-1',
    model: 'eleven_multilingual_v2',
    voice: '21m00Tcm4TlvDq8ikWAM',
    kind: 'elevenlabs',
  })),
  transcribeAudio: vi.fn(async () => ({
    text: 'hello',
    providerId: 'cred-1',
    model: 'scribe_v2',
    language: 'en',
  })),
}))

import { synthesizeSpeech, transcribeAudio } from '../speech/service'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'
import {
  SPEECH_TEXT_LIMIT,
  generateSpeechToolHandler,
  listSpeechProvidersHandler,
  transcribeSpeechToolHandler,
} from './speech-tools'

const deps = {
  sessionId: 'speech-test',
  sessionHost: null,
  notifyDevAppReady: () => {},
  applyAppSettings: () => ({}) as never,
} satisfies BuiltInSuperoneToolDeps

function payload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>
}

describe('speech tools', () => {
  beforeEach(() => {
    vi.mocked(synthesizeSpeech).mockClear()
    vi.mocked(transcribeAudio).mockClear()
  })

  it('lists enabled speech providers with their default voice', () => {
    const body = payload(listSpeechProvidersHandler({ category: 'tts' }))
    expect(body.providers).toEqual([
      expect.objectContaining({
        id: 'cred-1',
        kind: 'elevenlabs',
        defaultVoice: '21m00Tcm4TlvDq8ikWAM',
        models: [{ id: 'eleven_multilingual_v2', label: 'Multilingual v2' }],
      }),
    ])
  })

  it('saves synthesized speech under the session agent directory', async () => {
    const result = await generateSpeechToolHandler({ text: 'Hello' }, deps)
    const body = payload(result)
    expect(body.status).toBe('generated')
    expect(String(body.savedPath)).toMatch(/\/speech-test\/agent\/speech-.+\.mp3$/)
    expect(body.voice).toBe('21m00Tcm4TlvDq8ikWAM')
    expect(synthesizeSpeech).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello', credentialId: undefined }))
  })

  it('asks the agent to split text past the synthesis cap', async () => {
    const result = await generateSpeechToolHandler({ text: 'a'.repeat(SPEECH_TEXT_LIMIT + 1) }, deps)
    expect(result.isError).toBe(true)
    expect(payload(result).message).toMatch(/Split it/)
    expect(synthesizeSpeech).not.toHaveBeenCalled()
  })

  it('transcribes an absolute audio path and forwards the language hint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'speech-audio-'))
    const path = join(dir, 'clip.mp3')
    writeFileSync(path, Buffer.from('audio'))
    const body = payload(await transcribeSpeechToolHandler({ path, language: 'en' }, deps))
    expect(body).toMatchObject({ status: 'transcribed', text: 'hello', language: 'en' })
    expect(transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }))
  })

  it('rejects a relative transcription path before reading it', async () => {
    const result = await transcribeSpeechToolHandler({ path: 'clip.mp3' }, deps)
    expect(result.isError).toBe(true)
    expect(payload(result).message).toMatch(/absolute path/)
    expect(transcribeAudio).not.toHaveBeenCalled()
  })
})
