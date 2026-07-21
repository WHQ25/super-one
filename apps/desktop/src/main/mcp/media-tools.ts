import { readFileSync } from 'fs'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  VIDEO_GEN_PARAMS_FIELD,
  type VideoGenConfirmPayload,
  type VideoGenParams,
  type VideoGenProviderOption,
  type VideoGenReferenceImageRef,
} from '@superone/shared/agent-types'
import log from '../logger'
import { trace } from '../agent/event-trace'
import { detectImageMime } from '../image-cache'
import { generateAndRecord } from '../media-gen/history'
import {
  resolveDefaultModel,
  resolveDefaultProviderId,
  resolveDefaultVideoModel,
  resolveDefaultVideoProviderId,
} from '../media-gen/providers'
import { getMediaProviderStatuses } from '../media-gen/settings-service'
import { readVideoGeneration, submitVideoGeneration } from '../media-gen/video/history'
import type { VideoFrameInput } from '../media-gen/video/service'
import mediaOverviewMd from './guides/media/overview.md?raw'
import mediaArkImageMd from './guides/media/ark-image.md?raw'
import mediaArkVideoMd from './guides/media/ark-video.md?raw'
import mediaOpenaiImageMd from './guides/media/openai-image.md?raw'
import mediaOpenaiVideoMd from './guides/media/openai-video.md?raw'
import mediaGoogleImageMd from './guides/media/google-image.md?raw'
import mediaGoogleVideoMd from './guides/media/google-video.md?raw'
import mediaNewapiVideoMd from './guides/media/newapi-video.md?raw'
import {
  GENERATE_IMAGE_DESCRIPTION,
  GENERATE_VIDEO_DESCRIPTION,
  LIST_MEDIA_PROVIDERS_DESCRIPTION,
  MEDIA_GUIDE_TOPICS,
  MEDIA_GUIDE_TOPIC_DESCRIPTION,
  READ_MEDIA_GUIDE_DESCRIPTION,
  VIDEO_STATUS_DESCRIPTION,
} from './superone-mcp-builtin-defs'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

const MEDIA_GUIDES: Record<string, string> = {
  overview: mediaOverviewMd,
  'ark-image': mediaArkImageMd,
  'ark-video': mediaArkVideoMd,
  'openai-image': mediaOpenaiImageMd,
  'openai-video': mediaOpenaiVideoMd,
  'google-image': mediaGoogleImageMd,
  'google-video': mediaGoogleVideoMd,
  'newapi-video': mediaNewapiVideoMd,
}

export function readMediaGuideHandler(args: { topic: string }) {
  const text = MEDIA_GUIDES[args.topic]
  if (!text) {
    throw new Error(`Unknown media guide topic: ${args.topic}`)
  }
  return { content: [{ type: 'text' as const, text }] }
}

export interface GenerateImageArgs {
  prompt: string
  provider?: string
  model?: string
  aspect_ratio?: string
  size?: string
  reference_image_paths?: string[]
}

function sizingForKind(kind: string): 'size' | 'aspectRatio' {
  return kind === 'google' ? 'aspectRatio' : 'size'
}

/** Ark's valid sizes differ per model, so state the constraint rather than enumerate a list that would lie. */
function sizeNoteForKind(kind: string): string | undefined {
  return kind === 'ark'
    ? 'Accepts "2K" / "4K" or an explicit "WxH". Seedream models reject anything under ~3.7MP, so "1024x1024" fails — omit `size` to use the 2K default.'
    : undefined
}

export interface ListMediaProvidersArgs {
  category?: string
}

export async function listMediaProvidersHandler(args: ListMediaProvidersArgs = {}) {
  const statuses = await getMediaProviderStatuses()
  const providers = statuses
    .filter((status) => status.hasKey || status.hasEnvKey)
    .filter((status) => !args.category || status.categories.includes(args.category))
    .map((status) => ({
      id: status.id,
      label: status.label,
      provider: status.providerLabel,
      kind: status.kind,
      categories: status.categories,
      sizing: sizingForKind(status.kind),
      ...(sizeNoteForKind(status.kind) ? { sizeNote: sizeNoteForKind(status.kind) } : {}),
      supportsMask: status.kind === 'openai',
      defaultModel: status.defaultModel,
      models: status.models.map((model) => ({ id: model.id, label: model.label })),
    }))
  return { content: [{ type: 'text' as const, text: JSON.stringify({ providers }) }] }
}

export async function generateImageToolHandler(args: GenerateImageArgs, deps: BuiltInSuperoneToolDeps) {
  try {
    const providerId = args.provider ?? (await resolveDefaultProviderId())
    const model = args.model ?? (await resolveDefaultModel(providerId))

    const referenceImages = (args.reference_image_paths ?? []).map((path) => {
      const data = readFileSync(path)
      return { mediaType: detectImageMime(data) ?? 'image/png', data }
    })

    const result = await generateAndRecord({
      providerId,
      model,
      prompt: args.prompt,
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      size: args.size,
      aspectRatio: args.aspect_ratio,
      sessionId: deps.sessionId,
      source: 'agent',
    })

    const summary = {
      status: 'generated',
      generationId: result.generationId,
      provider: providerId,
      model,
      savedPaths: result.images.map((image) => image.path),
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(summary) }],
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
        },
      ],
      isError: true,
    }
  }
}

export interface GenerateVideoArgs {
  prompt: string
  provider?: string
  model?: string
  first_frame_path?: string
  last_frame_path?: string
  reference_image_paths?: string[]
  reference_video_paths?: string[]
  reference_audio_paths?: string[]
  aspect_ratio?: string
  resolution?: string
  duration?: number
  fps?: number
  seed?: number
  generate_audio?: boolean
  watermark?: boolean
  camera_fixed?: boolean
}

export interface VideoStatusArgs {
  generation_id: string
}

/** Turn one error shape into the JSON envelope every media tool returns. */
function toolError(error: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
      },
    ],
    isError: true,
  }
}

function toolResult(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] }
}

// Static fallback option lists — GenerateVideoArgs.aspect_ratio/resolution are free-form
// strings and there is no structured per-provider/per-model source of valid values (only
// prose in the guide markdown). If the user picks a value the provider rejects, the
// provider API errors and the tool returns the message — an acceptable degrade path.
const COMMON_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const COMMON_RESOLUTIONS = ['480p', '720p', '1080p']

/** Same underlying query as media_list_providers, projected to the confirm dialog's shape. */
async function buildVideoGenProviderOptions(): Promise<VideoGenProviderOption[]> {
  const statuses = await getMediaProviderStatuses()
  return statuses
    .filter((status) => status.hasKey || status.hasEnvKey)
    .filter((status) => status.categories.includes('video'))
    .map((status) => ({
      id: status.id,
      label: status.label,
      models: status.models.map((model) => ({ id: model.id, label: model.label })),
      aspectRatios: [...COMMON_ASPECT_RATIOS],
      resolutions: [...COMMON_RESOLUTIONS],
    }))
}

/** GenerateVideoArgs (snake_case) → VideoGenParams (camelCase) with defaults filled in. */
function buildInitialVideoGenParams(args: GenerateVideoArgs, providerId: string, model: string): VideoGenParams {
  return {
    prompt: args.prompt,
    provider: providerId,
    model,
    aspectRatio: args.aspect_ratio ?? '16:9',
    resolution: args.resolution ?? '720p',
    duration: args.duration ?? 5,
    ...(args.fps != null ? { fps: args.fps } : {}),
    ...(args.seed != null ? { seed: args.seed } : {}),
    generateAudio: args.generate_audio ?? false,
    watermark: args.watermark ?? false,
    cameraFixed: args.camera_fixed ?? false,
  }
}

/** Paths only, no bytes — the renderer loads thumbnails over IPC. */
function buildReferenceImageRefs(args: GenerateVideoArgs): VideoGenReferenceImageRef[] {
  const refs: VideoGenReferenceImageRef[] = []
  if (args.first_frame_path) refs.push({ path: args.first_frame_path, role: 'first_frame' })
  if (args.last_frame_path) refs.push({ path: args.last_frame_path, role: 'last_frame' })
  for (const path of args.reference_image_paths ?? []) refs.push({ path, role: 'reference' })
  return refs
}

/** Write user-edited VideoGenParams back onto GenerateVideoArgs. */
function applyVideoGenParams(args: GenerateVideoArgs, params: VideoGenParams): void {
  args.prompt = params.prompt
  args.provider = params.provider
  args.model = params.model
  args.aspect_ratio = params.aspectRatio
  args.resolution = params.resolution
  args.duration = params.duration
  args.fps = params.fps
  args.seed = params.seed
  args.generate_audio = params.generateAudio
  args.watermark = params.watermark
  args.camera_fixed = params.cameraFixed
}

/**
 * Ask the user to review/edit video generation parameters before anything is submitted.
 * Returns null to proceed (accept — possibly with edited params written back to args),
 * or a tool_result payload to return immediately (rejected / cancelled).
 *
 * Driven by a host `permission_request` event rather than MCP elicitation, so it works
 * identically on the Claude in-process server and the Codex stdio bridge (which executes
 * the tool back in the main process, with no McpServer instance in hand).
 */
const pendingVideoConfirms = new Map<string, {
  resolve: (value: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

const VIDEO_CONFIRM_TIMEOUT_MS = 120_000

export function resolveVideoConfirm(requestId: string, action: string, content?: Record<string, unknown>): boolean {
  const pending = pendingVideoConfirms.get(requestId)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingVideoConfirms.delete(requestId)
  pending.resolve({ action: action as 'accept' | 'decline' | 'cancel', content })
  return true
}

export function rejectVideoConfirm(requestId: string, reason: string): boolean {
  const pending = pendingVideoConfirms.get(requestId)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingVideoConfirms.delete(requestId)
  pending.reject(new Error(reason))
  return true
}

async function confirmVideoGeneration(
  args: GenerateVideoArgs,
  providerId: string,
  model: string,
  deps: BuiltInSuperoneToolDeps,
): Promise<Record<string, unknown> | null> {
  const payload: VideoGenConfirmPayload = {
    params: buildInitialVideoGenParams(args, providerId, model),
    providers: await buildVideoGenProviderOptions(),
    referenceImages: buildReferenceImageRefs(args),
  }

  const requestId = `videoconfirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  log.info('[media-tools] opening video confirm requestId=%s', requestId)
  trace('media.elicitation', 'video-confirm-open', { requestId })

  const session = deps.sessionHost?.getSession(deps.sessionId) ?? null
  if (!session?.emitHostEvent) {
    return {
      status: 'error',
      message: 'Video generation requires a confirmation dialog, but the session is not available. Nothing was submitted.',
      hint: 'Do NOT retry media_generate_video — it will fail the same way. Report the error to the user.',
    }
  }

  let elicitResult: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }
  try {
    elicitResult = await new Promise<typeof elicitResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingVideoConfirms.delete(requestId)
        reject(new Error(`Video confirmation timed out after ${VIDEO_CONFIRM_TIMEOUT_MS}ms`))
      }, VIDEO_CONFIRM_TIMEOUT_MS)
      pendingVideoConfirms.set(requestId, { resolve, reject, timer })

      session.emitHostEvent!({
        type: 'permission_request',
        request: {
          requestId,
          toolName: 'media_generate_video',
          toolUseId: requestId,
          input: {} as Record<string, unknown>,
          allowAlwaysAllow: false,
          requestKind: 'video_gen_confirm' as const,
          serverName: 'superone',
          message: `Confirm video generation: "${args.prompt.slice(0, 120)}"`,
          videoGenConfirm: payload,
        },
      })
    })
  } catch (error) {
    return {
      status: 'error',
      message: `Video confirmation failed: ${error instanceof Error ? error.message : String(error)}. Nothing was submitted.`,
      hint: 'Do NOT retry media_generate_video — it will fail the same way. Report the error to the user.',
    }
  }

  if (elicitResult.action === 'cancel') {
    return {
      status: 'cancelled',
      hint: 'The user dismissed the confirmation without choosing. Do NOT retry this call on your own — wait for further instructions from the user.',
    }
  }
  if (elicitResult.action === 'decline') {
    const feedback = typeof elicitResult.content?.feedback === 'string' ? elicitResult.content.feedback : ''
    return {
      status: 'rejected',
      ...(feedback ? { feedback } : {}),
      hint: 'The user rejected these generation parameters. Adjust the parameters according to the feedback and call media_generate_video again.',
    }
  }

  const paramsJson = elicitResult.content?.[VIDEO_GEN_PARAMS_FIELD]
  if (typeof paramsJson === 'string') {
    try {
      const edited = JSON.parse(paramsJson) as VideoGenParams
      if (edited && typeof edited.prompt === 'string' && edited.prompt.trim()) {
        applyVideoGenParams(args, edited)
      }
    } catch {
      // keep original args
    }
  }
  return null
}


function frameInputs(args: GenerateVideoArgs): VideoFrameInput[] | undefined {
  const frames: VideoFrameInput[] = []
  if (args.first_frame_path) {
    frames.push({ image: readFileSync(args.first_frame_path), frameType: 'first_frame' })
  }
  if (args.last_frame_path) {
    frames.push({ image: readFileSync(args.last_frame_path), frameType: 'last_frame' })
  }
  return frames.length > 0 ? frames : undefined
}

/**
 * Ark takes reference video and audio as URLs or data URIs, and there is no upload endpoint to put
 * a local file behind a URL — so local paths are inlined. Size limits are the provider's (50MB per
 * clip, 15MB per track); an oversized file fails upstream with Ark's own message.
 */
function dataUris(paths: string[] | undefined, mediaType: string): string[] | undefined {
  if (!paths?.length) return undefined
  return paths.map((path) => `data:${mediaType};base64,${readFileSync(path).toString('base64')}`)
}

export async function generateVideoToolHandler(args: GenerateVideoArgs, deps: BuiltInSuperoneToolDeps) {
  try {
    const providerId = args.provider ?? (await resolveDefaultVideoProviderId())
    const model = args.model ?? (await resolveDefaultVideoModel(providerId))

    // Fill defaults onto args up front so every path below (accept-apply, auto-accept
    // fallback) submits exactly the parameter set the user saw in the confirm dialog.
    applyVideoGenParams(args, buildInitialVideoGenParams(args, providerId, model))

    // User confirmation gate — may write edited params back onto args, or short-circuit
    // with a rejected/cancelled tool_result (a normal result, not an error, so the model
    // naturally adjusts and retries rather than treating it as a failure).
    const earlyReturn = await confirmVideoGeneration(args, providerId, model, deps)
    if (earlyReturn) return toolResult(earlyReturn)

    // Provider/model may have been changed by the user's edits.
    const finalProviderId = args.provider ?? providerId
    const finalModel = args.model ?? model

    const referenceVideos = dataUris(args.reference_video_paths, 'video/mp4')
    const referenceAudios = dataUris(args.reference_audio_paths, 'audio/mpeg')
    const arkOptions = {
      ...(args.watermark != null ? { watermark: args.watermark } : {}),
      ...(args.camera_fixed != null ? { cameraFixed: args.camera_fixed } : {}),
      ...(referenceVideos ? { referenceVideos } : {}),
      ...(referenceAudios ? { referenceAudios } : {}),
    }

    const generationId = await submitVideoGeneration({
      providerId: finalProviderId,
      model: finalModel,
      prompt: args.prompt,
      frameImages: frameInputs(args),
      inputReferences: args.reference_image_paths?.map((path) => readFileSync(path)),
      aspectRatio: args.aspect_ratio,
      resolution: args.resolution,
      duration: args.duration,
      fps: args.fps,
      seed: args.seed,
      generateAudio: args.generate_audio,
      ...(Object.keys(arkOptions).length > 0 ? { providerOptions: { ark: arkOptions } } : {}),
      sessionId: deps.sessionId,
      source: 'agent',
    })

    return toolResult({
      status: 'submitted',
      generationId,
      provider: finalProviderId,
      model: finalModel,
      hint: 'The provider accepted the job. Poll media_video_status with this generationId about every 30 seconds until it returns generated or error — each call is what checks on and collects the render.',
    })
  } catch (error) {
    return toolError(error)
  }
}

export async function videoStatusToolHandler(args: VideoStatusArgs) {
  try {
    const state = await readVideoGeneration(args.generation_id)
    if (!state) {
      return toolError(new Error(`No video generation found with id '${args.generation_id}'.`))
    }
    if (state.status === 'running') {
      return toolResult({ status: 'running', generationId: state.generationId })
    }
    if (state.status === 'failed') {
      return toolError(new Error(state.error ?? 'Video generation failed.'))
    }
    return toolResult({
      status: 'generated',
      generationId: state.generationId,
      savedPaths: state.savedPaths,
      ...(state.warnings.length > 0 ? { warnings: state.warnings } : {}),
    })
  } catch (error) {
    return toolError(error)
  }
}

export function registerMediaTools(server: McpServer, deps: BuiltInSuperoneToolDeps): void {
  server.registerTool(
    'media_read_guide',
    {
      description: READ_MEDIA_GUIDE_DESCRIPTION,
      inputSchema: {
        topic: z.enum(MEDIA_GUIDE_TOPICS).describe(MEDIA_GUIDE_TOPIC_DESCRIPTION),
      },
    },
    (args) => readMediaGuideHandler(args),
  )

  server.registerTool(
    'media_list_providers',
    {
      description: LIST_MEDIA_PROVIDERS_DESCRIPTION,
      inputSchema: {
        category: z.string().optional().describe('Filter by media category, e.g. "image". Omit to list all usable providers.'),
      },
    },
    (args) => listMediaProvidersHandler(args),
  )

  server.registerTool(
    'media_generate_image',
    {
      description: GENERATE_IMAGE_DESCRIPTION,
      inputSchema: {
        prompt: z.string().describe('A detailed description of the image to generate, or the edit to apply when reference images are provided.'),
        provider: z.string().optional().describe('Which configured image provider id to use. Call media_list_providers to discover ids. Defaults to the first usable provider.'),
        model: z.string().optional().describe("Model id override. Defaults to the provider's default model."),
        aspect_ratio: z.string().optional().describe('Aspect ratio like "16:9" or "1:1". Preferred for google models.'),
        size: z.string().optional().describe('Pixel size like "1024x1024". Preferred for openai / openai-compatible models.'),
        reference_image_paths: z
          .array(z.string())
          .optional()
          .describe('Absolute paths to input images for editing / image-to-image / iterating on a prior result. Omit for pure text-to-image.'),
      },
    },
    (args) => generateImageToolHandler(args, deps),
  )

  server.registerTool(
    'media_generate_video',
    {
      description: GENERATE_VIDEO_DESCRIPTION,
      inputSchema: {
        prompt: z.string().describe('A detailed description of the video to generate, including motion and camera direction.'),
        provider: z.string().optional().describe('Which configured video provider id to use. Call media_list_providers with category "video" to discover ids. Defaults to the first usable provider.'),
        model: z.string().optional().describe("Model id override. Defaults to the provider's default video model."),
        first_frame_path: z.string().optional().describe('Absolute path to an image to animate from (image-to-video). This is the starting frame.'),
        last_frame_path: z.string().optional().describe('Absolute path to an image the video should end on. Requires first_frame_path.'),
        reference_image_paths: z.array(z.string()).optional().describe('Absolute paths to reference images for character or scene consistency. Up to 9 images total across all roles on Ark.'),
        reference_video_paths: z.array(z.string()).optional().describe('Absolute paths to reference video clips. Volcengine Ark (Seedance) only; ignored by other providers.'),
        reference_audio_paths: z.array(z.string()).optional().describe('Absolute paths to reference audio tracks. Volcengine Ark (Seedance) only; ignored by other providers.'),
        aspect_ratio: z.string().optional().describe('Aspect ratio like "16:9", "9:16" or "1:1".'),
        resolution: z.string().optional().describe('Pixel resolution like "1920x1080". Ark maps this onto its 480p/720p/1080p tiers; Sora accepts only 720x1280, 1280x720, 1024x1792, 1792x1024.'),
        duration: z.number().optional().describe('Clip length in seconds. Ark accepts 2-15; Sora accepts only 4, 8 or 12.'),
        fps: z.number().optional().describe('Frames per second, e.g. 24. Ignored by providers that derive it from the model.'),
        seed: z.number().optional().describe('Seed for reproducible generation.'),
        generate_audio: z.boolean().optional().describe('Whether the model should generate a soundtrack alongside the video, where supported.'),
        watermark: z.boolean().optional().describe('Whether to stamp the provider watermark. Volcengine Ark only.'),
        camera_fixed: z.boolean().optional().describe('Lock the camera in place instead of letting the model move it. Volcengine Ark only.'),
      },
    },
    (args) => generateVideoToolHandler(args, deps),
  )

  server.registerTool(
    'media_video_status',
    {
      description: VIDEO_STATUS_DESCRIPTION,
      inputSchema: {
        generation_id: z.string().describe('The generationId returned by media_generate_video.'),
      },
    },
    (args) => videoStatusToolHandler(args),
  )
}
