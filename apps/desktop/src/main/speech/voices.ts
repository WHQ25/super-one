import type { SpeechVoiceCatalogResult, SpeechVoiceOption } from '@superone/shared/agent-types'
import { assertElevenLabsSpeechHost } from './registry'
import { defaultVoice } from './kinds'
import {
  resolveDefaultSpeechModel,
  resolveDefaultSpeechProviderId,
  resolveSpeechProvider,
  type SpeechProviderConfig,
} from './providers'
import { savedSpeechVoice } from './voice-preference'

/**
 * OpenAI's speech guide lists 13 built-in voices. `tts-1` and `tts-1-hd` accept
 * only the original nine; `gpt-4o-mini-tts` accepts all of them.
 * https://developers.openai.com/api/docs/guides/text-to-speech
 */
const OPENAI_VOICES = [
  'alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse',
] as const

const OPENAI_TTS1_VOICES = new Set(['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'])

/**
 * Gemini's 30 prebuilt studio voices. Names are case-sensitive.
 * https://ai.google.dev/gemini-api/docs/speech-generation
 */
const GOOGLE_VOICES = [
  'Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe', 'Callirrhoe', 'Charon', 'Despina',
  'Enceladus', 'Erinome', 'Fenrir', 'Gacrux', 'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Puck',
  'Pulcherrima', 'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel', 'Vindemiatrix', 'Zephyr', 'Zubenelgenubi',
] as const

/** Rachel. Used only when the account voice list cannot be loaded. */
export const ELEVENLABS_FALLBACK_VOICES: SpeechVoiceOption[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' },
]

/** Voice Design, then a clone, then a premade voice. Library voices are last. */
const ELEVENLABS_DEFAULT_RANK: Record<string, number> = {
  generated: 0,
  cloned: 1,
  premade: 2,
}

export interface ElevenLabsAccountVoice extends SpeechVoiceOption {
  category?: string
}

function titled(id: string): SpeechVoiceOption {
  return { id, label: id[0]!.toUpperCase() + id.slice(1) }
}

export function openAIVoices(modelId: string | undefined): SpeechVoiceOption[] {
  const ids = modelId === 'tts-1' || modelId === 'tts-1-hd'
    ? OPENAI_VOICES.filter((id) => OPENAI_TTS1_VOICES.has(id))
    : OPENAI_VOICES
  return ids.map(titled)
}

export function googleVoices(): SpeechVoiceOption[] {
  return GOOGLE_VOICES.map((id) => ({ id, label: id }))
}

export function parseElevenLabsVoices(body: unknown): ElevenLabsAccountVoice[] {
  const list = body && typeof body === 'object' && Array.isArray((body as { voices?: unknown }).voices)
    ? (body as { voices: unknown[] }).voices
    : []
  const seen = new Set<string>()
  const voices: ElevenLabsAccountVoice[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { voice_id?: unknown; name?: unknown; category?: unknown }
    const id = typeof record.voice_id === 'string' ? record.voice_id.trim() : ''
    if (!id || seen.has(id)) continue
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const category = typeof record.category === 'string' ? record.category : undefined
    seen.add(id)
    voices.push({ id, label: name || id, ...(category ? { category } : {}) })
  }
  voices.sort((a, b) => a.label.localeCompare(b.label, 'en') || a.id.localeCompare(b.id))
  return voices
}

/**
 * Implicit ElevenLabs voice. Voice Library voices (`professional` and the like)
 * are rejected by the free API, so an owned voice wins over Rachel.
 */
export function pickElevenLabsDefaultVoice(voices: ElevenLabsAccountVoice[]): ElevenLabsAccountVoice | undefined {
  return [...voices].sort((a, b) => {
    const rankA = ELEVENLABS_DEFAULT_RANK[a.category ?? ''] ?? 3
    const rankB = ELEVENLABS_DEFAULT_RANK[b.category ?? ''] ?? 3
    return rankA - rankB || a.label.localeCompare(b.label, 'en') || a.id.localeCompare(b.id)
  })[0]
}

export async function listElevenLabsVoices(
  apiKey: string,
  baseURL: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ElevenLabsAccountVoice[]> {
  assertElevenLabsSpeechHost(baseURL)
  const response = await fetchImpl('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`ElevenLabs voices failed (${response.status})`)
  const voices = parseElevenLabsVoices(await response.json())
  if (voices.length === 0) throw new Error('ElevenLabs returned no voices')
  return voices
}

async function loadVoices(
  provider: SpeechProviderConfig,
  modelId: string,
): Promise<{ voices: ElevenLabsAccountVoice[]; fallback: boolean }> {
  if (provider.kind === 'google') return { voices: googleVoices(), fallback: false }
  if (provider.kind !== 'elevenlabs') return { voices: openAIVoices(modelId), fallback: false }
  try {
    return { voices: await listElevenLabsVoices(provider.apiKey, provider.baseURL), fallback: false }
  } catch {
    return { voices: ELEVENLABS_FALLBACK_VOICES, fallback: true }
  }
}

function withVoice(voices: SpeechVoiceOption[], id: string | undefined, label: string): SpeechVoiceOption[] {
  if (!id || voices.some((voice) => voice.id === id)) return voices
  return [{ id, label }, ...voices]
}

/** Voices for the speech provider read-aloud and speech_generate will use. */
export async function listSpeechVoiceCatalog(): Promise<SpeechVoiceCatalogResult> {
  let provider: SpeechProviderConfig
  let modelId: string
  try {
    const credentialId = resolveDefaultSpeechProviderId()
    modelId = resolveDefaultSpeechModel(credentialId)
    provider = resolveSpeechProvider(credentialId, modelId)
  } catch {
    return { error: 'unconfigured' }
  }
  try {
    const loaded = await loadVoices(provider, modelId)
    const saved = savedSpeechVoice(provider.id)
    const picked = provider.kind === 'elevenlabs' && !loaded.fallback
      ? pickElevenLabsDefaultVoice(loaded.voices)
      : undefined
    const fallbackVoice = picked?.id ?? defaultVoice(provider.kind)
    const fallbackLabel = picked?.label
      ?? loaded.voices.find((voice) => voice.id === fallbackVoice)?.label
      ?? ELEVENLABS_FALLBACK_VOICES.find((voice) => voice.id === fallbackVoice)?.label
      ?? fallbackVoice
    const voices = withVoice(withVoice(loaded.voices, fallbackVoice, fallbackLabel), saved, saved ?? '')
      .map(({ id, label }) => ({ id, label }))
    return {
      credentialId: provider.id,
      voices,
      defaultVoice: fallbackVoice,
      selectedVoice: saved && voices.some((voice) => voice.id === saved) ? saved : fallbackVoice,
      ...(loaded.fallback ? { fallback: true } : {}),
      ...(provider.kind === 'elevenlabs' ? { customVoice: true } : {}),
    }
  } catch {
    return { error: 'failed' }
  }
}
