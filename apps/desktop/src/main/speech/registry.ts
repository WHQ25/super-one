import type { SpeechModel, TranscriptionModel } from 'ai'
import type { SpeechProviderConfig } from './providers'

/**
 * Build the AI SDK model for a configured provider.
 * OpenAI-compatible relays speak `/audio/speech` and `/audio/transcriptions`, so they use
 * the OpenAI client with the relay base URL. `@ai-sdk/openai-compatible` has no speech models.
 */
/**
 * The ElevenLabs SDK pins `https://api.elevenlabs.io` and appends `/v1` itself.
 * A relay base would be ignored, so refuse it instead of sending the key elsewhere.
 */
/** The ElevenLabs SDK pins this host and appends `/v1` itself. A relay base would be ignored. */
export function assertElevenLabsSpeechHost(baseURL: string | undefined): void {
  if (!baseURL) return
  const host = new URL(baseURL).host
  if (host !== 'api.elevenlabs.io') {
    throw new Error(`ElevenLabs speech uses api.elevenlabs.io. '${baseURL}' is not supported.`)
  }
}

function elevenLabsClient(apiKey: string, baseURL: string | undefined) {
  assertElevenLabsSpeechHost(baseURL)
  return import('@ai-sdk/elevenlabs').then(({ createElevenLabs }) => createElevenLabs({ apiKey }))
}

export async function resolveSpeechModel(cfg: SpeechProviderConfig, modelId: string): Promise<SpeechModel> {
  const options = { apiKey: cfg.apiKey, baseURL: cfg.baseURL }
  switch (cfg.kind) {
    case 'openai':
    case 'openai-compatible': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI(options).speech(modelId)
    }
    case 'elevenlabs': {
      const client = await elevenLabsClient(cfg.apiKey, cfg.baseURL)
      return client.speech(modelId)
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI(options).speech(modelId)
    }
  }
}

export async function resolveTranscriptionModel(cfg: SpeechProviderConfig, modelId: string): Promise<TranscriptionModel> {
  const options = { apiKey: cfg.apiKey, baseURL: cfg.baseURL }
  switch (cfg.kind) {
    case 'openai':
    case 'openai-compatible': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI(options).transcription(modelId)
    }
    case 'elevenlabs': {
      const client = await elevenLabsClient(cfg.apiKey, cfg.baseURL)
      return client.transcription(modelId)
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI(options).transcription(modelId)
    }
  }
}
