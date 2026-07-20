import type { DataContent } from 'ai'
import type { GenerateVideoCoreParams } from './service'
import type { VideoModelV4CallOptions, VideoModelV4File } from './sdk-types'

const MAGIC_BYTES: Array<{ mediaType: string; test: (b: Uint8Array) => boolean }> = [
  { mediaType: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mediaType: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mediaType: 'image/gif', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  {
    mediaType: 'image/webp',
    test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45,
  },
]

function detectMediaType(bytes: Uint8Array): string {
  return MAGIC_BYTES.find((candidate) => candidate.test(bytes))?.mediaType ?? 'image/png'
}

function splitDataUrl(value: string): { mediaType: string; base64: string } {
  const comma = value.indexOf(',')
  const header = value.slice(5, comma)
  return { mediaType: header.split(';')[0] || 'image/png', base64: value.slice(comma + 1) }
}

/**
 * Normalise an image the way `experimental_generateVideo` used to before this layer stopped going
 * through it: an http(s) string stays a URL, a `data:` URI and a bare base64 string become bytes,
 * and anything binary is passed through with its type sniffed from the magic bytes.
 *
 * Getting this wrong fails silently rather than loudly — a mis-shaped file reaches the provider as a
 * well-formed request with a useless image in it — which is why each branch is covered by a test.
 */
export function normalizeImageData(content: DataContent): VideoModelV4File {
  if (typeof content === 'string') {
    if (content.startsWith('http://') || content.startsWith('https://')) {
      return { type: 'url', url: content }
    }
    if (content.startsWith('data:')) {
      const { mediaType, base64 } = splitDataUrl(content)
      return { type: 'file', mediaType, data: Buffer.from(base64, 'base64') }
    }
    const bytes = Buffer.from(content, 'base64')
    return { type: 'file', mediaType: detectMediaType(bytes), data: bytes }
  }
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content as ArrayBuffer)
  return { type: 'file', mediaType: detectMediaType(bytes), data: bytes }
}

/**
 * Build the driver call options, replacing what `experimental_generateVideo` did on the way in.
 *
 * Two precedence rules come from the SDK and are preserved deliberately: a `first_frame` frame image
 * wins over a bare `image`, and `inputReferences` are dropped entirely when frame images are present
 * (the two cannot be combined). Both are silent in the SDK; here they surface as warnings.
 */
export function buildVideoCallOptions(
  params: GenerateVideoCoreParams,
): { options: VideoModelV4CallOptions; warnings: Array<{ type: 'other'; message: string }> } {
  const warnings: Array<{ type: 'other'; message: string }> = []

  const frameImages = params.frameImages?.map((frame) => ({
    image: normalizeImageData(frame.image),
    frameType: frame.frameType,
  }))
  const references = params.inputReferences?.map(normalizeImageData)

  const hasFrames = frameImages != null && frameImages.length > 0
  if (hasFrames && references != null && references.length > 0) {
    warnings.push({
      type: 'other',
      message: 'inputReferences were ignored because frameImages were provided; the two cannot be combined.',
    })
  }

  const firstFrame = frameImages?.find((frame) => frame.frameType === 'first_frame')?.image

  return {
    options: {
      prompt: params.prompt,
      n: 1,
      ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.duration != null ? { duration: params.duration } : {}),
      ...(params.fps != null ? { fps: params.fps } : {}),
      ...(params.seed != null ? { seed: params.seed } : {}),
      ...(params.generateAudio != null ? { generateAudio: params.generateAudio } : {}),
      ...(firstFrame ? { image: firstFrame } : {}),
      ...(hasFrames ? { frameImages } : {}),
      ...(!hasFrames && references ? { inputReferences: references } : {}),
      providerOptions: params.providerOptions ?? {},
      headers: {},
      ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
    } as VideoModelV4CallOptions,
    warnings,
  }
}
