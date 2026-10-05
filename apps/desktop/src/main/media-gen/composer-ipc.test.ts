import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MediaComposerRequest, MediaComposerResult } from '@superone/shared/media-composer'
import { MediaComposerChannels as channels } from '@superone/shared/media-composer'

const f = vi.hoisted(() => ({ root: '', handlers: new Map<string, (...args: any[]) => any>(), generate: vi.fn(), status: vi.fn(), pending: vi.fn(), remoteSession: vi.fn(), put: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => f.root }, ipcMain: { handle: (id: string, handler: (...args: any[]) => any) => f.handlers.set(id, handler) } }))
vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())
vi.mock('./composer-service', () => ({ validateMediaTarget: vi.fn(), generateComposerMedia: f.generate, composerVideoStatus: f.status, pendingComposerVideos: f.pending }))
vi.mock('../environment/environment-host', () => ({ getEnvironmentHost: () => ({
  getSession: f.remoteSession, getRemoteProjectPath: async () => '/repo',
  getSyncZone: () => ({ syncRoot: '/node/sync', os: 'linux' }),
  artifactTransfers: { throughputBytesPerMs: () => 1024, recordThroughput: vi.fn(), wake: vi.fn() },
  artifactPut: f.put,
}) }))
import { registerMediaComposerIpc } from './composer-ipc'
import { mediaGenOutputDir } from './paths'
import { resetDeliveryDatabase } from '../../test/fixtures/delivery-db'

const request: MediaComposerRequest = { projectPath: '/repo', sessionId: 'media-session', requestId: 'request', kind: 'image', providerId: 'key', model: 'image', prompt: 'Tree' }
const sender = (id: number) => Object.assign(new EventEmitter(), { id })
const invoke = (channel: string, owner: ReturnType<typeof sender>, ...args: unknown[]) => f.handlers.get(channel)!({ sender: owner }, ...args)
beforeEach(() => {
  vi.clearAllMocks(); resetDeliveryDatabase(); f.handlers.clear()
  f.root = mkdtempSync(join(tmpdir(), 'media-composer-'))
  f.remoteSession.mockResolvedValue({ projectId: 'project' })
  f.put.mockImplementation(async (_id, input) => ({ ok: true, bytesWritten: Buffer.from(input.chunk, 'base64').length, mtimeMs: 1 }))
  registerMediaComposerIpc(() => null)
})
afterEach(() => rmSync(f.root, { recursive: true, force: true }))

it('cancels only requests belonging to the invoking window', async () => {
  const first = sender(1), second = sender(2)
  let signal: AbortSignal | undefined
  f.generate.mockImplementation((_request, incoming: AbortSignal) => new Promise((_resolve, reject) => {
    signal = incoming; incoming.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  const work = invoke(channels.generate, first, request)
  const outcome = expect(work).rejects.toThrow('aborted')
  await vi.waitFor(() => expect(signal).toBeDefined())
  await invoke(channels.cancel, second, request.requestId); expect(signal!.aborted).toBe(false)
  await invoke(channels.cancel, first, request.requestId); await outcome
})
it('aborts an in-flight request when its window is destroyed', async () => {
  const owner = sender(3)
  f.generate.mockImplementation((_request, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))
  const work = invoke(channels.generate, owner, request)
  const outcome = expect(work).rejects.toThrow('aborted')
  await vi.waitFor(() => expect(f.generate).toHaveBeenCalled())
  owner.emit('destroyed'); await outcome
})
it('delivers remote files through the real sync zone while keeping desktop previews', async () => {
  f.generate.mockImplementation(async (): Promise<MediaComposerResult> => {
    const dir = mediaGenOutputDir(request.sessionId); mkdirSync(dir, { recursive: true })
    const path = join(dir, 'image.png'); writeFileSync(path, 'image bytes')
    return { generationId: 'image', kind: 'image', status: 'succeeded', files: [{ path, agentPath: path, mediaType: 'image/png' }] }
  })
  const result = await invoke(channels.generate, sender(4), { ...request, projectPath: 'remote:node:/repo' })
  expect(f.remoteSession).toHaveBeenCalledWith('node', request.sessionId)
  expect(f.put).toHaveBeenCalledWith('node', expect.objectContaining({ sessionId: request.sessionId, relativePath: 'media-gen/image.png' }))
  expect(result.files[0].path).toContain(f.root)
  expect(result.files[0].agentPath).toBe('/node/sync/media-session/media-gen/image.png')
})
it('rejects local and remote project/session mismatches', async () => {
  registerMediaComposerIpc(() => ({ projectPath: '/other' }) as never)
  await expect(invoke(channels.generate, sender(5), request)).rejects.toThrow('another project')
  f.remoteSession.mockResolvedValue({ projectId: 'project' })
  await expect(invoke(channels.generate, sender(5), { ...request, projectPath: 'remote:node:/other' })).rejects.toThrow('does not belong')
  expect(f.generate).not.toHaveBeenCalled()
})
it('coalesces concurrent status checks so a completed video is not downloaded twice', async () => {
  let resolve!: (result: MediaComposerResult) => void
  f.status.mockImplementation(() => new Promise(done => { resolve = done }))
  const owner = sender(6)
  const first = invoke(channels.videoStatus, owner, request, 'video')
  const second = invoke(channels.videoStatus, owner, request, 'video')
  await vi.waitFor(() => expect(f.status).toHaveBeenCalledTimes(1))
  resolve({ generationId: 'video', kind: 'video', status: 'running', files: [] })
  await Promise.all([first, second])
})
