/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AttachmentOriginalStatus } from '@superone/shared/agent-types'

const f = vi.hoisted(() => ({ downscaled: true, prepare: vi.fn(), toast: vi.fn() }))
vi.mock('./image-compress', () => ({
  downscaleImage: async (file: File) => ({ attachment: { name: file.name, mimeType: 'image/png', base64: 'QUJD' }, downscaled: f.downscaled }),
  base64ToFile: (base64: string, type: string, name: string) => new File([base64], name, { type }),
}))
vi.mock('./media-composer/prepare-media-target', () => ({ prepareMediaTarget: f.prepare }))
vi.mock('sonner', () => ({ toast: { error: f.toast } }))
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { buildChatImage, originalPending, useOriginalUploads, waitForOriginals } from './attachment-originals'

const previous = useChatStore.getState()
const app = { getPathForFile: vi.fn(() => ''), stageAttachmentOriginal: vi.fn(), attachmentOriginalStatus: vi.fn(), retryAttachmentOriginal: vi.fn() }
const local = { projectPath: '/repo', sessionId: 'local' }
const remote = { projectPath: 'remote:node:/repo', sessionId: 'draft' }
const file = () => new File(['big'], 'photo.png', { type: 'image/png' })

beforeEach(() => {
  vi.clearAllMocks()
  f.downscaled = true
  Object.assign(window, { app })
  app.stageAttachmentOriginal.mockImplementation(async ({ sessionId }: { sessionId: string }) => ({ path: `/staged/${sessionId}/photo.png` }))
  app.attachmentOriginalStatus.mockImplementation(async (paths: string[]) => Object.fromEntries(paths.map(path => [path, { state: 'ready' }])))
  useOriginalUploads.setState({ statuses: {} })
  useChatStore.setState({ activeProject: local.projectPath, projectSessions: {
    [local.projectPath]: { ...createDefaultProjectState(), _activeSessionId: local.sessionId, _sessions: { [local.sessionId]: createDefaultPerSessionState() } },
  } })
})
afterEach(() => useChatStore.setState(previous))

it('keeps no separate original for an image the agent sees unchanged', async () => {
  f.downscaled = false
  expect((await buildChatImage(file(), local))!.attachment.originalPath).toBeUndefined()
  expect(app.stageAttachmentOriginal).not.toHaveBeenCalled()
})

it('stages the file on disk for a local session without re-reading it', async () => {
  const image = await buildChatImage(file(), local, '/Users/me/photo.png')
  expect(app.stageAttachmentOriginal).toHaveBeenCalledWith(expect.objectContaining({ ...local, sourcePath: '/Users/me/photo.png' }))
  expect(image).toEqual({ attachment: expect.objectContaining({ originalPath: '/staged/local/photo.png' }), target: local })
})

it('gives a remote draft its node session first and follows the new id', async () => {
  f.prepare.mockResolvedValue({ ...remote, sessionId: 'node-session' })
  const image = await buildChatImage(file(), remote)
  expect(app.stageAttachmentOriginal).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'node-session', bytes: expect.any(Uint8Array) }))
  expect(image!.target).toEqual({ ...remote, sessionId: 'node-session' })
})

it('does not attach an image whose original cannot be kept, and says so', async () => {
  app.stageAttachmentOriginal.mockRejectedValue(new Error('disk full'))
  expect(await buildChatImage(file(), local)).toBeNull()
  expect(f.toast).toHaveBeenCalledWith(expect.any(String), { description: 'disk full' })
})

it('holds an attachment until its original is ready, and fails the wait when the upload fails', async () => {
  const statuses: Record<string, AttachmentOriginalStatus> = { '/a': { state: 'uploading', progress: 0.5 } }
  expect(originalPending({ name: 'a', mimeType: 'image/png', base64: '', originalPath: '/a' }, statuses)).toBe(true)
  expect(originalPending({ name: 'a', mimeType: 'image/png', base64: '' }, statuses)).toBe(false)

  await expect(waitForOriginals(['/ready'])).resolves.toBeUndefined()
  app.attachmentOriginalStatus.mockResolvedValue({ '/broken': { state: 'failed', retryable: true } })
  await expect(waitForOriginals(['/broken'])).rejects.toThrow()
})
