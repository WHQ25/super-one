import { randomUUID } from 'crypto'
import {
  getMediaGeneration,
  insertMediaGeneration,
  updateMediaGeneration,
  type MediaGenerationStatus,
} from '../../db-media-generations'
import { mediaGenOutputDir } from '../paths'
import { resolveVideoProvider } from '../providers'
import { generateVideoMedia, type GenerateVideoCoreParams } from './service'

export interface SubmitVideoParams
  extends Omit<GenerateVideoCoreParams, 'provider' | 'model' | 'abortSignal'> {
  providerId: string
  model: string
  sessionId?: string
  projectId?: string
  source: 'agent' | 'human'
}

export interface VideoGenerationState {
  generationId: string
  status: MediaGenerationStatus
  savedPaths: string[]
  warnings: unknown[]
  error: string | null
}

interface RunningJob {
  abort: AbortController
  warnings: unknown[]
}

/**
 * Jobs still running in this process. The DB row is the durable record; this map only adds the
 * ability to cancel and to carry warnings that are not worth a column. A row marked `running`
 * with no entry here means the process restarted mid-generation — see `readVideoGeneration`.
 */
const running = new Map<string, RunningJob>()

/**
 * Start a video generation and return as soon as it is recorded — the job keeps running in the
 * background.
 *
 * The SDK's `generateVideo` blocks until the video is ready, which would pin a tool call open for
 * minutes. Submitting here and polling through `readVideoGeneration` keeps the agent free to work
 * while the video renders, without the provider adapters needing any notion of a two-phase call.
 */
export async function submitVideoGeneration(params: SubmitVideoParams): Promise<string> {
  const provider = await resolveVideoProvider(params.providerId)
  const generationId = randomUUID()
  const abort = new AbortController()

  insertMediaGeneration({
    id: generationId,
    session_id: params.sessionId ?? null,
    project_id: params.projectId ?? null,
    source: params.source,
    provider_id: params.providerId,
    model: params.model,
    media_type: 'video',
    prompt: params.prompt,
    params_json: JSON.stringify({
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      duration: params.duration,
      fps: params.fps,
      seed: params.seed,
      generateAudio: params.generateAudio,
      frames: params.frameImages?.map((f) => f.frameType),
      references: params.inputReferences?.length ?? 0,
    }),
    warnings_json: '[]',
    result_paths_json: null,
    status: 'running',
    error: null,
    created_at: new Date().toISOString(),
  })

  running.set(generationId, { abort, warnings: [] })

  void generateVideoMedia(
    { ...params, provider, model: params.model, abortSignal: abort.signal },
    { outputDir: mediaGenOutputDir(params.sessionId), generationId },
  )
    .then((result) => {
      updateMediaGeneration(generationId, {
        status: 'succeeded',
        resultPaths: result.images.map((video) => video.path),
        warnings: result.warnings,
      })
    })
    .catch((error: unknown) => {
      updateMediaGeneration(generationId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => {
      running.delete(generationId)
    })

  return generationId
}

/**
 * Read the current state of a generation.
 *
 * A row still marked `running` with no live job behind it can only mean the app restarted while the
 * video was rendering. That is reported as a failure rather than left polling forever — the upstream
 * task may well have finished, but nothing in this process is going to collect it.
 */
export function readVideoGeneration(generationId: string): VideoGenerationState | null {
  const row = getMediaGeneration(generationId)
  if (!row) return null

  if (row.status === 'running' && !running.has(generationId)) {
    const error = 'Generation was interrupted by an app restart. Submit the request again.'
    updateMediaGeneration(generationId, { status: 'failed', error })
    return { generationId, status: 'failed', savedPaths: [], warnings: [], error }
  }

  return {
    generationId,
    status: row.status,
    savedPaths: row.resultPaths,
    warnings: running.get(generationId)?.warnings ?? [],
    error: row.error,
  }
}

/** Cancel a running generation. Returns false when there is nothing in flight to cancel. */
export function cancelVideoGeneration(generationId: string): boolean {
  const job = running.get(generationId)
  if (!job) return false
  job.abort.abort()
  return true
}
