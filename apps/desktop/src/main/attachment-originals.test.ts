import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentIpcChannels } from '@superone/shared/agent-types'

const f = vi.hoisted(() => ({ root: '', session: vi.fn(), wake: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => f.root }, ipcMain: { handle: vi.fn() } }))
vi.mock('./database', async () => (await import('../test/fixtures/delivery-db')).deliveryDatabase())
vi.mock('./environment/environment-host', () => ({ getEnvironmentHost: () => ({ getSession: f.session, artifactTransfers: { wake: f.wake } }) }))
import { advanceDelivery, claimDelivery, findDeliveryByPath } from './db-session-deliveries'
import { attachmentOriginalStatus, nodeAttachmentOriginal, stageAttachmentOriginal } from './attachment-originals'
import { mintHolder } from './environment/delivery-holders'
import { resetDeliveryDatabase } from '../test/fixtures/delivery-db'

const previousAttachmentsDir = process.env.SUPERONE_ATTACHMENTS_DIR
const bytes = new Uint8Array(Buffer.from('full-size image'))
const zone = { syncRoot: '/node/sync', os: 'linux' as const }

beforeEach(() => {
  vi.clearAllMocks(); resetDeliveryDatabase()
  f.root = mkdtempSync(join(tmpdir(), 'attachment-originals-'))
  process.env.SUPERONE_ATTACHMENTS_DIR = join(f.root, 'attachments')
  f.session.mockResolvedValue({ projectId: 'project' })
})
afterEach(() => {
  if (previousAttachmentsDir === undefined) delete process.env.SUPERONE_ATTACHMENTS_DIR
  else process.env.SUPERONE_ATTACHMENTS_DIR = previousAttachmentsDir
  rmSync(f.root, { recursive: true, force: true })
})

it('keeps a local original where it is, or beside the turn attachments when pasted', async () => {
  const source = join(f.root, 'photo.png')
  writeFileSync(source, bytes)
  const request = { projectPath: '/repo', sessionId: 'local', name: 'photo.png', mimeType: 'image/png' }
  expect(await stageAttachmentOriginal({ ...request, sourcePath: source })).toEqual({ path: source })
  const pasted = await stageAttachmentOriginal({ ...request, bytes })
  expect(pasted.path.startsWith(join(f.root, 'attachments'))).toBe(true)
  expect(attachmentOriginalStatus(pasted.path)).toEqual({ state: 'ready' })
  rmSync(source)
  expect(attachmentOriginalStatus(source)).toEqual({ state: 'failed', retryable: false })
})

it('stages a remote original as a silent delivery and maps it to the node once it lands', async () => {
  const { path } = await stageAttachmentOriginal({ projectPath: 'remote:node:/repo', sessionId: 'remote-session', name: 'photo.png', mimeType: 'image/png', bytes })
  expect(path).toContain(join('sync', 'remote-session', 'attachment'))
  expect(readFileSync(path)).toEqual(Buffer.from(bytes))
  const row = findDeliveryByPath('remote-session', path)!
  expect(row).toMatchObject({ origin: 'attachment', phase: 'sealed', connectionId: 'node' })
  expect(f.wake).toHaveBeenCalledWith('node')
  expect(attachmentOriginalStatus(path)).toEqual({ state: 'uploading', progress: 0 })
  expect(() => nodeAttachmentOriginal('remote-session', path, zone)).toThrow('still uploading')

  const claimed = claimDelivery(row.deliveryId, { holder: null, epoch: row.epoch }, mintHolder())
  if (!claimed.ok) throw new Error('claim failed')
  let handle = claimed.handle
  for (const [from, to] of [['sealed', 'uploading'], ['uploading', 'committing'], ['committing', 'uploaded']] as const) {
    const step = advanceDelivery(handle, { from, to })
    if (!step.ok) throw new Error(`advance ${from} failed`)
    handle = step.handle
  }
  expect(attachmentOriginalStatus(path)).toEqual({ state: 'ready' })
  expect(nodeAttachmentOriginal('remote-session', path, zone)).toMatch(/^\/node\/sync\/remote-session\/attachment\/.+-photo\.png$/)
  expect(() => nodeAttachmentOriginal('other-session', path, zone)).toThrow('another session')
})

it('treats a remote zone file with no delivery as one that will never reach the node', async () => {
  const { path } = await stageAttachmentOriginal({ projectPath: 'remote:node:/repo', sessionId: 'remote-session', name: 'photo.png', mimeType: 'image/png', bytes })
  const stray = join(path, '..', 'stray.png')
  writeFileSync(stray, bytes)
  expect(attachmentOriginalStatus(stray)).toEqual({ state: 'failed', retryable: false })
  expect(() => nodeAttachmentOriginal('remote-session', stray, zone)).toThrow('still uploading')
})

it('refuses to stage into a remote session the node does not have', async () => {
  f.session.mockResolvedValue(null)
  await expect(stageAttachmentOriginal({ projectPath: 'remote:node:/repo', sessionId: 'draft', name: 'photo.png', mimeType: 'image/png', bytes }))
    .rejects.toThrow('does not exist')
  expect(existsSync(join(f.root, 'sync', 'draft', 'attachment'))).toBe(false)
})

it('registers its channels', async () => {
  const { ipcMain } = await import('electron')
  const { registerAttachmentOriginalsIpc } = await import('./attachment-originals')
  registerAttachmentOriginalsIpc()
  expect(vi.mocked(ipcMain.handle).mock.calls.map(([channel]) => channel)).toEqual([
    AgentIpcChannels.STAGE_ATTACHMENT_ORIGINAL, AgentIpcChannels.ATTACHMENT_ORIGINAL_STATUS, AgentIpcChannels.RETRY_ATTACHMENT_ORIGINAL,
  ])
})
