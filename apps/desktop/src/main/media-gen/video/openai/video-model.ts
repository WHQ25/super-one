import type { SharedV4Warning } from '@ai-sdk/provider'
import { definedHeaders, readJson } from '../../http'
import { unrecognisedStatus, type VideoTask } from '../ark/response'
import type { VideoDownload, VideoSubmission, VideoTaskDriver } from '../driver'
import type { VideoModelV4CallOptions } from '../sdk-types'

export interface OpenAIVideoModelConfig {
  provider: string
  baseURL: string
  apiKey: string
  fetch?: typeof globalThis.fetch
}

interface SoraJob {
  id?: string
  status?: string
  progress?: number
  error?: { message?: string }
}

/** Sora sizes video by explicit pixel dimensions; these are the ones the API accepts. */
const SUPPORTED_SIZES = new Set(['720x1280', '1280x720', '1024x1792', '1792x1024'])

/** Sora takes duration as a string enum of seconds rather than an arbitrary number. */
const SUPPORTED_SECONDS = new Set(['4', '8', '12'])

function toTask(job: SoraJob): VideoTask {
  const id = job.id ?? ''
  switch (job.status) {
    case 'queued':
      return { id, status: 'queued' }
    case 'in_progress':
    case 'processing':
      return { id, status: 'running' }
    case 'completed':
      return { id, status: 'succeeded' }
    case 'failed':
      return { id, status: 'failed', error: job.error?.message || 'Sora video generation failed.' }
    case 'cancelled':
      return { id, status: 'cancelled', error: job.error?.message }
    default:
      return unrecognisedStatus(id, job.status)
  }
}

function buildBody(
  modelId: string,
  options: VideoModelV4CallOptions,
  warnings: SharedV4Warning[],
): Record<string, unknown> {
  const body: Record<string, unknown> = { model: modelId, prompt: options.prompt ?? '' }

  if (options.resolution) {
    if (SUPPORTED_SIZES.has(options.resolution)) body.size = options.resolution
    else {
      warnings.push({
        type: 'unsupported',
        feature: 'resolution',
        details: `Sora accepts only ${[...SUPPORTED_SIZES].join(', ')}; '${options.resolution}' was ignored.`,
      })
    }
  }
  if (options.duration != null) {
    const seconds = String(options.duration)
    if (SUPPORTED_SECONDS.has(seconds)) body.seconds = seconds
    else {
      warnings.push({
        type: 'unsupported',
        feature: 'duration',
        details: `Sora accepts only ${[...SUPPORTED_SECONDS].join('/')} second clips; '${seconds}' was ignored.`,
      })
    }
  }
  for (const [feature, value] of [
    ['aspectRatio', options.aspectRatio],
    ['fps', options.fps],
    ['seed', options.seed],
    ['generateAudio', options.generateAudio],
  ] as const) {
    if (value != null) {
      warnings.push({
        type: 'unsupported',
        feature,
        details: `Sora derives ${feature} from the model and size; the value was ignored.`,
      })
    }
  }

  const extra = (options.providerOptions?.openai ?? {}) as Record<string, unknown>
  return { ...body, ...extra }
}

/**
 * OpenAI Sora video model, also used for relays that copy its `/videos` shape.
 *
 * POST to create the job, GET the job for status, GET `/content` for the MP4 bytes. Unlike Ark it
 * returns binary rather than an expiring URL, so there is no download deadline to race.
 */
export function createOpenAIVideoDriver(cfg: OpenAIVideoModelConfig, modelId: string): VideoTaskDriver {
  const base = cfg.baseURL.replace(/\/+$/, '')
  const videosUrl = `${base}/videos`
  const doFetch = cfg.fetch ?? globalThis.fetch
  const auth = { authorization: `Bearer ${cfg.apiKey}` }

  return {
    provider: cfg.provider,
    modelId,

    async submit(options: VideoModelV4CallOptions): Promise<VideoSubmission> {
      const warnings: SharedV4Warning[] = []
      if (options.n > 1) {
        warnings.push({
          type: 'unsupported',
          feature: 'n',
          details: 'Sora returns one video per job. Generate additional videos with separate calls.',
        })
      }

      const response = await doFetch(videosUrl, {
        method: 'POST',
        headers: { ...auth, ...definedHeaders(options.headers), 'content-type': 'application/json' },
        body: JSON.stringify(buildBody(modelId, options, warnings)),
        ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      })
      const job = await readJson<SoraJob>(response, 'Sora')
      if (!response.ok || !job.id) {
        throw new Error(
          `Sora video submission failed (${response.status}): ${job.error?.message ?? 'no job id returned'}`,
        )
      }
      return { taskId: job.id, warnings }
    },

    async fetch(taskId: string): Promise<VideoTask> {
      const response = await doFetch(`${videosUrl}/${taskId}`, { method: 'GET', headers: auth })
      const job = await readJson<SoraJob>(response, 'Sora')
      if (!response.ok) {
        throw new Error(`Sora job lookup failed (${response.status}): ${job.error?.message ?? taskId}`)
      }
      return toTask({ ...job, id: job.id ?? taskId })
    },

    async download(task: VideoTask): Promise<VideoDownload> {
      const contentResponse = await doFetch(`${videosUrl}/${task.id}/content`, { method: 'GET', headers: auth })
      if (!contentResponse.ok) {
        throw new Error(`Sora video download failed (${contentResponse.status}) for job ${task.id}`)
      }
      return { data: new Uint8Array(await contentResponse.arrayBuffer()), mediaType: 'video/mp4' }
    },
  }
}
