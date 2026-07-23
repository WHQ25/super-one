import type { ImageModelV3CallOptions, ImageModelV3File, SharedV3Warning } from '@ai-sdk/provider'

/** Seedream rejects anything under ~3.7MP, so the SDK-wide "no size" default cannot be used here. */
const DEFAULT_SIZE = '2K'
const MAX_REFERENCE_IMAGES = 14

export interface ArkImageRequestBody {
  model: string
  prompt: string
  response_format: 'b64_json'
  size: string
  watermark: boolean
  image?: string | string[]
  seed?: number
}

export interface ArkImageRequest {
  body: ArkImageRequestBody
  warnings: SharedV3Warning[]
}

/** Ark's `image` takes a URL or a data URI. Bare base64 is rejected — the `data:<mime>;base64,` prefix is mandatory. */
function toArkImage(file: ImageModelV3File): string {
  if (file.type === 'url') return file.url
  const mediaType = file.mediaType || 'image/png'
  if (typeof file.data === 'string') {
    return file.data.startsWith('data:') ? file.data : `data:${mediaType};base64,${file.data}`
  }
  return `data:${mediaType};base64,${Buffer.from(file.data).toString('base64')}`
}

/**
 * Map the AI SDK's call options onto Ark's `/images/generations` JSON body.
 *
 * Ark serves image-to-image from this one endpoint via the `image` field — it has no
 * `/images/edits`, which is why the generic openai-compatible image model 404s against it.
 */
export function buildArkImageRequest(modelId: string, options: ImageModelV3CallOptions): ArkImageRequest {
  const warnings: SharedV3Warning[] = []

  if (options.mask) {
    warnings.push({
      type: 'unsupported',
      feature: 'mask',
      details: 'Ark has no inpainting endpoint. The mask was ignored — describe the edit in the prompt instead.',
    })
  }
  if (options.aspectRatio) {
    warnings.push({
      type: 'unsupported',
      feature: 'aspectRatio',
      details: 'Ark sizes images via `size` (e.g. "2K", "4K", "2048x2048"). The aspect ratio was ignored.',
    })
  }

  const files = options.files ?? []
  if (files.length > MAX_REFERENCE_IMAGES) {
    warnings.push({
      type: 'unsupported',
      feature: 'files',
      details: `Ark accepts at most ${MAX_REFERENCE_IMAGES} reference images; the last ${files.length - MAX_REFERENCE_IMAGES} were dropped.`,
    })
  }
  const images = files.slice(0, MAX_REFERENCE_IMAGES).map(toArkImage)

  return {
    body: {
      model: modelId,
      prompt: options.prompt ?? '',
      response_format: 'b64_json',
      size: options.size ?? DEFAULT_SIZE,
      watermark: false,
      ...(images.length === 1 ? { image: images[0] } : {}),
      ...(images.length > 1 ? { image: images } : {}),
      ...(options.seed != null ? { seed: options.seed } : {}),
    },
    warnings,
  }
}
