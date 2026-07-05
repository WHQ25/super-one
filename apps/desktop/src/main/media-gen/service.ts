import { generateImage } from 'ai'
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

  const result = await generateImage({
    model,
    prompt,
    ...(params.size ? { size: params.size as `${number}x${number}` } : {}),
    ...(params.aspectRatio ? { aspectRatio: params.aspectRatio as `${number}:${number}` } : {}),
    ...(params.n != null ? { n: params.n } : {}),
    ...(params.seed != null ? { seed: params.seed } : {}),
    ...(params.providerOptions ? { providerOptions: params.providerOptions } : {}),
    ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
  })

  const images = persistImages(result.images, opts.outputDir, opts.generationId)
  return { images, warnings: result.warnings, providerMetadata: result.providerMetadata }
}
