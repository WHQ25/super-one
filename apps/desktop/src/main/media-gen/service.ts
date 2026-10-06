import { generateImage } from 'ai'
import { resolveGoogleImageGenerateOptions } from './google-image-options'
import { referenceImageLimits } from './capabilities'
import { attachImagePreviews } from './image-preview'
import { fitReferenceImages } from './reference-fit'
import { resolveImageModel } from './registry'
import { persistImages } from './storage'
import type { GenerateMediaCoreParams, MediaCoreResult, ReferenceImage } from './types'

export async function generateMedia(
  params: GenerateMediaCoreParams,
  opts: { outputDir: string; generationId: string },
): Promise<MediaCoreResult> {
  const model = resolveImageModel(params.provider, params.model)

  const references = params.referenceImages?.length ? fitReferences(params.referenceImages, params.model) : undefined
  const prompt = references
    ? {
        text: params.prompt,
        images: references,
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

  // Persist full-res originals, then attach a cheap preview for chat thumbs + agent Read.
  const images = attachImagePreviews(persistImages(result.images, opts.outputDir, opts.generationId))
  return { images, warnings: result.warnings, providerMetadata: result.providerMetadata }
}

/** Binary references are fitted to the model's limits; base64 strings are passed through as given. */
function fitReferences(refs: ReferenceImage[], model: string): Array<Uint8Array | string> {
  const binary = refs.flatMap(ref => typeof ref.data === 'string' ? [] : [{ mediaType: ref.mediaType, data: ref.data }])
  const fitted = fitReferenceImages(binary, referenceImageLimits(model))
  let index = 0
  return refs.map(ref => typeof ref.data === 'string' ? ref.data : fitted[index++]!.data)
}
