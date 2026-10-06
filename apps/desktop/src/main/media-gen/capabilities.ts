import type { MediaComposerKind, MediaComposerModel, MediaImageCapabilities, MediaVideoCapabilities } from '@superone/shared/media-composer'
import type { ResolvedService } from '@superone/shared/platform-registry'
import { mediaKindFor, videoKindFor } from './providers'
import type { MediaProviderKind } from './types'
import { vendorForModel } from './video/newapi/request'

/**
 * The controls each adapter actually reads, so the composers only offer values a request can use.
 * Keep in step with the adapters (`video/{ark,google,openai,newapi}`, `google-image-options.ts`,
 * `ark/request.ts`); a value missing here is dropped by its adapter with a warning.
 */
const COMMON_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const NO_VIDEO_EXTRAS = { seed: false, generateAudio: false, watermark: false, cameraFixed: false }
// Ark maps pixel sizes onto 480p/720p/1080p and reads the ratio separately.
const ARK_RESOLUTIONS = ['854x480', '1280x720', '1920x1080']
const ARK_DURATIONS = Array.from({ length: 14 }, (_, index) => index + 2)

/** Native audio exists only on the Seedance 2.0 series and Seedance 1.5 Pro. */
const seedanceAudio = (model: string) => /seedance-(2|1-5-pro)/i.test(model)

export function videoCapabilities(kind: MediaProviderKind, model: string): MediaVideoCapabilities {
  switch (kind) {
    case 'ark':
      return { aspectRatios: [...COMMON_RATIOS, '21:9'], resolutions: ARK_RESOLUTIONS, durations: ARK_DURATIONS,
        seed: true, generateAudio: seedanceAudio(model), watermark: true, cameraFixed: true, firstFrame: true, lastFrame: true, references: true }
    case 'google':
      return { aspectRatios: ['16:9', '9:16'], resolutions: ['1280x720', '1920x1080'], durations: [4, 6, 8],
        ...NO_VIDEO_EXTRAS, seed: true, firstFrame: true, lastFrame: true, references: true }
    case 'openai':
    case 'openai-compatible':
      // Sora's size carries the orientation; it reads no ratio, frames or references.
      return { aspectRatios: [], resolutions: ['1280x720', '720x1280', '1792x1024', '1024x1792'], durations: [4, 8, 12],
        ...NO_VIDEO_EXTRAS, firstFrame: false, lastFrame: false, references: false }
    case 'newapi': {
      const vendor = (() => { try { return vendorForModel(model) } catch { return null } })()
      if (vendor === 'kling') {
        return { aspectRatios: ['16:9', '9:16', '1:1'], resolutions: ['1280x720', '1920x1080'], durations: [5, 10],
          ...NO_VIDEO_EXTRAS, firstFrame: true, lastFrame: true, references: false }
      }
      if (vendor === 'doubao') {
        return { aspectRatios: [...COMMON_RATIOS, '21:9'], resolutions: ARK_RESOLUTIONS, durations: ARK_DURATIONS,
          seed: true, generateAudio: seedanceAudio(model), watermark: true, cameraFixed: true, firstFrame: true, lastFrame: false, references: true }
      }
      return { aspectRatios: [], resolutions: [], durations: [], ...NO_VIDEO_EXTRAS, firstFrame: false, lastFrame: false, references: false }
    }
  }
}

export function imageCapabilities(kind: MediaProviderKind, model: string): MediaImageCapabilities {
  switch (kind) {
    case 'openai':
    case 'openai-compatible':
      // Image size carries the framing; these models read no aspect ratio.
      if (/^dall-e-3/.test(model)) return { aspectRatios: [], sizes: ['1024x1024', '1792x1024', '1024x1792'] }
      if (/^dall-e-2/.test(model)) return { aspectRatios: [], sizes: ['256x256', '512x512', '1024x1024'] }
      return { aspectRatios: [], sizes: ['1024x1024', '1536x1024', '1024x1536'] }
    case 'ark':
      // Seedream rejects images under ~3.7 MP, so only its tiers are offered.
      return { aspectRatios: [], sizes: ['2K', '4K'] }
    case 'google':
      return { aspectRatios: COMMON_RATIOS, sizes: /gemini.*image/i.test(model) ? ['1K', '2K', '4K'] : [] }
    case 'newapi':
      return { aspectRatios: COMMON_RATIOS, sizes: [] }
  }
}

/** Capabilities of the endpoint resolved for one model; an endpoint no adapter serves gets none. */
export function modelCapabilities(kind: MediaComposerKind, resolved: ResolvedService, model: string): Pick<MediaComposerModel, 'image' | 'video'> {
  try {
    return kind === 'image' ? { image: imageCapabilities(mediaKindFor(resolved), model) } : { video: videoCapabilities(videoKindFor(resolved), model) }
  } catch {
    // Generation fails with the adapter's own error; the composers offer generic controls meanwhile.
    return {}
  }
}
