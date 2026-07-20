import { randomUUID } from 'crypto'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { insertMediaGeneration } from '../db-media-generations'
import { mediaGenOutputDir } from './paths'
import { resolveMediaProvider } from './providers'
import { generateMedia } from './service'
import type { ReferenceImage, SavedImage } from './types'

export interface GenerateAndRecordParams {
  providerId: string
  model: string
  prompt: string
  referenceImages?: ReferenceImage[]
  mask?: Uint8Array | string
  size?: string
  aspectRatio?: string
  n?: number
  providerOptions?: ProviderOptions
  sessionId?: string
  projectId?: string
  source: 'agent' | 'human'
  abortSignal?: AbortSignal
}

export interface GenerateAndRecordResult {
  generationId: string
  images: SavedImage[]
  warnings: unknown[]
}

export async function generateAndRecord(params: GenerateAndRecordParams): Promise<GenerateAndRecordResult> {
  const provider = await resolveMediaProvider(params.providerId)
  const generationId = randomUUID()
  const createdAt = new Date().toISOString()
  const paramsJson = JSON.stringify({
    size: params.size,
    aspectRatio: params.aspectRatio,
    n: params.n,
    edited: !!params.referenceImages?.length,
  })

  try {
    const result = await generateMedia(
      {
        provider,
        model: params.model,
        prompt: params.prompt,
        referenceImages: params.referenceImages,
        mask: params.mask,
        size: params.size,
        aspectRatio: params.aspectRatio,
        n: params.n,
        providerOptions: params.providerOptions,
        abortSignal: params.abortSignal,
      },
      { outputDir: mediaGenOutputDir(params.sessionId), generationId },
    )

    insertMediaGeneration({
      id: generationId,
      session_id: params.sessionId ?? null,
      project_id: params.projectId ?? null,
      source: params.source,
      provider_id: params.providerId,
      model: params.model,
      media_type: 'image',
      prompt: params.prompt,
      params_json: paramsJson,
      warnings_json: JSON.stringify(result.warnings),
      result_paths_json: JSON.stringify(result.images.map((image) => image.path)),
      status: 'succeeded',
      error: null,
      created_at: createdAt,
      upstream_task_id: null,
    })

    return { generationId, images: result.images, warnings: result.warnings }
  } catch (error) {
    insertMediaGeneration({
      id: generationId,
      session_id: params.sessionId ?? null,
      project_id: params.projectId ?? null,
      source: params.source,
      provider_id: params.providerId,
      model: params.model,
      media_type: 'image',
      prompt: params.prompt,
      params_json: paramsJson,
      warnings_json: '[]',
      result_paths_json: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      created_at: createdAt,
      upstream_task_id: null,
    })
    throw error
  }
}
