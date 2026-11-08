import type { SpeechVoicePreviewResult } from '@superone/shared/agent-types'
import { assertElevenLabsSpeechHost } from './registry'
import {
  resolveDefaultSpeechModel,
  resolveDefaultSpeechProviderId,
  resolveSpeechProvider,
} from './providers'

/** Public clips from GET /v1/voices/{id} are served from this bucket. */
const PREVIEW_HOSTS = new Set(['storage.googleapis.com'])
const VOICE_ID = /^[A-Za-z0-9_-]{1,80}$/
const MAX_PREVIEW_BYTES = 2_000_000

/** Accept only an https preview on the ElevenLabs sample bucket. */
export function elevenLabsPreviewUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || !PREVIEW_HOSTS.has(url.hostname)) return null
  return url
}

/**
 * Download the account's preview clip for one ElevenLabs voice.
 * The API key is sent only to api.elevenlabs.io, never to the audio host.
 */
export async function previewSpeechVoice(
  voiceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SpeechVoicePreviewResult> {
  const id = voiceId.trim()
  if (!VOICE_ID.test(id)) return { ok: false, error: 'invalid' }
  let apiKey: string
  try {
    const credentialId = resolveDefaultSpeechProviderId()
    const modelId = resolveDefaultSpeechModel(credentialId)
    const provider = resolveSpeechProvider(credentialId, modelId)
    if (provider.kind !== 'elevenlabs') return { ok: false, error: 'unavailable' }
    assertElevenLabsSpeechHost(provider.baseURL)
    apiKey = provider.apiKey
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return { ok: false, error: message.includes('not supported') ? 'unavailable' : 'unconfigured' }
  }
  try {
    const detail = await fetchImpl(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`, {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    })
    if (detail.status === 404) return { ok: false, error: 'not-found' }
    if (!detail.ok) return { ok: false, error: 'failed' }
    const body = await detail.json() as { preview_url?: unknown }
    const preview = elevenLabsPreviewUrl(body?.preview_url)
    if (!preview) return { ok: false, error: 'no-preview' }
    const audio = await fetchImpl(preview.toString(), {
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    })
    if (!audio.ok) return { ok: false, error: 'failed' }
    const bytes = new Uint8Array(await audio.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PREVIEW_BYTES) return { ok: false, error: 'failed' }
    const header = audio.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    const mediaType = header.startsWith('audio/') ? header : 'audio/mpeg'
    return { ok: true, mediaType, audioBase64: Buffer.from(bytes).toString('base64') }
  } catch {
    return { ok: false, error: 'failed' }
  }
}
