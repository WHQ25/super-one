import { definedHeaders, readJson } from '../../http'
import type { VideoTask } from '../ark/response'
import type { VideoDownload, VideoSubmission, VideoTaskDriver } from '../driver'
import type { VideoModelV4CallOptions } from '../sdk-types'
import { buildVeoVideoRequest } from './request'

export interface GoogleVideoModelConfig {
  provider: string
  baseURL: string
  apiKey: string
  fetch?: typeof globalThis.fetch
}

interface GoogleOperation {
  name?: string
  done?: boolean
  error?: { message?: string }
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>
    }
  }
}

/**
 * Veo's result URI lives on the same host as the API and is not pre-signed, so it needs the API key
 * appended. A URI pointing anywhere else is already a public/signed link and must be left untouched
 * — appending the key there would leak it to a third-party host.
 */
function sameOrigin(uri: string, baseURL: string): boolean {
  try {
    return new URL(uri).origin === new URL(baseURL).origin
  } catch {
    return false
  }
}

/**
 * Google Veo, written against the raw `predictLongRunning` wire rather than `@ai-sdk/google`.
 *
 * The SDK's own video model polls to completion inside a single `doGenerate` and never surfaces the
 * operation name, so there is no handle to persist and no way to ask about a job in a later call —
 * which is precisely what on-demand status requires. Reimplementing the three steps here is what
 * lets Veo behave like every other provider instead of needing a second, blocking code path.
 *
 * Veo's status is a plain `done` boolean plus an optional error, with no status vocabulary at all,
 * so unlike the relay-backed providers there is no unrecognised-status case to guard against.
 */
export function createGoogleVideoDriver(cfg: GoogleVideoModelConfig, modelId: string): VideoTaskDriver {
  const base = cfg.baseURL.replace(/\/+$/, '')
  const doFetch = cfg.fetch ?? globalThis.fetch
  const auth = { 'x-goog-api-key': cfg.apiKey }

  return {
    provider: cfg.provider,
    modelId,

    async submit(options: VideoModelV4CallOptions): Promise<VideoSubmission> {
      const { body, warnings } = buildVeoVideoRequest(options)
      const response = await doFetch(`${base}/models/${modelId}:predictLongRunning`, {
        method: 'POST',
        headers: { ...auth, ...definedHeaders(options.headers), 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      })
      const operation = await readJson<GoogleOperation>(response, 'Veo')
      if (!response.ok || !operation.name) {
        throw new Error(
          `Veo video submission failed (${response.status}): ${operation.error?.message ?? 'no operation name returned'}`,
        )
      }
      return { taskId: operation.name, warnings }
    },

    async fetch(taskId: string): Promise<VideoTask> {
      const response = await doFetch(`${base}/${taskId}`, { method: 'GET', headers: auth })
      const operation = await readJson<GoogleOperation>(response, 'Veo')
      if (!response.ok) {
        throw new Error(`Veo operation lookup failed (${response.status}): ${operation.error?.message ?? taskId}`)
      }
      if (!operation.done) return { id: taskId, status: 'running' }
      if (operation.error) {
        return { id: taskId, status: 'failed', error: operation.error.message || 'Veo video generation failed.' }
      }
      const uri = operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
      if (!uri) {
        return { id: taskId, status: 'failed', error: 'Veo reported the operation done but returned no video.' }
      }
      return { id: taskId, status: 'succeeded', videoUrl: uri }
    },

    async download(task: VideoTask): Promise<VideoDownload> {
      if (!task.videoUrl) {
        throw new Error(`Veo operation ${task.id} succeeded but carried no video uri.`)
      }
      const url = sameOrigin(task.videoUrl, base)
        ? `${task.videoUrl}${task.videoUrl.includes('?') ? '&' : '?'}key=${cfg.apiKey}`
        : task.videoUrl
      const response = await doFetch(url, { method: 'GET' })
      if (!response.ok) {
        throw new Error(`Veo video download failed (${response.status}) for operation ${task.id}`)
      }
      return { data: new Uint8Array(await response.arrayBuffer()), mediaType: 'video/mp4' }
    },
  }
}
