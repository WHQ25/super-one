import { experimental_streamSpeech as streamSpeech, generateSpeech, transcribe } from 'ai'
import type { SpeechSpeakRequest, SpeechSpeakResult } from '@superone/shared/agent-types'
import { trace, traceReady } from '../agent/event-trace'
import { writeSpeechCache, type StoredSpeechClip } from './cache'
import { streamGoogleSpeech } from './google-speech-stream'
import { concatBytes, pcmToWav } from './speech-wav'
import { spokenSegments, spokenText } from './spoken-text'
import { resolveSpeechVoice, savedSpeechVoice } from './voice-preference'
import { listElevenLabsVoices, pickElevenLabsDefaultVoice } from './voices'
import {
  resolveDefaultSpeechModel,
  resolveDefaultSpeechProviderId,
  resolveDefaultTranscriptionModel,
  resolveDefaultTranscriptionProviderId,
  resolveSpeechProvider,
  resolveTranscriptionProvider,
  type SpeechProviderConfig,
} from './providers'
import { resolveSpeechModel, resolveTranscriptionModel } from './registry'

export interface SynthesizeParams {
  text: string
  credentialId?: string | null
  modelId?: string | null
  voice?: string
  abortSignal?: AbortSignal
}

export interface SynthesizeResult {
  bytes: Uint8Array
  mediaType: string
  providerId: string
  model: string
  voice: string
  kind: SpeechProviderConfig['kind']
}

interface PreparedSpeech {
  providerId: string
  model: string
  provider: SpeechProviderConfig
  voice: string
  speech: Awaited<ReturnType<typeof resolveSpeechModel>>
}

async function prepareSpeech(params: Pick<SynthesizeParams, 'credentialId' | 'modelId' | 'voice'>): Promise<PreparedSpeech> {
  const providerId = params.credentialId ?? resolveDefaultSpeechProviderId()
  const model = params.modelId ?? resolveDefaultSpeechModel(providerId)
  const provider = resolveSpeechProvider(providerId, model)
  const voice = await resolveSynthesisVoice(provider, params.voice)
  const speech = await resolveSpeechModel(provider, model)
  return { providerId, model, provider, voice, speech }
}

/** ElevenLabs implements doStream. Google's SDK model does not, so Gemini is streamed separately. */
function canStreamSpeech(model: PreparedSpeech['speech']): boolean {
  return typeof (model as { doStream?: unknown }).doStream === 'function'
}

async function renderSpeech(prepared: PreparedSpeech, text: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const result = await generateSpeech({
    model: prepared.speech,
    text,
    voice: prepared.voice,
    outputFormat: 'mp3',
    ...(signal ? { abortSignal: signal } : {}),
  })
  return {
    bytes: result.audio.uint8Array,
    mediaType: result.audio.mediaType || 'audio/mpeg',
  }
}

export async function synthesizeSpeech(params: SynthesizeParams): Promise<SynthesizeResult> {
  const text = params.text.trim()
  if (!text) throw new Error('Text is required')
  const prepared = await prepareSpeech(params)
  const audio = await renderSpeech(prepared, text, params.abortSignal)
  return {
    bytes: audio.bytes,
    mediaType: audio.mediaType,
    providerId: prepared.providerId,
    model: prepared.model,
    voice: prepared.voice,
    kind: prepared.provider.kind,
  }
}

export interface TranscribeParams {
  audio: Uint8Array
  mediaType?: string
  credentialId?: string | null
  modelId?: string | null
  language?: string
  abortSignal?: AbortSignal
}

export interface TranscribeResult {
  text: string
  providerId: string
  model: string
  language?: string
}

/** Saved and explicit voices win. Otherwise an owned ElevenLabs voice, not Rachel. */
async function resolveSynthesisVoice(provider: SpeechProviderConfig, explicit?: string | null): Promise<string> {
  const chosen = resolveSpeechVoice(provider.kind, provider.id, explicit)
  if (explicit?.trim() || savedSpeechVoice(provider.id) || provider.kind !== 'elevenlabs') return chosen
  try {
    const voices = await listElevenLabsVoices(provider.apiKey, provider.baseURL)
    return pickElevenLabsDefaultVoice(voices)?.id ?? chosen
  } catch {
    return chosen
  }
}

function transcriptionOptions(kind: SpeechProviderConfig['kind'], language: string) {
  if (kind === 'elevenlabs') return { elevenlabs: { languageCode: language } }
  if (kind === 'google') return { google: { languageCodes: [language] } }
  return { openai: { language } }
}

export async function transcribeAudio(params: TranscribeParams): Promise<TranscribeResult> {
  if (params.audio.byteLength === 0) throw new Error('Audio is empty')
  const providerId = params.credentialId ?? resolveDefaultTranscriptionProviderId()
  const model = params.modelId ?? resolveDefaultTranscriptionModel(providerId)
  const provider = resolveTranscriptionProvider(providerId, model)
  const transcription = await resolveTranscriptionModel(provider, model)
  const language = params.language?.trim()
  const result = await transcribe({
    model: transcription,
    audio: params.audio,
    ...(language
      ? { providerOptions: transcriptionOptions(provider.kind, language) as unknown as NonNullable<Parameters<typeof transcribe>[0]['providerOptions']> }
      : {}),
    ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
  })
  return { text: result.text, providerId, model, ...(language ? { language } : {}) }
}

/** Keep provider failures out of the trace row: no key, no reply text, no audio. */
function speechErrorFields(error: unknown): { name: string; message: string; statusCode?: number } {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw
    .replace(/xi-api-key["'\s:=]+[^\s"',}]+/gi, 'xi-api-key=[redacted]')
    .replace(/\b(?:sk|xi)[-_][A-Za-z0-9]{16,}\b/g, '[redacted]')
    .slice(0, 500)
  const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
    && typeof error.statusCode === 'number'
    ? error.statusCode
    : undefined
  return {
    name: error instanceof Error ? error.name : 'Error',
    message,
    ...(statusCode !== undefined ? { statusCode } : {}),
  }
}

function configuredSpeech(): { model?: string; kind?: string; voice?: string } {
  try {
    const providerId = resolveDefaultSpeechProviderId()
    const model = resolveDefaultSpeechModel(providerId)
    const provider = resolveSpeechProvider(providerId, model)
    return { model, kind: provider.kind, voice: resolveSpeechVoice(provider.kind, provider.id) }
  } catch {
    return {}
  }
}

async function speechTrace(type: 'ok' | 'error', data: Record<string, unknown>): Promise<void> {
  await traceReady
  trace('speech.speak', type, data)
}

export interface SpeechSpeakClipBytes {
  mediaType: string
  bytes: Uint8Array
  sampleRate?: number
}

export interface SpeakTextOptions {
  signal?: AbortSignal
  onClip?: (clip: SpeechSpeakClipBytes) => void
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}

function isUnsupportedStream(error: unknown): boolean {
  return error instanceof Error && error.name === 'AI_UnsupportedFunctionalityError'
}

/** Stream PCM when the provider can. Otherwise emit each finished sentence while the next one generates. */
async function speakPrepared(
  prepared: PreparedSpeech,
  text: string,
  signal: AbortSignal | undefined,
  onClip: ((clip: SpeechSpeakClipBytes) => void) | undefined,
): Promise<{ stored: StoredSpeechClip[]; streamed: boolean }> {
  const stored: StoredSpeechClip[] = []
  let emitted = 0
  const emit = (clip: SpeechSpeakClipBytes) => {
    emitted += 1
    onClip?.(clip)
    if (clip.sampleRate == null) stored.push({ mediaType: clip.mediaType, bytes: clip.bytes })
  }

  if (prepared.provider.kind === 'google') {
    try {
      const pcmParts: Uint8Array[] = []
      let sampleRate = 24_000
      await streamGoogleSpeech({
        apiKey: prepared.provider.apiKey,
        baseURL: prepared.provider.baseURL,
        modelId: prepared.model,
        voice: prepared.voice,
        text,
        signal,
        onChunk: (chunk) => {
          sampleRate = chunk.sampleRate
          emit({ mediaType: 'audio/pcm', bytes: chunk.bytes, sampleRate: chunk.sampleRate })
          pcmParts.push(chunk.bytes)
        },
      })
      const pcm = concatBytes(pcmParts)
      if (pcm.byteLength > 0) stored.push({ mediaType: 'audio/wav', bytes: pcmToWav(pcm, sampleRate) })
      return { stored, streamed: true }
    } catch (error) {
      if (signal?.aborted || isAbort(error, signal) || emitted > 0) throw error
    }
  }

  if (canStreamSpeech(prepared.speech)) {
    try {
      const streamed = await streamSpoken(prepared, text, signal, emit)
      if (streamed.pcm.byteLength > 0) {
        stored.push({ mediaType: 'audio/wav', bytes: pcmToWav(streamed.pcm, streamed.sampleRate) })
      }
      return { stored, streamed: true }
    } catch (error) {
      if (emitted > 0 || !isUnsupportedStream(error)) throw error
    }
  }

  for (const segment of spokenSegments(text)) {
    if (signal?.aborted) break
    const audio = await renderSpeech(prepared, segment, signal)
    emit({ mediaType: audio.mediaType, bytes: audio.bytes })
  }
  return { stored, streamed: false }
}

async function streamSpoken(
  prepared: PreparedSpeech,
  text: string,
  signal: AbortSignal | undefined,
  emit: (clip: SpeechSpeakClipBytes) => void,
): Promise<{ pcm: Uint8Array; sampleRate: number }> {
  const result = streamSpeech({
    model: prepared.speech,
    text,
    voice: prepared.voice,
    outputFormat: { type: 'audio/pcm', rate: 24000 },
    ...(signal ? { abortSignal: signal } : {}),
  })
  const parts: Uint8Array[] = []
  let sampleRate = 24000
  for await (const part of result.fullStream) {
    if (signal?.aborted) break
    if (part.type !== 'audio' || part.audio.byteLength === 0) continue
    const pcm = part.audioFormat.type.includes('pcm') || part.audioFormat.type.includes('l16')
    const rate = part.audioFormat.rate ?? sampleRate
    if (pcm) {
      sampleRate = rate
      emit({ mediaType: 'audio/pcm', bytes: part.audio, sampleRate: rate })
      parts.push(part.audio)
    } else {
      emit({ mediaType: part.audioFormat.type || 'application/octet-stream', bytes: part.audio })
    }
  }
  return { pcm: concatBytes(parts), sampleRate }
}

/** Read a chat reply aloud with the user's TTS provider. */
export async function speakText(request: SpeechSpeakRequest, options: SpeakTextOptions = {}): Promise<SpeechSpeakResult> {
  const started = Date.now()
  try {
    if (!request || typeof request.text !== 'string') {
      await speechTrace('error', { name: 'Error', message: 'Text is required', ms: Date.now() - started })
      return { ok: false, error: 'Text is required' }
    }
    const spoken = spokenText(request.text)
    if (!spoken.text) {
      await speechTrace('error', { name: 'Error', message: 'Nothing to read', ms: Date.now() - started })
      return { ok: false, error: 'Nothing to read' }
    }
    const prepared = await prepareSpeech({})
    const { stored, streamed } = await speakPrepared(prepared, spoken.text, options.signal, options.onClip)
    if (options.signal?.aborted) {
      await speechTrace('error', { name: 'AbortError', message: 'aborted', cancelled: true, ms: Date.now() - started })
      return { ok: false, error: 'aborted', cancelled: true }
    }
    if (stored.length === 0) {
      await speechTrace('error', { name: 'Error', message: 'No speech generated', ms: Date.now() - started })
      return { ok: false, error: 'No speech generated' }
    }
    const messageId = request.messageId?.trim()
    if (messageId) await writeSpeechCache(messageId, stored)
    await speechTrace('ok', {
      chars: spoken.text.length,
      truncated: spoken.truncated,
      model: prepared.model,
      voice: prepared.voice,
      kind: prepared.provider.kind,
      providerId: prepared.providerId,
      segments: stored.length,
      streamed,
      bytes: stored.reduce((sum, clip) => sum + clip.bytes.byteLength, 0),
      ms: Date.now() - started,
    })
    const first = stored[0]!
    return {
      ok: true,
      mediaType: first.mediaType,
      ...(stored.length === 1 ? { audioBase64: Buffer.from(first.bytes).toString('base64') } : {}),
      ...(spoken.truncated ? { truncated: true } : {}),
    }
  } catch (error) {
    if (isAbort(error, options.signal)) {
      await speechTrace('error', { name: 'AbortError', message: 'aborted', cancelled: true, ms: Date.now() - started })
      return { ok: false, error: 'aborted', cancelled: true }
    }
    const fields = speechErrorFields(error)
    await speechTrace('error', { ...fields, ...configuredSpeech(), ms: Date.now() - started })
    return { ok: false, error: fields.message }
  }
}
