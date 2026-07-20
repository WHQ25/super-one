import type { SharedV4Warning } from '@ai-sdk/provider'
import { RESOLUTION_TIERS } from '../ark/request'
import type { VideoModelV4CallOptions, VideoModelV4File } from '../sdk-types'

export type NewApiVideoVendor = 'doubao' | 'kling'

/**
 * Which vendor a model id belongs to, so the relay's generic `TaskSubmitReq` body can be filled in
 * with that vendor's own field names for `metadata` — New API round-trips `metadata` straight onto
 * the vendor's native request struct server-side, so getting the key names right here matters exactly
 * as much as it does for a direct (non-relayed) integration.
 */
export function vendorForModel(modelId: string): NewApiVideoVendor {
  if (modelId.startsWith('doubao-')) return 'doubao'
  if (modelId.startsWith('kling-')) return 'kling'
  throw new Error(
    `Unrecognised newapi video model '${modelId}'. Only doubao-* (Seedance, via New API's Doubao relay) and ` +
    `kling-* (via New API's Kling relay) are supported by this adapter right now.`,
  )
}

export interface NewApiTaskSubmitBody {
  model: string
  prompt: string
  image?: string
  images?: string[]
  size?: string
  duration?: number
  seconds?: string
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export interface NewApiVideoRequest {
  body: NewApiTaskSubmitBody
  warnings: SharedV4Warning[]
}

/** New API's `TaskSubmitReq.image`/`images` take a URL or a data URI, same as a direct Ark/OpenAI call. */
function toUrl(file: VideoModelV4File): string {
  if (file.type === 'url') return file.url
  const mediaType = file.mediaType || 'image/png'
  if (typeof file.data === 'string') {
    return file.data.startsWith('data:') ? file.data : `data:${mediaType};base64,${file.data}`
  }
  return `data:${mediaType};base64,${Buffer.from(file.data).toString('base64')}`
}

function firstFrame(options: VideoModelV4CallOptions): VideoModelV4File | undefined {
  if (options.image) return options.image
  return options.frameImages?.find((f) => f.frameType === 'first_frame')?.image
}

function lastFrame(options: VideoModelV4CallOptions): VideoModelV4File | undefined {
  return options.frameImages?.find((f) => f.frameType === 'last_frame')?.image
}

/**
 * `media_generate_video`'s `watermark`/`camera_fixed` tool args are Ark-specific and always ride in
 * `providerOptions.ark` regardless of whether the resolved provider is a direct Ark call or Doubao
 * reached through this relay — reading the same namespace here means the same tool call works
 * unmodified against either.
 */
function arkProviderOptions(options: VideoModelV4CallOptions): { watermark?: boolean; cameraFixed?: boolean } {
  return (options.providerOptions?.ark ?? {}) as { watermark?: boolean; cameraFixed?: boolean }
}

/**
 * Doubao (Ark/Seedance) branch of the relay. `metadata` is JSON-round-tripped straight onto New API's
 * own Doubao adapter request struct, so it takes the exact same field names as a direct Ark call
 * (`ratio`/`resolution`/`seed`/`camera_fixed`/`watermark`/`generate_audio` — see `ark-video.md`).
 * Duration rides `seconds` (a string) at the TaskSubmitReq top level — the Doubao adapter reads only
 * that field for duration, never the sibling `duration` (int) field, so sending the wrong one is a
 * silent no-op rather than an error.
 * Last-frame images and multi-image `images` have no `role` on this relay path (New API's Doubao
 * adapter dumps every image in as an unlabeled reference), so `last_frame_path` cannot be expressed —
 * it is dropped with a warning rather than silently sent as just another reference image.
 */
function buildDoubaoBody(
  options: VideoModelV4CallOptions,
  warnings: SharedV4Warning[],
): Pick<NewApiTaskSubmitBody, 'seconds' | 'images' | 'metadata'> {
  const metadata: Record<string, unknown> = {}
  if (options.aspectRatio) metadata.ratio = options.aspectRatio

  const tier = options.resolution ? RESOLUTION_TIERS[options.resolution] : undefined
  if (tier) {
    metadata.resolution = tier
  } else if (options.resolution) {
    warnings.push({
      type: 'unsupported',
      feature: 'resolution',
      details: `Doubao (via relay) sizes video by tier (480p/720p/1080p/2k/4k) and '${options.resolution}' maps to none of them.`,
    })
  }

  if (options.seed != null) metadata.seed = options.seed
  if (options.generateAudio != null) metadata.generate_audio = options.generateAudio
  const ark = arkProviderOptions(options)
  if (ark.watermark != null) metadata.watermark = ark.watermark
  if (ark.cameraFixed != null) metadata.camera_fixed = ark.cameraFixed
  if (options.fps != null) {
    warnings.push({ type: 'unsupported', feature: 'fps', details: 'Doubao has no fps parameter; frame rate is fixed by the model.' })
  }
  if (lastFrame(options)) {
    warnings.push({
      type: 'unsupported',
      feature: 'last_frame_path',
      details: "New API's generic video relay has no last-frame role for Doubao — only first_frame_path is honored.",
    })
  }

  const references = (options.inputReferences ?? []).map(toUrl)
  const seconds = options.duration != null ? String(options.duration) : undefined

  return {
    ...(seconds ? { seconds } : {}),
    ...(references.length > 0 ? { images: references } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

/**
 * Kling branch of the relay. Duration rides the top-level `duration` (int) field — the Kling adapter
 * reads only that, never `seconds`. `size` drives Kling's own aspect-ratio lookup table server-side;
 * setting `metadata.aspect_ratio` directly (round-tripped onto Kling's own request struct after that
 * derivation) overrides it when a precise ratio matters more than a rough size-based guess.
 * Kling has no seed, fps, or generate-audio parameter, and `TaskSubmitReq.images` (plural) is never
 * read by the Kling adapter — only the singular `image` (first frame) — so reference images beyond
 * the first frame are dropped with a warning rather than silently ignored. Ark-only tool args
 * (`watermark`/`camera_fixed`, which ride `providerOptions.ark`) are meaningless for Kling and warned
 * rather than silently dropped.
 */
function buildKlingBody(
  options: VideoModelV4CallOptions,
  warnings: SharedV4Warning[],
): Pick<NewApiTaskSubmitBody, 'size' | 'duration' | 'metadata'> {
  const metadata: Record<string, unknown> = {}
  if (options.aspectRatio) metadata.aspect_ratio = options.aspectRatio
  if (lastFrame(options)) metadata.image_tail = toUrl(lastFrame(options)!)

  for (const [feature, value] of [
    ['seed', options.seed],
    ['fps', options.fps],
    ['generateAudio', options.generateAudio],
  ] as const) {
    if (value != null) {
      warnings.push({ type: 'unsupported', feature, details: `Kling (via relay) has no ${feature} parameter; the value was ignored.` })
    }
  }
  if ((options.inputReferences ?? []).length > 0) {
    warnings.push({
      type: 'unsupported',
      feature: 'inputReferences',
      details: "Kling's relay request only takes a single first-frame image; reference images were dropped.",
    })
  }
  const ark = arkProviderOptions(options)
  if (ark.watermark != null || ark.cameraFixed != null) {
    warnings.push({
      type: 'unsupported',
      feature: 'watermark/camera_fixed',
      details: 'watermark and camera_fixed are Ark-specific; Kling has no equivalent parameter.',
    })
  }

  return {
    ...(options.resolution ? { size: options.resolution } : {}),
    ...(options.duration != null ? { duration: options.duration } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

/**
 * Map the AI SDK's video call options onto New API's generic multi-vendor relay shape
 * (`POST /v1/video/generations`'s `TaskSubmitReq`), verified against `QuantumNous/new-api` source —
 * `relay/channel/task/{doubao,kling}/adaptor.go` — rather than New API's own (stale) docs site, which
 * disagreed with the source on more than one field.
 */
export function buildNewApiVideoRequest(
  vendor: NewApiVideoVendor,
  modelId: string,
  options: VideoModelV4CallOptions,
): NewApiVideoRequest {
  const warnings: SharedV4Warning[] = []

  if (options.n > 1) {
    warnings.push({
      type: 'unsupported',
      feature: 'n',
      details: 'This relay returns one video per task. Generate additional videos with separate calls.',
    })
  }

  const frame = firstFrame(options)
  const vendorFields = vendor === 'doubao' ? buildDoubaoBody(options, warnings) : buildKlingBody(options, warnings)

  return {
    body: {
      model: modelId,
      prompt: options.prompt ?? '',
      ...(frame ? { image: toUrl(frame) } : {}),
      ...vendorFields,
    },
    warnings,
  }
}
