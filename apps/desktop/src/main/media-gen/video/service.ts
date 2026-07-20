import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { DataContent } from 'ai'
import { persistVideos } from '../storage'
import type { MediaProviderConfig, SavedImage } from '../types'
import type { VideoTask } from './ark/response'
import { buildVideoCallOptions } from './call-options'
import { resolveVideoDriver } from './registry'
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
}

/**
 * Submit a video job and return its provider-side handle.
 *
 * Nothing is kept running afterwards: the handle is the entire continuation, and `fetchVideoTask`
 * picks the job back up from it whenever the caller next asks. Deliberately the mirror image of
 * `media-gen/service.ts`, except that images settle within the one call and videos do not.
 */
export async function submitVideoTask(
  params: GenerateVideoCoreParams,
): Promise<{ taskId: string; warnings: unknown[] }> {
  const driver = resolveVideoDriver(params.provider, params.model)
  const { options, warnings: inputWarnings } = buildVideoCallOptions(params)
  const { taskId, warnings } = await driver.submit(options)
  return { taskId, warnings: [...inputWarnings, ...warnings] }
}

/** Ask the provider once what state a previously submitted job is in. */
export async function fetchVideoTask(
  provider: MediaProviderConfig,
  model: string,
  taskId: string,
): Promise<VideoTask> {
  return resolveVideoDriver(provider, model).fetch(taskId)
}

/** Download a succeeded job's video and write it to disk. */
export async function persistVideoTask(
  provider: MediaProviderConfig,
  model: string,
  task: VideoTask,
  opts: { outputDir: string; generationId: string },
): Promise<SavedImage[]> {
  const { data, mediaType } = await resolveVideoDriver(provider, model).download(task)
  return persistVideos([{ uint8Array: data, mediaType }], opts.outputDir, opts.generationId)
}
