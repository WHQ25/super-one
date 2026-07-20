import type { SharedV4Warning } from '@ai-sdk/provider'
import { collectHeaders, definedHeaders, readJson } from '../../http'
import { pollUntilDone, type PollOptions } from '../poll'
import type { VideoTask } from '../ark/response'
import type { VideoModelV4, VideoModelV4CallOptions, VideoModelV4Result } from '../sdk-types'
import { buildNewApiVideoRequest, vendorForModel } from './request'

export interface NewApiVideoModelConfig {
  provider: string
  baseURL: string
  apiKey: string
  fetch?: typeof globalThis.fetch
  poll?: PollOptions
}

interface NewApiVideoJob {
  id?: string
  status?: string
  progress?: number
  error?: { message?: string; code?: string }
}

function toTask(job: NewApiVideoJob): VideoTask {
  const id = job.id ?? ''
  const message = job.error?.message
  switch (job.status) {
    case 'queued':
      return { id, status: 'queued' }
    case 'in_progress':
      return { id, status: 'running' }
    case 'completed':
      return { id, status: 'succeeded' }
    case 'failed':
      return { id, status: 'failed', error: message || 'New API video generation failed.' }
    default:
      return { id, status: 'failed', error: `New API returned an unrecognised job status: ${job.status}` }
  }
}

/**
 * New API (and NewAPI-style relays that copy its shape) generic multi-vendor video relay.
 *
 * Distinct from the `openai-compatible` provider: that one speaks Sora's own `/videos` shape
 * (relays that proxy a genuine Sora-compatible upstream). This one speaks New API's OWN normalizing
 * relay format (`/v1/video/generations`, `TaskSubmitReq` body) that fans out to Doubao/Kling/etc. by
 * model id server-side — see `guides/media/newapi-video.md` for exactly which fields apply to which
 * vendor. The response shape (poll status, content download) is otherwise identical to Sora's: poll
 * until terminal, then a separate binary content fetch — see `newapi-video.md` for why the video URL
 * embedded in the poll response's `metadata` is not used directly (not guaranteed valid for every
 * vendor; the relay's own content-proxy endpoint always is).
 */
export function createNewApiVideoModel(cfg: NewApiVideoModelConfig, modelId: string): VideoModelV4 {
  const base = cfg.baseURL.replace(/\/+$/, '')
  const submitUrl = `${base}/video/generations`
  const doFetch = cfg.fetch ?? globalThis.fetch

  return {
    specificationVersion: 'v4',
    provider: cfg.provider,
    modelId,
    maxVideosPerCall: 1,
    async doGenerate(options: VideoModelV4CallOptions): Promise<VideoModelV4Result> {
      const vendor = vendorForModel(modelId)
      const { body, warnings } = buildNewApiVideoRequest(vendor, modelId, options)

      const authHeaders = {
        authorization: `Bearer ${cfg.apiKey}`,
        ...definedHeaders(options.headers),
      }
      const signal = options.abortSignal ? { signal: options.abortSignal } : {}

      const createResponse = await doFetch(submitUrl, {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...signal,
      })
      const job = await readJson<NewApiVideoJob>(createResponse, 'New API video')
      if (!createResponse.ok || !job.id) {
        throw new Error(
          `New API video submission failed (${createResponse.status}): ${job.error?.message ?? 'no job id returned'}`,
        )
      }

      const pollUrl = `${submitUrl}/${job.id}`
      const task = await pollUntilDone(
        async () => {
          const response = await doFetch(pollUrl, { method: 'GET', headers: authHeaders, ...signal })
          const polled = await readJson<NewApiVideoJob>(response, 'New API video')
          if (!response.ok) {
            throw new Error(`New API video job lookup failed (${response.status}): ${polled.error?.message ?? job.id}`)
          }
          return toTask(polled)
        },
        { ...cfg.poll, abortSignal: options.abortSignal },
      )
      if (task.status !== 'succeeded') {
        throw new Error(`New API video generation ${task.status}: ${task.error ?? 'no details'}`)
      }

      const contentResponse = await doFetch(`${base}/videos/${job.id}/content`, { method: 'GET', headers: authHeaders, ...signal })
      if (!contentResponse.ok) {
        throw new Error(`New API video download failed (${contentResponse.status}) for job ${job.id}`)
      }
      const bytes = new Uint8Array(await contentResponse.arrayBuffer())

      return {
        videos: [{ type: 'binary', data: bytes, mediaType: 'video/mp4' }],
        warnings: warnings as SharedV4Warning[],
        response: {
          timestamp: new Date(),
          modelId,
          headers: collectHeaders(createResponse.headers),
        },
        providerMetadata: { newapi: { jobId: job.id, vendor } },
      }
    },
  }
}
