import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaComposerRequest } from '@superone/shared/media-composer'

const f = vi.hoisted(() => ({ models: vi.fn(), image: vi.fn(), video: vi.fn(), status: vi.fn(), get: vi.fn(), list: vi.fn() }))
vi.mock('./composer-models', () => ({ mediaComposerModels: f.models }))
vi.mock('./history', () => ({ generateAndRecord: f.image }))
vi.mock('./video/history', () => ({ submitVideoGeneration: f.video, readVideoGeneration: f.status }))
vi.mock('../db-media-generations', () => ({ getMediaGeneration: f.get, listMediaGenerations: f.list }))
import { generateComposerMedia, composerVideoStatus, pendingComposerVideos } from './composer-service'

const target = { projectPath: '/repo', sessionId: 'session-a' }
const request: MediaComposerRequest = { ...target, requestId: 'request-a', kind: 'image', providerId: 'key', model: 'image-model', prompt: ' Draw a tree ' }
beforeEach(() => {
  vi.resetAllMocks()
  f.models.mockReturnValue([{ providerId: 'key', model: 'image-model' }, { providerId: 'key', model: 'video-model' }])
  f.image.mockResolvedValue({ generationId: 'image-result', images: [{ path: '/image.png', mediaType: 'image/png', base64: 'aGVsbG8=' }], warnings: [] })
  f.video.mockResolvedValue('video-result')
  f.get.mockReturnValue({ sessionId: target.sessionId, projectId: target.projectPath, source: 'human', mediaType: 'video' })
  f.status.mockResolvedValue({ status: 'running', savedPaths: [], error: null })
})
describe('native media generation', () => {
  it('records the owning session and human source and forwards cancellation', async () => {
    const controller = new AbortController()
    const result = await generateComposerMedia(request, controller.signal)
    expect(f.image).toHaveBeenCalledWith(expect.objectContaining({ source: 'human', sessionId: target.sessionId, projectId: '/repo', prompt: 'Draw a tree', abortSignal: controller.signal, model: 'image-model' }))
    expect(result.files[0]).toEqual({ path: '/image.png', agentPath: '/image.png', mediaType: 'image/png', base64: 'aGVsbG8=' })
  })
  it('rejects a disabled or changed model rather than falling back to another credential', async () => {
    await expect(generateComposerMedia({ ...request, providerId: 'deleted' }, new AbortController().signal)).rejects.toThrow('no longer enabled')
    expect(f.image).not.toHaveBeenCalled()
  })
  it.each([{ size: 'huge' }, { duration: 0 }, { aspectRatio: 'oops' }, { sessionId: '../other' }, { references: [{ name: 'a', mediaType: 'text/plain', base64: 'aGVsbG8=' }] }])('rejects invalid inputs before a provider call: %j', async patch => {
    await expect(generateComposerMedia({ ...request, ...patch } as MediaComposerRequest, new AbortController().signal)).rejects.toThrow()
    expect(f.image).not.toHaveBeenCalled(); expect(f.video).not.toHaveBeenCalled()
  })
  it('does not submit a request aborted before generation', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(generateComposerMedia(request, controller.signal)).rejects.toThrow()
    expect(f.image).not.toHaveBeenCalled()
  })
  it('submits video frame roles and references and returns a durable pending handle', async () => {
    const result = await generateComposerMedia({ ...request, kind: 'video', model: 'video-model', references: [
      { name: 'frame', mediaType: 'image/png', base64: 'aGVsbG8=', role: 'first' },
      { name: 'ref', mediaType: 'image/png', base64: 'aGVsbG8=' },
    ] }, new AbortController().signal)
    expect(f.video).toHaveBeenCalledWith(expect.objectContaining({ source: 'human', frameImages: [{ frameType: 'first_frame', image: Buffer.from('hello') }], inputReferences: [Buffer.from('hello')] }))
    expect(result).toEqual({ generationId: 'video-result', kind: 'video', status: 'running', files: [] })
  })
  it('requires matching project, session and human video source before polling', async () => {
    for (const patch of [{ sessionId: 'other' }, { projectId: 'remote:node:/repo' }, { source: 'agent' }, { mediaType: 'image' }]) {
      f.get.mockReturnValue({ ...f.get(), ...patch })
      await expect(composerVideoStatus(target, 'video')).rejects.toThrow('does not belong')
    }
    expect(f.status).not.toHaveBeenCalled()
  })
  it('restores only unfinished human videos for this exact project/session', () => {
    const row = { id: 'a', projectId: '/repo', source: 'human', mediaType: 'video', status: 'running' }
    f.list.mockReturnValue([row, { ...row, id: 'b', source: 'agent' }, { ...row, id: 'c', projectId: 'remote:node:/repo' }, { ...row, id: 'd', status: 'succeeded' }])
    expect(pendingComposerVideos(target).map(result => result.generationId)).toEqual(['a'])
  })
})
