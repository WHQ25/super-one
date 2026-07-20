import type { SharedV4Warning } from '@ai-sdk/provider'
import type { VideoModelV4CallOptions, VideoModelV4File } from '../sdk-types'

/**
 * Ark accepts at most 9 images across every role. Frame images are load-bearing (they define the
 * motion endpoints), so they claim the budget first and plain references are dropped instead.
 */
const MAX_IMAGES = 9

/** Ark sizes video by tier name, while the SDK speaks `{width}x{height}`. Shared with the newapi/doubao relay adapter, which targets the same real Ark API. */
export const RESOLUTION_TIERS: Record<string, string> = {
  '854x480': '480p',
  '640x480': '480p',
  '1280x720': '720p',
  '720x1280': '720p',
  '1920x1080': '1080p',
  '1080x1920': '1080p',
  '2560x1440': '2k',
  '3840x2160': '4k',
}

export interface ArkVideoContentText {
  type: 'text'
  text: string
}

export interface ArkVideoContentImage {
  type: 'image_url'
  image_url: { url: string }
  role: 'first_frame' | 'last_frame' | 'reference_image'
}

export interface ArkVideoContentVideo {
  type: 'video_url'
  video_url: { url: string }
}

export interface ArkVideoContentAudio {
  type: 'audio_url'
  audio_url: { url: string }
}

export type ArkVideoContent =
  | ArkVideoContentText
  | ArkVideoContentImage
  | ArkVideoContentVideo
  | ArkVideoContentAudio

export interface ArkVideoRequestBody {
  model: string
  content: ArkVideoContent[]
  ratio?: string
  resolution?: string
  duration?: number
  seed?: number
  camera_fixed?: boolean
  watermark?: boolean
  generate_audio?: boolean
  [key: string]: unknown
}

export interface ArkVideoRequest {
  body: ArkVideoRequestBody
  warnings: SharedV4Warning[]
}

interface ArkProviderOptions {
  resolution?: string
  watermark?: boolean
  cameraFixed?: boolean
  referenceVideos?: string[]
  referenceAudios?: string[]
  body?: Record<string, unknown>
}

/** Ark's media fields take a URL or a data URI. Bare base64 is rejected — the prefix is mandatory. */
function toArkUrl(file: VideoModelV4File): string {
  if (file.type === 'url') return file.url
  const mediaType = file.mediaType || 'image/png'
  if (typeof file.data === 'string') {
    return file.data.startsWith('data:') ? file.data : `data:${mediaType};base64,${file.data}`
  }
  return `data:${mediaType};base64,${Buffer.from(file.data).toString('base64')}`
}

function arkOptions(options: VideoModelV4CallOptions): ArkProviderOptions {
  return (options.providerOptions?.ark ?? {}) as ArkProviderOptions
}

/**
 * Ark's own docs mark this the "new method": settings ride as top-level JSON fields with strict
 * validation, superseding the older `--key value` prompt-text flags (still accepted, but silently
 * defaulted on a typo instead of erroring — the wrong choice when the field names are this easy to
 * get right). Ark has no fps control at all; it derives frame rate from the model, so a caller-supplied
 * fps is reported as unsupported rather than smuggled in as a parameter that doesn't exist.
 */
function buildSettingsFields(
  options: VideoModelV4CallOptions,
  ark: ArkProviderOptions,
  warnings: SharedV4Warning[],
): Pick<ArkVideoRequestBody, 'ratio' | 'resolution' | 'duration' | 'seed' | 'camera_fixed' | 'watermark'> {
  const fields: ReturnType<typeof buildSettingsFields> = {}

  if (options.aspectRatio) fields.ratio = options.aspectRatio

  const tier = ark.resolution ?? (options.resolution ? RESOLUTION_TIERS[options.resolution] : undefined)
  if (tier) {
    fields.resolution = tier
  } else if (options.resolution) {
    warnings.push({
      type: 'unsupported',
      feature: 'resolution',
      details: `Ark sizes video by tier (480p/720p/1080p/2k/4k) and '${options.resolution}' maps to none of them. Set providerOptions.ark.resolution to pick a tier explicitly.`,
    })
  }

  if (options.duration != null) fields.duration = options.duration
  if (options.fps != null) {
    warnings.push({
      type: 'unsupported',
      feature: 'fps',
      details: 'Ark has no fps parameter; frame rate is fixed by the model.',
    })
  }
  if (options.seed != null) fields.seed = options.seed
  if (ark.watermark != null) fields.watermark = ark.watermark
  if (ark.cameraFixed != null) fields.camera_fixed = ark.cameraFixed

  return fields
}

function buildImageParts(options: VideoModelV4CallOptions, warnings: SharedV4Warning[]): ArkVideoContentImage[] {
  const frames: ArkVideoContentImage[] = (options.frameImages ?? []).map((frame) => ({
    type: 'image_url',
    image_url: { url: toArkUrl(frame.image) },
    role: frame.frameType,
  }))
  const references: ArkVideoContentImage[] = (options.inputReferences ?? []).map((file) => ({
    type: 'image_url',
    image_url: { url: toArkUrl(file) },
    role: 'reference_image',
  }))
  // `image` is the SDK's single-image i2v shortcut; ark expresses it as the first frame.
  if (options.image) {
    frames.unshift({ type: 'image_url', image_url: { url: toArkUrl(options.image) }, role: 'first_frame' })
  }

  const total = frames.length + references.length
  if (total <= MAX_IMAGES) return [...frames, ...references]

  const kept = references.slice(0, Math.max(0, MAX_IMAGES - frames.length))
  warnings.push({
    type: 'unsupported',
    feature: 'inputReferences',
    details: `Ark accepts at most ${MAX_IMAGES} images across all roles; the last ${total - MAX_IMAGES} reference image(s) were dropped.`,
  })
  return [...frames, ...kept]
}

/**
 * Map the AI SDK's video call options onto Ark's `/contents/generations/tasks` JSON body.
 *
 * Ark sizes video by tier name where the SDK speaks pixels, so resolution needs translation.
 * Everything else (ratio, duration, seed, camera_fixed, watermark) maps onto a same-named top-level
 * field, confirmed against the "new method" request example in Volcengine/BytePlus's own API
 * reference (docs.byteplus.com/api/docs/ModelArk/1520757 — "Create a video generation task").
 */
export function buildArkVideoRequest(modelId: string, options: VideoModelV4CallOptions): ArkVideoRequest {
  const warnings: SharedV4Warning[] = []
  const ark = arkOptions(options)

  if (options.n > 1) {
    warnings.push({
      type: 'unsupported',
      feature: 'n',
      details: 'Ark returns exactly one video per task. Generate additional videos with separate calls.',
    })
  }

  const content: ArkVideoContent[] = [
    { type: 'text', text: options.prompt ?? '' },
    ...buildImageParts(options, warnings),
    ...(ark.referenceVideos ?? []).map((url): ArkVideoContentVideo => ({ type: 'video_url', video_url: { url } })),
    ...(ark.referenceAudios ?? []).map((url): ArkVideoContentAudio => ({ type: 'audio_url', audio_url: { url } })),
  ]

  return {
    body: {
      model: modelId,
      content,
      ...buildSettingsFields(options, ark, warnings),
      ...(options.generateAudio != null ? { generate_audio: options.generateAudio } : {}),
      ...(ark.body ?? {}),
    },
    warnings,
  }
}
