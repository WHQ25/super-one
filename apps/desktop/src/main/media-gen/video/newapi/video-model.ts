import { definedHeaders, readJson } from '../../http'
import { unrecognisedStatus, type VideoTask } from '../ark/response'
import type { VideoDownload, VideoSubmission, VideoTaskDriver } from '../driver'
import type { VideoModelV4CallOptions } from '../sdk-types'
import { buildNewApiVideoRequest, vendorForModel } from './request'

export interface NewApiVideoModelConfig {
  provider: string
  baseURL: string
  apiKey: string
  fetch?: typeof globalThis.fetch
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
      return unrecognisedStatus(id, job.status)
  }
}

/**
 * New API (and NewAPI-style relays that copy its shape) generic multi-vendor video relay.
 *
 * Distinct from the `openai-compatible` provider: that one speaks Sora's own `/videos` shape
 * (relays that proxy a genuine Sora-compatible upstream). This one speaks New API's OWN normalizing
 * relay format (`/v1/video/generations`, `TaskSubmitReq` body) that fans out to Doubao/Kling/etc. by
 * model id server-side — see `guides/media/newapi-video.md` for exactly which fields apply to which
 * vendor.
 *
 * Submission and status live on DIFFERENT routes here: `POST /video/generations` takes the relay's
 * own `TaskSubmitReq`, but `GET /video/generations/{id}` answers in New API's internal
 * `{code, data: TaskDto}` envelope with uppercase `SUCCESS`/`FAILURE` statuses. Status therefore
 * goes to `GET /videos/{id}` — the relay's OpenAI-compatible fetch route (it keys off the
 * `/v1/videos/` URI prefix), which returns the flat Sora-shaped object `toTask` parses, and which is
 * also where the `/videos/{id}/content` binary download lives. See `newapi-video.md` for why the
 * video URL embedded in the response's `metadata` is not used directly (not guaranteed valid for
 * every vendor; the relay's own content-proxy endpoint always is).
 */
export function createNewApiVideoDriver(cfg: NewApiVideoModelConfig, modelId: string): VideoTaskDriver {
  const base = cfg.baseURL.replace(/\/+$/, '')
  const doFetch = cfg.fetch ?? globalThis.fetch
  const auth = { authorization: `Bearer ${cfg.apiKey}` }

  return {
    provider: cfg.provider,
    modelId,

    async submit(options: VideoModelV4CallOptions): Promise<VideoSubmission> {
      const vendor = vendorForModel(modelId)
      const { body, warnings } = buildNewApiVideoRequest(vendor, modelId, options)
      const response = await doFetch(`${base}/video/generations`, {
        method: 'POST',
        headers: { ...auth, ...definedHeaders(options.headers), 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      })
      const job = await readJson<NewApiVideoJob>(response, 'New API video')
      if (!response.ok || !job.id) {
        throw new Error(
          `New API video submission failed (${response.status}): ${job.error?.message ?? 'no job id returned'}`,
        )
      }
      return { taskId: job.id, warnings }
    },

    async fetch(taskId: string): Promise<VideoTask> {
      const response = await doFetch(`${base}/videos/${taskId}`, { method: 'GET', headers: auth })
      const job = await readJson<NewApiVideoJob>(response, 'New API video')
      if (!response.ok) {
        throw new Error(`New API video job lookup failed (${response.status}): ${job.error?.message ?? taskId}`)
      }
      return toTask({ ...job, id: job.id ?? taskId })
    },

    async download(task: VideoTask): Promise<VideoDownload> {
      const response = await doFetch(`${base}/videos/${task.id}/content`, { method: 'GET', headers: auth })
      if (!response.ok) {
        throw new Error(`New API video download failed (${response.status}) for job ${task.id}`)
      }
      return { data: new Uint8Array(await response.arrayBuffer()), mediaType: 'video/mp4' }
    },
  }
}
