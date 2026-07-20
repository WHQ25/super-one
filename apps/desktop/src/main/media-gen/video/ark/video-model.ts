import { collectHeaders, definedHeaders, readJson } from '../../http'
import type { VideoModelV4, VideoModelV4CallOptions, VideoModelV4Result } from '../sdk-types'
import { pollUntilDone, type PollOptions } from '../poll'
import { buildArkVideoRequest } from './request'
import { parseArkVideoTask, type VideoTask } from './response'

export interface ArkVideoModelConfig {
  provider: string
  baseURL: string
  apiKey: string
  fetch?: typeof globalThis.fetch
  poll?: PollOptions
}

interface ArkSubmitResponse {
  id?: string
  error?: { message?: string }
}

/**
 * Native Volcengine Ark video model (Seedance).
 *
 * Ark is asynchronous — submit returns a task id and the result URL only appears minutes later — so
 * the whole submit/poll/return cycle is folded into one `doGenerate`, which is the shape the SDK's
 * `experimental_generateVideo` expects. The returned URL expires 24h after success, so callers must
 * download promptly; that is the storage layer's job, not this adapter's.
 */
export function createArkVideoModel(cfg: ArkVideoModelConfig, modelId: string): VideoModelV4 {
  const base = cfg.baseURL.replace(/\/+$/, '')
  const tasksUrl = `${base}/contents/generations/tasks`
  const doFetch = cfg.fetch ?? globalThis.fetch

  function headers(options: VideoModelV4CallOptions): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
      ...definedHeaders(options.headers),
    }
  }

  return {
    specificationVersion: 'v4',
    provider: cfg.provider,
    modelId,
    maxVideosPerCall: 1,
    async doGenerate(options: VideoModelV4CallOptions): Promise<VideoModelV4Result> {
      const { body, warnings } = buildArkVideoRequest(modelId, options)

      const submitResponse = await doFetch(tasksUrl, {
        method: 'POST',
        headers: headers(options),
        body: JSON.stringify(body),
        ...(options.abortSignal ? { signal: options.abortSignal } : {}),
      })
      const submitted = await readJson<ArkSubmitResponse>(submitResponse, 'Ark')

      if (!submitResponse.ok || !submitted.id) {
        throw new Error(
          `Ark video submission failed (${submitResponse.status}): ${submitted.error?.message ?? 'no task id returned'}`,
        )
      }

      const taskUrl = `${tasksUrl}/${submitted.id}`
      const check = async (): Promise<VideoTask> => {
        const response = await doFetch(taskUrl, {
          method: 'GET',
          headers: headers(options),
          ...(options.abortSignal ? { signal: options.abortSignal } : {}),
        })
        const raw = await readJson<Parameters<typeof parseArkVideoTask>[0]>(response, 'Ark')
        if (!response.ok) {
          throw new Error(`Ark task lookup failed (${response.status}): ${raw.error?.message ?? submitted.id}`)
        }
        return parseArkVideoTask(raw)
      }

      const task = await pollUntilDone(check, { ...cfg.poll, abortSignal: options.abortSignal })
      if (task.status !== 'succeeded' || !task.videoUrl) {
        throw new Error(`Ark video generation ${task.status}: ${task.error ?? 'no details'}`)
      }

      return {
        videos: [{ type: 'url', url: task.videoUrl, mediaType: 'video/mp4' }],
        warnings,
        response: {
          timestamp: new Date(),
          modelId,
          headers: collectHeaders(submitResponse.headers),
        },
        providerMetadata: { ark: { taskId: submitted.id } },
      }
    },
  }
}
