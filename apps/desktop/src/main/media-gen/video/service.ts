import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { experimental_generateVideo as generateVideo, type DataContent } from 'ai'
import { persistVideos } from '../storage'
import type { MediaCoreResult, MediaProviderConfig } from '../types'
import type { PollOptions } from './poll'
import { resolveVideoModel } from './registry'
import type { VideoModelV4FrameType } from './sdk-types'

/** A frame image as the SDK's user-facing surface takes it: raw bytes plus the role it plays. */
export interface VideoFrameInput {
  image: DataContent
  frameType: VideoModelV4FrameType
}

export interface GenerateVideoCoreParams {
  provider: MediaProviderConfig
  model: string
  prompt: string
  frameImages?: VideoFrameInput[]
  inputReferences?: DataContent[]
  aspectRatio?: string
  resolution?: string
  duration?: number
  fps?: number
  seed?: number
  generateAudio?: boolean
  providerOptions?: ProviderOptions
  abortSignal?: AbortSignal
  /** Overrides the hand-written adapters' polling cadence. Mainly a test seam. */
  poll?: PollOptions
}

/**
 * Generate a video and write it to disk.
 *
 * Deliberately the mirror image of `media-gen/service.ts`: resolve a model, hand it to the SDK's
 * one generic entry point, persist what comes back. Everything vendor-specific — async task
 * submission, polling, expiring URLs — lives inside the model returned by `resolveVideoModel`.
 */
export async function generateVideoMedia(
  params: GenerateVideoCoreParams,
  opts: { outputDir: string; generationId: string },
): Promise<MediaCoreResult> {
  const model = resolveVideoModel(params.provider, params.model, { poll: params.poll })

  const result = await generateVideo({
    model,
    prompt: params.prompt,
    ...(params.frameImages ? { frameImages: params.frameImages } : {}),
    ...(params.inputReferences ? { inputReferences: params.inputReferences } : {}),
    ...(params.aspectRatio ? { aspectRatio: params.aspectRatio as `${number}:${number}` } : {}),
    ...(params.resolution ? { resolution: params.resolution as `${number}x${number}` } : {}),
    ...(params.duration != null ? { duration: params.duration } : {}),
    ...(params.fps != null ? { fps: params.fps } : {}),
    ...(params.seed != null ? { seed: params.seed } : {}),
    ...(params.generateAudio != null ? { generateAudio: params.generateAudio } : {}),
    ...(params.providerOptions ? { providerOptions: params.providerOptions } : {}),
    ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
  })

  const videos = persistVideos(result.videos, opts.outputDir, opts.generationId)
  return { images: videos, warnings: result.warnings, providerMetadata: result.providerMetadata }
}
