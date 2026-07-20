import type { ImageModelV3, ImageModelV3CallOptions } from '@ai-sdk/provider'
import { collectHeaders, definedHeaders } from '../http'
import { buildArkImageRequest } from './request'

interface ArkImageResponse {
  data?: { b64_json?: string }[]
  error?: { message?: string; code?: string }
}

export interface ArkImageModelConfig {
  provider: string
  baseURL: string
  apiKey: string
  fetch?: typeof globalThis.fetch
}

/**
 * Native Volcengine Ark image model.
 *
 * `maxImagesPerCall: 1` is load-bearing: generateImage() fans `n` out into that many parallel
 * doGenerate calls, so this adapter never has to send Ark an `n` it may not support.
 */
export function createArkImageModel(cfg: ArkImageModelConfig, modelId: string): ImageModelV3 {
  const url = `${cfg.baseURL.replace(/\/+$/, '')}/images/generations`
  const doFetch = cfg.fetch ?? globalThis.fetch

  return {
    specificationVersion: 'v3',
    provider: cfg.provider,
    modelId,
    maxImagesPerCall: 1,
    async doGenerate(options: ImageModelV3CallOptions) {
      const { body, warnings } = buildArkImageRequest(modelId, options)

      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
          ...definedHeaders(options.headers),
        },
        body: JSON.stringify(body),
        ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      })

      const raw = await response.text()
      let parsed: ArkImageResponse
      try {
        parsed = JSON.parse(raw) as ArkImageResponse
      } catch {
        throw new Error(`Ark returned a non-JSON response (${response.status}): ${raw.slice(0, 300)}`)
      }

      if (!response.ok) {
        throw new Error(`Ark image generation failed (${response.status}): ${parsed.error?.message ?? raw.slice(0, 300)}`)
      }

      const images = (parsed.data ?? []).map((entry) => entry.b64_json).filter((b64): b64 is string => !!b64)
      if (images.length === 0) {
        throw new Error('Ark returned no image data. Confirm the model serves image generation.')
      }

      return {
        images,
        warnings,
        response: {
          timestamp: new Date(),
          modelId,
          headers: collectHeaders(response.headers),
        },
      }
    },
  }
}
