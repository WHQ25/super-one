import type { SharedV4Warning } from '@ai-sdk/provider'
import type { VideoModelV4CallOptions, VideoModelV4File } from '../sdk-types'

/** Veo sizes video by tier name, while the SDK speaks `{width}x{height}`. */
const RESOLUTION_TIERS: Record<string, string> = {
  '1280x720': '720p',
  '1920x1080': '1080p',
  '3840x2160': '4k',
}

/** Provider options consumed by the SDK's own poller; meaningless here and never forwarded. */
const SDK_ONLY_OPTIONS = new Set(['pollIntervalMs', 'pollTimeoutMs', 'referenceImages', 'personGeneration', 'negativePrompt'])

interface GoogleImage {
  gcsUri?: string
  mimeType?: string
  inlineData?: { mimeType: string; data: string }
}

export interface VeoVideoRequest {
  body: { instances: Array<Record<string, unknown>>; parameters: Record<string, unknown> }
  warnings: SharedV4Warning[]
}

/**
 * Veo takes images inline as base64 or by GCS URI — a plain https URL is not fetchable by the API,
 * so one is dropped with a warning rather than sent and silently ignored.
 */
function toGoogleImage(file: VideoModelV4File, warnings: SharedV4Warning[]): GoogleImage | undefined {
  if (file.type === 'url') {
    if (file.url.startsWith('gs://')) return { gcsUri: file.url, mimeType: 'image/png' }
    warnings.push({
      type: 'unsupported',
      feature: 'URL-based image input',
      details: 'Veo requires base64-encoded images or gs:// URIs. The URL was ignored.',
    })
    return undefined
  }
  const data = typeof file.data === 'string' ? file.data : Buffer.from(file.data).toString('base64')
  return { inlineData: { mimeType: file.mediaType || 'image/png', data } }
}

function firstFrame(options: VideoModelV4CallOptions): VideoModelV4File | undefined {
  if (options.image) return options.image
  return options.frameImages?.find((f) => f.frameType === 'first_frame')?.image
}

function lastFrame(options: VideoModelV4CallOptions): VideoModelV4File | undefined {
  return options.frameImages?.find((f) => f.frameType === 'last_frame')?.image
}

/**
 * Map the AI SDK's video call options onto Veo's `predictLongRunning` body.
 *
 * Kept faithful to `@ai-sdk/google`'s own `GoogleVideoModel.doGenerate` request construction — this
 * adapter exists only to split that call's submit/poll/download into separately callable steps, so
 * any divergence in the request itself would be a regression, not an improvement.
 */
export function buildVeoVideoRequest(options: VideoModelV4CallOptions): VeoVideoRequest {
  const warnings: SharedV4Warning[] = []
  const instance: Record<string, unknown> = {}

  if (options.prompt != null) instance.prompt = options.prompt

  const start = firstFrame(options)
  if (start) {
    const image = toGoogleImage(start, warnings)
    if (image) instance.image = image
  }

  const last = lastFrame(options)
  if (last) {
    const image = toGoogleImage(last, warnings)
    if (image) instance.lastFrame = image
  }

  const references = options.inputReferences ?? []
  if (references.length > 0) {
    instance.referenceImages = references.flatMap((reference) => {
      const image = toGoogleImage(reference, warnings)
      return image ? [{ image, referenceType: 'asset' }] : []
    })
  }

  const parameters: Record<string, unknown> = { sampleCount: options.n }
  if (options.aspectRatio) parameters.aspectRatio = options.aspectRatio
  if (options.resolution) parameters.resolution = RESOLUTION_TIERS[options.resolution] ?? options.resolution
  if (options.duration != null) parameters.durationSeconds = options.duration
  if (options.seed != null) parameters.seed = options.seed

  const google = (options.providerOptions?.google ?? {}) as Record<string, unknown>
  for (const [key, value] of Object.entries(google)) {
    if (value == null) continue
    if (SDK_ONLY_OPTIONS.has(key)) continue
    parameters[key] = value
  }
  if (google.personGeneration != null) parameters.personGeneration = google.personGeneration
  if (google.negativePrompt != null) parameters.negativePrompt = google.negativePrompt

  return { body: { instances: [instance], parameters }, warnings }
}
