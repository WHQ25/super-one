import { createArkVideoDriver } from './ark/video-model'
import { createGoogleVideoDriver } from './google/video-model'
import { createOpenAIVideoDriver } from './openai/video-model'
import { createNewApiVideoDriver } from './newapi/video-model'
import type { VideoTaskDriver } from './driver'
import type { MediaProviderConfig } from '../types'

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const GOOGLE_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * The single vendor-coupling point for video, mirroring `media-gen/registry.ts` for images.
 *
 * Every vendor is a hand-written `VideoTaskDriver`, including Veo — `@ai-sdk/google` ships its own
 * Veo model, but it polls to completion inside one call and never exposes the operation name, so it
 * cannot answer "what is the status of the job I started earlier". Owning all four keeps a single
 * lifecycle above this file instead of one shape for Veo and another for everyone else.
 */
export function resolveVideoDriver(cfg: MediaProviderConfig, modelId: string): VideoTaskDriver {
  switch (cfg.kind) {
    case 'google':
      return createGoogleVideoDriver(
        { provider: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL || GOOGLE_DEFAULT_BASE_URL },
        modelId,
      )
    case 'ark':
      if (!cfg.baseURL) {
        throw new Error(`media-gen video provider '${cfg.id}' (ark) requires a baseURL`)
      }
      return createArkVideoDriver({ provider: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL }, modelId)
    case 'openai':
      // The builtin OpenAI endpoint carries an empty baseUrl so the SDK's default applies; the
      // hand-written Sora adapter has no such default, so it is spelled out here.
      return createOpenAIVideoDriver(
        { provider: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL || OPENAI_DEFAULT_BASE_URL },
        modelId,
      )
    case 'openai-compatible':
      if (!cfg.baseURL) {
        throw new Error(`media-gen video provider '${cfg.id}' (openai-compatible) requires a baseURL`)
      }
      return createOpenAIVideoDriver({ provider: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL }, modelId)
    case 'newapi':
      if (!cfg.baseURL) {
        throw new Error(`media-gen video provider '${cfg.id}' (newapi) requires a baseURL`)
      }
      return createNewApiVideoDriver({ provider: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL }, modelId)
    default:
      throw new Error(`Unknown media-gen video provider kind: ${cfg.kind}`)
  }
}
