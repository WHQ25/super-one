import { randomUUID } from 'crypto'
import {
  getMediaGeneration,
  insertMediaGeneration,
  updateMediaGeneration,
  type MediaGenerationStatus,
} from '../../db-media-generations'
import { mediaGenOutputDir } from '../paths'
import { resolveVideoProvider } from '../providers'
import { fetchVideoTask, persistVideoTask, submitVideoTask, type GenerateVideoCoreParams } from './service'

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

/**
 * Submit a video generation and record it.
 *
 * Nothing keeps running after this returns — no timer, no in-process job, no abort handle. The
 * provider's task id in the row is the whole continuation, which is what makes an app restart
 * survivable: `readVideoGeneration` can pick any submitted job back up whenever it is next asked.
 */
export async function submitVideoGeneration(params: SubmitVideoParams): Promise<string> {
  const provider = await resolveVideoProvider(params.providerId)
  const generationId = randomUUID()
  const { taskId, warnings } = await submitVideoTask({ ...params, provider, model: params.model })

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
    warnings_json: JSON.stringify(warnings),
    result_paths_json: null,
    status: 'running',
    error: null,
    created_at: new Date().toISOString(),
    upstream_task_id: taskId,
  })

  return generationId
}

function settle(
  generationId: string,
  patch: { status: MediaGenerationStatus; savedPaths?: string[]; error?: string | null },
): VideoGenerationState {
  updateMediaGeneration(generationId, {
    status: patch.status,
    ...(patch.savedPaths ? { resultPaths: patch.savedPaths } : {}),
    error: patch.error ?? null,
  })
  return {
    generationId,
    status: patch.status,
    savedPaths: patch.savedPaths ?? [],
    warnings: [],
    error: patch.error ?? null,
  }
}

/**
 * Read the current state of a generation, asking the provider when the answer is not settled yet.
 *
 * This call is the only thing that advances a video job, which changes what a bad read costs: a
 * status the provider does not recognise leaves the row `running` and the next call simply asks
 * again. A transport failure propagates without touching the row for the same reason — the job
 * upstream is unaffected by our inability to reach it, and writing `failed` here would discard a
 * paid render over a dropped connection.
 */
export async function readVideoGeneration(generationId: string): Promise<VideoGenerationState | null> {
  const row = getMediaGeneration(generationId)
  if (!row) return null

  const state: VideoGenerationState = {
    generationId,
    status: row.status,
    savedPaths: row.resultPaths,
    warnings: [],
    error: row.error,
  }
  if (row.status !== 'running') return state
  if (!row.upstreamTaskId) {
    return settle(generationId, { status: 'failed', error: 'Generation was recorded without a provider task id.' })
  }

  const provider = await resolveVideoProvider(row.providerId)
  const task = await fetchVideoTask(provider, row.model, row.upstreamTaskId)

  if (task.status === 'succeeded') {
    const saved = await persistVideoTask(provider, row.model, task, {
      outputDir: mediaGenOutputDir(row.sessionId ?? undefined),
      generationId,
    })
    return settle(generationId, { status: 'succeeded', savedPaths: saved.map((video) => video.path) })
  }
  if (task.status === 'failed' || task.status === 'cancelled') {
    return settle(generationId, { status: 'failed', error: task.error ?? `Video generation ${task.status}.` })
  }
  return state
}
