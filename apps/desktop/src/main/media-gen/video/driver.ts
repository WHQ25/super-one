import type { SharedV4Warning } from '@ai-sdk/provider'
import type { VideoTask } from './ark/response'
import type { VideoModelV4CallOptions } from './sdk-types'

export interface VideoSubmission {
  /** The provider's own handle for the job. Persisted, and the only input `fetch` needs. */
  taskId: string
  warnings: SharedV4Warning[]
}

export interface VideoDownload {
  data: Uint8Array
  mediaType: string
}

/**
 * A video job split into the three steps a request actually consists of, replacing the SDK's atomic
 * `doGenerate`.
 *
 * `doGenerate` submits, polls to completion, and downloads in one call, which forces the caller to
 * keep a live in-process job for the whole render — minutes during which an app restart loses a paid
 * task, and during which a single misread status is terminal because nothing ever asks again.
 * Splitting the steps lets the agent's own `media_video_status` call drive one request at a time:
 * nothing runs between calls, so there is no in-memory state to lose and every fetch is a fresh
 * chance to read the status correctly.
 *
 * `fetch` therefore MUST issue exactly one request and return what it saw — no looping, no waiting,
 * no timeout. Deciding whether to ask again is the caller's business, not the driver's.
 */
export interface VideoTaskDriver {
  readonly provider: string
  readonly modelId: string
  submit(options: VideoModelV4CallOptions): Promise<VideoSubmission>
  fetch(taskId: string): Promise<VideoTask>
  download(task: VideoTask): Promise<VideoDownload>
}
