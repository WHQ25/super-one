import { generateImage } from 'ai'
import { resolveGoogleImageGenerateOptions } from './google-image-options'
import { resolveImageModel } from './registry'
import { persistImages } from './storage'
import type { GenerateMediaCoreParams, MediaCoreResult } from './types'

export async function generateMedia(
  params: GenerateMediaCoreParams,
  opts: { outputDir: string; generationId: string },
): Promise<MediaCoreResult> {
  const model = resolveImageModel(params.provider, params.model)

  const prompt = params.referenceImages?.length
    ? {
        text: params.prompt,
        images: params.referenceImages.map((ref) => ref.data),
        ...(params.mask ? { mask: params.mask } : {}),
      }
    : params.prompt

  // Google Gemini image models take resolution tiers via imageConfig.imageSize, not pixel `size`.
  const resolved =
    params.provider.kind === 'google' ? resolveGoogleImageGenerateOptions(params) : params

  const result = await generateImage({
    model,
    prompt,
    ...(resolved.size ? { size: resolved.size as `${number}x${number}` } : {}),
    ...(resolved.aspectRatio ? { aspectRatio: resolved.aspectRatio as `${number}:${number}` } : {}),
    ...(params.n != null ? { n: params.n } : {}),
    ...(params.seed != null ? { seed: params.seed } : {}),
    ...(resolved.providerOptions ? { providerOptions: resolved.providerOptions } : {}),
    ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
  })

  const images = persistImages(result.images, opts.outputDir, opts.generationId)
  return { images, warnings: result.warnings, providerMetadata: result.providerMetadata }
}
