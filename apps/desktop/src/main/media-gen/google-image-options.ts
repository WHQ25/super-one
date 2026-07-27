import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { GenerateMediaCoreParams } from './types'

/** Resolution tiers accepted by Gemini image models via `imageConfig.imageSize`. */
export const GOOGLE_IMAGE_SIZE_TIERS = ['1K', '2K', '4K', '512'] as const
export type GoogleImageSizeTier = (typeof GOOGLE_IMAGE_SIZE_TIERS)[number]

/**
 * Normalize a tool/core `size` value to a Google imageSize tier when it matches
 * 1K/2K/4K/512 (case-insensitive). Pixel sizes like "1024x1024" return undefined.
 */
export function parseGoogleImageSizeTier(size?: string): GoogleImageSizeTier | undefined {
  if (!size) return undefined
  const normalized = size.trim().toUpperCase()
  return (GOOGLE_IMAGE_SIZE_TIERS as readonly string[]).includes(normalized)
    ? (normalized as GoogleImageSizeTier)
    : undefined
}

/**
 * Map SuperOne's vendor-neutral image options onto what `@ai-sdk/google` actually
 * sends for Gemini image models.
 *
 * Background: `generateImage({ size })` is pixel-only and Google rejects it with an
 * `unsupported` warning. Gemini models instead read `providerOptions.google.imageConfig.imageSize`
 * ("1K"/"2K"/"4K"/"512"). The SDK's Gemini path also rebuilds `imageConfig` from the
 * top-level `aspectRatio` and then spreads caller `providerOptions.google` on top — so if
 * we only set `imageSize`, a separately-passed `aspectRatio` would be clobbered. Always
 * put both knobs on the same `imageConfig` object when a tier is present.
 *
 * Imagen models ignore `imageConfig` (their options schema strips it); the tier is simply
 * a no-op there.
 */
export function resolveGoogleImageGenerateOptions(params: GenerateMediaCoreParams): {
  size?: string
  aspectRatio?: string
  providerOptions?: ProviderOptions
} {
  const imageSize = parseGoogleImageSizeTier(params.size)
  if (!imageSize) {
    return {
      size: params.size,
      aspectRatio: params.aspectRatio,
      providerOptions: params.providerOptions,
    }
  }

  const existingGoogle = (params.providerOptions?.google ?? {}) as Record<string, unknown>
  const existingImageConfig =
    existingGoogle.imageConfig && typeof existingGoogle.imageConfig === 'object'
      ? (existingGoogle.imageConfig as Record<string, unknown>)
      : {}

  const imageConfig: Record<string, unknown> = {
    ...existingImageConfig,
    imageSize,
  }
  if (params.aspectRatio) {
    imageConfig.aspectRatio = params.aspectRatio
  }

  return {
    // Drop pixel `size` so the SDK does not emit an unsupported-size warning.
    size: undefined,
    aspectRatio: params.aspectRatio,
    providerOptions: {
      ...params.providerOptions,
      google: {
        ...existingGoogle,
        imageConfig,
      },
    },
  }
}
