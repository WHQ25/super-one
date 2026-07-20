import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createArkVideoModel } from './ark/video-model'
import { createOpenAIVideoModel } from './openai/video-model'
import { createNewApiVideoModel } from './newapi/video-model'
import type { PollOptions } from './poll'
import type { VideoModelV4 } from './sdk-types'
import type { MediaProviderConfig } from '../types'

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/**
 * The single vendor-coupling point for video, mirroring `media-gen/registry.ts` for images.
 *
 * Google ships a Veo implementation of the SDK's video spec, so it is used directly. The others are
 * hand-written implementations of that same spec — which is why everything above this file is
 * vendor-agnostic and speaks only `experimental_generateVideo`.
 */
export function resolveVideoModel(
  cfg: MediaProviderConfig,
  modelId: string,
  opts: { poll?: PollOptions } = {},
): VideoModelV4 {
  switch (cfg.kind) {
    case 'google':
      // Veo's polling lives inside the SDK's own implementation, so `poll` does not apply here.
      return createGoogleGenerativeAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }).video(modelId)
    case 'ark':
      if (!cfg.baseURL) {
        throw new Error(`media-gen video provider '${cfg.id}' (ark) requires a baseURL`)
      }
      return createArkVideoModel(
        { provider: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL, poll: opts.poll },
        modelId,
      )
    case 'openai':
      // The builtin OpenAI endpoint carries an empty baseUrl so the SDK's default applies; the
      // hand-written Sora adapter has no such default, so it is spelled out here.
      return createOpenAIVideoModel(
        { provider: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL || OPENAI_DEFAULT_BASE_URL, poll: opts.poll },
        modelId,
      )
    case 'openai-compatible':
      if (!cfg.baseURL) {
        throw new Error(`media-gen video provider '${cfg.id}' (openai-compatible) requires a baseURL`)
      }
      return createOpenAIVideoModel(
        { provider: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL, poll: opts.poll },
        modelId,
      )
    case 'newapi':
      if (!cfg.baseURL) {
        throw new Error(`media-gen video provider '${cfg.id}' (newapi) requires a baseURL`)
      }
      return createNewApiVideoModel(
        { provider: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL, poll: opts.poll },
        modelId,
      )
    default:
      throw new Error(`Unknown media-gen video provider kind: ${cfg.kind}`)
  }
}
