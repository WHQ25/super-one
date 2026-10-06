import type { MediaComposerRequest, MediaComposerResult, MediaComposerTarget } from '@superone/shared/media-composer'
import { getMediaGeneration, listMediaGenerations } from '../db-media-generations'
import { mediaComposerModels } from './composer-models'
import { generateAndRecord } from './history'
import { readVideoGeneration, submitVideoGeneration } from './video/history'
import { arkVideoProviderOptions } from './video/service'

export function validateMediaTarget(target: MediaComposerTarget): void {
  if (!target || typeof target.projectPath !== 'string' || !target.projectPath ||
    typeof target.sessionId !== 'string' || !/^[\w-]{1,128}$/.test(target.sessionId)) throw new Error('Invalid media session')
}

export function validateMediaRequest(request: MediaComposerRequest): void {
  validateMediaTarget(request)
  if (typeof request.requestId !== 'string' || !/^[\w-]{1,128}$/.test(request.requestId)) throw new Error('Invalid request id')
  if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 32_000) throw new Error('Invalid prompt')
  if (!mediaComposerModels(request.kind).some(m => m.providerId === request.providerId && m.model === request.model)) {
    throw new Error('The selected media model is no longer enabled. Check Settings → Providers.')
  }
  if (request.size && !/^(\d{2,5}x\d{2,5}|[124]K)$/.test(request.size)) throw new Error('Invalid image size')
  if (request.aspectRatio && !/^\d{1,3}:\d{1,3}$/.test(request.aspectRatio)) throw new Error('Invalid aspect ratio')
  if (request.duration !== undefined && (!Number.isInteger(request.duration) || request.duration < 1 || request.duration > 120)) throw new Error('Invalid duration')
  if (request.resolution && !/^\d{2,5}x\d{2,5}$/.test(request.resolution)) throw new Error('Invalid resolution')
  if (request.seed !== undefined && (!Number.isSafeInteger(request.seed) || request.seed < 0)) throw new Error('Invalid seed')
  for (const flag of [request.generateAudio, request.watermark, request.cameraFixed]) {
    if (flag !== undefined && typeof flag !== 'boolean') throw new Error('Invalid video option')
  }
  const refs = request.references ?? []
  if (!Array.isArray(refs) || refs.length > 8) throw new Error('Too many reference images')
  let bytes = 0
  for (const ref of refs) {
    if (!ref || typeof ref.base64 !== 'string' || !ref.base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(ref.base64) ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(ref.mediaType) ||
      (ref.role !== undefined && !['reference', 'first', 'last'].includes(ref.role))) throw new Error('Invalid reference image')
    bytes += ref.base64.length
  }
  if (bytes > 32 * 1024 * 1024) throw new Error('Reference images exceed 24 MB')
  for (const role of ['first', 'last']) if (refs.filter(ref => ref.role === role).length > 1) throw new Error('Duplicate frame image')
}

export async function generateComposerMedia(request: MediaComposerRequest, signal: AbortSignal): Promise<MediaComposerResult> {
  validateMediaRequest(request)
  signal.throwIfAborted()
  const common = { providerId: request.providerId, model: request.model, prompt: request.prompt.trim(),
    sessionId: request.sessionId, projectId: request.projectPath, source: 'human' as const, abortSignal: signal,
    aspectRatio: request.aspectRatio || undefined }
  if (request.kind === 'image') {
    const result = await generateAndRecord({ ...common, size: request.size || undefined,
      referenceImages: request.references?.map(ref => ({ mediaType: ref.mediaType, data: Buffer.from(ref.base64, 'base64') })) })
    return { generationId: result.generationId, kind: 'image', status: 'succeeded', files: result.images.map(image => ({
      path: image.path, agentPath: image.path, mediaType: image.mediaType, base64: image.base64,
    })) }
  }
  const refs = request.references ?? []
  const providerOptions = arkVideoProviderOptions({ watermark: request.watermark, cameraFixed: request.cameraFixed })
  const generationId = await submitVideoGeneration({ ...common, duration: request.duration,
    resolution: request.resolution || undefined, seed: request.seed, generateAudio: request.generateAudio,
    ...(providerOptions ? { providerOptions } : {}),
    frameImages: refs.filter(ref => ref.role === 'first' || ref.role === 'last').map(ref => ({
      frameType: ref.role === 'first' ? 'first_frame' : 'last_frame', image: Buffer.from(ref.base64, 'base64'),
    })),
    inputReferences: refs.filter(ref => !ref.role || ref.role === 'reference').map(ref => Buffer.from(ref.base64, 'base64')),
  })
  // Always return a submitted handle, even if cancellation raced the upstream acknowledgement.
  return { generationId, kind: 'video', status: 'running', files: [] }
}

export function assertVideoOwner(target: MediaComposerTarget, id: string): void {
  validateMediaTarget(target)
  const row = getMediaGeneration(id)
  if (!row || row.sessionId !== target.sessionId || row.projectId !== target.projectPath || row.source !== 'human' || row.mediaType !== 'video') {
    throw new Error('Video generation does not belong to this session')
  }
}

export async function composerVideoStatus(target: MediaComposerTarget, id: string): Promise<MediaComposerResult> {
  assertVideoOwner(target, id)
  const state = await readVideoGeneration(id)
  if (!state) throw new Error('Video generation no longer exists')
  return { generationId: id, kind: 'video', status: state.status,
    files: state.savedPaths.map(path => ({ path, agentPath: path, mediaType: 'video/mp4' })), error: state.error ?? undefined }
}

export function pendingComposerVideos(target: MediaComposerTarget): MediaComposerResult[] {
  validateMediaTarget(target)
  return listMediaGenerations({ sessionId: target.sessionId, projectId: target.projectPath, mediaType: 'video', source: 'human', status: 'running' }).filter(row =>
    row.projectId === target.projectPath && row.source === 'human' && row.mediaType === 'video' && row.status === 'running'
  ).map(row => ({ generationId: row.id, kind: 'video', status: 'running', files: [] }))
}
