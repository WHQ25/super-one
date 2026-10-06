import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { DataContent } from 'ai'
import { persistVideos } from '../storage'
import type { MediaProviderConfig, SavedImage } from '../types'
import type { VideoTask } from './ark/response'
import { referenceImageLimits } from '../capabilities'
import { fitReferenceImages } from '../reference-fit'
import { buildVideoCallOptions, detectMediaType } from './call-options'
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
 * `watermark`, `cameraFixed` and reference video/audio are Ark-wire options (also read by the
 * New API Doubao relay); they ride `providerOptions.ark`. Returns undefined when none is set.
 */
export function arkVideoProviderOptions(options: {
  watermark?: boolean; cameraFixed?: boolean; referenceVideos?: string[]; referenceAudios?: string[]
}): ProviderOptions | undefined {
  const ark = Object.fromEntries(Object.entries(options).filter(([, value]) => value != null))
  return Object.keys(ark).length > 0 ? { ark } : undefined
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
  const { options, warnings: inputWarnings } = buildVideoCallOptions(fitVideoImages(params))
  const { taskId, warnings } = await driver.submit(options)
  return { taskId, warnings: [...inputWarnings, ...warnings] }
}

/** Fits binary frame and reference images to the model's input limits; URLs and base64 strings pass through. */
function fitVideoImages(params: GenerateVideoCoreParams): GenerateVideoCoreParams {
  const contents = [...(params.frameImages ?? []).map(frame => frame.image), ...(params.inputReferences ?? [])]
  const binary = contents.flatMap(content => typeof content === 'string' ? [] : [toBytes(content)])
  if (!binary.length) return params
  const fitted = fitReferenceImages(binary.map(data => ({ mediaType: detectMediaType(data), data })), referenceImageLimits(params.model))
  let index = 0
  const fit = (content: DataContent): DataContent => typeof content === 'string' ? content : fitted[index++]!.data
  return {
    ...params,
    ...(params.frameImages ? { frameImages: params.frameImages.map(frame => ({ ...frame, image: fit(frame.image) })) } : {}),
    ...(params.inputReferences ? { inputReferences: params.inputReferences.map(fit) } : {}),
  }
}

function toBytes(content: Exclude<DataContent, string>): Uint8Array {
  return content instanceof Uint8Array ? content : new Uint8Array(content)
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
