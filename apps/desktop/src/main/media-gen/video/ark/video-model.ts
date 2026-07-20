import { definedHeaders, readJson } from '../../http'
import type { VideoDownload, VideoSubmission, VideoTaskDriver } from '../driver'
import type { VideoModelV4CallOptions } from '../sdk-types'
import { buildArkVideoRequest } from './request'
import { parseArkVideoTask, type VideoTask } from './response'

export interface ArkVideoModelConfig {
  provider: string
  baseURL: string
  apiKey: string
  fetch?: typeof globalThis.fetch
}

interface ArkSubmitResponse {
  id?: string
  error?: { message?: string }
}

/**
 * Native Volcengine Ark video model (Seedance).
 *
 * Ark hands back a TOS URL rather than bytes, and that URL expires 24h after the task succeeds — so
 * `download` fetches it immediately on the caller's behalf instead of letting the URL travel any
 * further. It is deliberately unauthenticated: the URL is pre-signed, and attaching the Ark key to a
 * TOS request is at best pointless.
 */
export function createArkVideoDriver(cfg: ArkVideoModelConfig, modelId: string): VideoTaskDriver {
  const base = cfg.baseURL.replace(/\/+$/, '')
  const tasksUrl = `${base}/contents/generations/tasks`
  const doFetch = cfg.fetch ?? globalThis.fetch
  const auth = { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` }

  return {
    provider: cfg.provider,
    modelId,

    async submit(options: VideoModelV4CallOptions): Promise<VideoSubmission> {
      const { body, warnings } = buildArkVideoRequest(modelId, options)
      const response = await doFetch(tasksUrl, {
        method: 'POST',
        headers: { ...auth, ...definedHeaders(options.headers) },
        body: JSON.stringify(body),
        ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      })
      const submitted = await readJson<ArkSubmitResponse>(response, 'Ark')
      if (!response.ok || !submitted.id) {
        throw new Error(
          `Ark video submission failed (${response.status}): ${submitted.error?.message ?? 'no task id returned'}`,
        )
      }
      return { taskId: submitted.id, warnings }
    },

    async fetch(taskId: string): Promise<VideoTask> {
      const response = await doFetch(`${tasksUrl}/${taskId}`, { method: 'GET', headers: auth })
      const raw = await readJson<Parameters<typeof parseArkVideoTask>[0]>(response, 'Ark')
      if (!response.ok) {
        throw new Error(`Ark task lookup failed (${response.status}): ${raw.error?.message ?? taskId}`)
      }
      return parseArkVideoTask({ ...raw, id: raw.id ?? taskId })
    },

    async download(task: VideoTask): Promise<VideoDownload> {
      if (!task.videoUrl) {
        throw new Error(`Ark task ${task.id} succeeded but carried no video url.`)
      }
      const response = await doFetch(task.videoUrl, { method: 'GET' })
      if (!response.ok) {
        throw new Error(
          `Ark video download failed (${response.status}) for task ${task.id}. The result url expires 24h after the task succeeds.`,
        )
      }
      return { data: new Uint8Array(await response.arrayBuffer()), mediaType: 'video/mp4' }
    },
  }
}
