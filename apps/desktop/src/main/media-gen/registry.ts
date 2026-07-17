import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ImageModel } from 'ai'
import { createArkImageModel } from './ark/image-model'
import type { MediaProviderConfig } from './types'

export function resolveImageModel(cfg: MediaProviderConfig, modelId: string): ImageModel {
  switch (cfg.kind) {
    case 'openai':
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }).image(modelId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }).image(modelId)
    case 'openai-compatible':
      if (!cfg.baseURL) {
        throw new Error(`media-gen provider '${cfg.id}' (openai-compatible) requires a baseURL`)
      }
      return createOpenAICompatible({ name: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL }).imageModel(modelId)
    case 'ark':
      if (!cfg.baseURL) {
        throw new Error(`media-gen provider '${cfg.id}' (ark) requires a baseURL`)
      }
      return createArkImageModel({ provider: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL }, modelId)
    default:
      throw new Error(`Unknown media-gen provider kind: ${cfg.kind}`)
  }
}
