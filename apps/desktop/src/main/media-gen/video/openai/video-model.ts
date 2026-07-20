import type { SharedV4Warning } from '@ai-sdk/provider'
import { collectHeaders, definedHeaders, readJson } from '../../http'
import { pollUntilDone, type PollOptions } from '../poll'
import type { VideoTask } from '../ark/response'
import type { VideoModelV4, VideoModelV4CallOptions, VideoModelV4Result } from '../sdk-types'

export interface OpenAIVideoModelConfig {
  provider: string
  baseURL: string
  apiKey: string
  fetch?: typeof globalThis.fetch
  poll?: PollOptions
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
      return { id, status: 'failed', error: `Sora returned an unrecognised job status: ${job.status}` }
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
 * Three stages behind one `doGenerate`: POST to create the job, poll until it completes, then GET
 * `/content` for the MP4 bytes. Unlike Ark it returns binary rather than an expiring URL, so there
 * is no download deadline to race.
 */
export function createOpenAIVideoModel(cfg: OpenAIVideoModelConfig, modelId: string): VideoModelV4 {
  const base = cfg.baseURL.replace(/\/+$/, '')
  const videosUrl = `${base}/videos`
  const doFetch = cfg.fetch ?? globalThis.fetch

  return {
    specificationVersion: 'v4',
    provider: cfg.provider,
    modelId,
    maxVideosPerCall: 1,
    async doGenerate(options: VideoModelV4CallOptions): Promise<VideoModelV4Result> {
      const warnings: SharedV4Warning[] = []
      if (options.n > 1) {
        warnings.push({
          type: 'unsupported',
          feature: 'n',
          details: 'Sora returns one video per job. Generate additional videos with separate calls.',
        })
      }

      const authHeaders = {
        authorization: `Bearer ${cfg.apiKey}`,
        ...definedHeaders(options.headers),
      }
      const signal = options.abortSignal ? { signal: options.abortSignal } : {}

      const createResponse = await doFetch(videosUrl, {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(buildBody(modelId, options, warnings)),
        ...signal,
      })
      const job = await readJson<SoraJob>(createResponse, 'Sora')
      if (!createResponse.ok || !job.id) {
        throw new Error(
          `Sora video submission failed (${createResponse.status}): ${job.error?.message ?? 'no job id returned'}`,
        )
      }

      const jobUrl = `${videosUrl}/${job.id}`
      const task = await pollUntilDone(
        async () => {
          const response = await doFetch(jobUrl, { method: 'GET', headers: authHeaders, ...signal })
          const polled = await readJson<SoraJob>(response, 'Sora')
          if (!response.ok) {
            throw new Error(`Sora job lookup failed (${response.status}): ${polled.error?.message ?? job.id}`)
          }
          return toTask(polled)
        },
        { ...cfg.poll, abortSignal: options.abortSignal },
      )
      if (task.status !== 'succeeded') {
        throw new Error(`Sora video generation ${task.status}: ${task.error ?? 'no details'}`)
      }

      const contentResponse = await doFetch(`${jobUrl}/content`, { method: 'GET', headers: authHeaders, ...signal })
      if (!contentResponse.ok) {
        throw new Error(`Sora video download failed (${contentResponse.status}) for job ${job.id}`)
      }
      const bytes = new Uint8Array(await contentResponse.arrayBuffer())

      return {
        videos: [{ type: 'binary', data: bytes, mediaType: 'video/mp4' }],
        warnings,
        response: {
          timestamp: new Date(),
          modelId,
          headers: collectHeaders(createResponse.headers),
        },
        providerMetadata: { openai: { jobId: job.id } },
      }
    },
  }
}
