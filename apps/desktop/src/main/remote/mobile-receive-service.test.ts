vi.mock('../logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import { mkdtempSync, mkdirSync, rmSync, realpathSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileReceiveService, type MobileReceiveServiceDeps } from './mobile-receive-service'

let workspace: string
let projectRoot: string

beforeAll(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'mobile-receive-test-')))
  projectRoot = join(workspace, 'project')
  mkdirSync(projectRoot, { recursive: true })
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

function makeDeps(overrides: Partial<MobileReceiveServiceDeps> = {}): MobileReceiveServiceDeps {
  return {
    resolveTarget: () => ({ deviceId: 'dev1', projectPath: projectRoot, allowedRoots: [projectRoot] }),
    signLanUploadUrl: vi.fn(async (savedPath: string) => `http://{lanHost}:1234/files/upload/tok-for-${encodeURIComponent(savedPath)}`),
    computeRelayKey: vi.fn(async () => 'files/room/deadbeef.bin'),
    signRelayUploadUrl: vi.fn(async () => 'https://r2.example/put?sig=1'),
    downloadAndDecryptRelayFile: vi.fn(async () => Buffer.from('decrypted-bytes')),
    deleteRelayFile: vi.fn(async () => {}),
    emitProgress: vi.fn(),
    now: () => 1000,
    ...overrides,
  }
}

describe('MobileReceiveService', () => {
  let deps: MobileReceiveServiceDeps
  let service: MobileReceiveService

  beforeEach(() => {
    deps = makeDeps()
    service = new MobileReceiveService(deps)
  })

  it('writes inline bytes straight to disk and reports saved', async () => {
    const res = await service.handleUploadFile({
      requestId: 'r1', targetDir: projectRoot, name: 'note.txt', mimeType: 'text/plain', size: 5,
      inlineBase64: Buffer.from('hello').toString('base64'),
    })
    expect(res).toMatchObject({ ok: true, status: 'saved' })
    if (res.ok && res.status === 'saved') {
      expect(readFileSync(res.savedPath, 'utf8')).toBe('hello')
    }
  })

  it('returns a LAN upload url for large files when reached over LAN (no R2)', async () => {
    const res = await service.handleUploadFile({
      requestId: 'r2', targetDir: projectRoot, name: 'big.bin', mimeType: 'application/octet-stream', size: 999999,
      transport: 'lan',
    })
    expect(res.ok && res.status).toBe('need_lan_put')
    if (res.ok && res.status === 'need_lan_put') {
      expect(res.uploadUrl).toContain('/files/upload/')
    }
    expect(deps.signRelayUploadUrl).not.toHaveBeenCalled()
  })

  it('returns an R2 upload url for large files in relay mode', async () => {
    const res = await service.handleUploadFile({
      requestId: 'r3', targetDir: projectRoot, name: 'big.bin', mimeType: 'application/octet-stream', size: 999999,
    })
    expect(res.ok && res.status).toBe('need_r2_put')
    if (res.ok && res.status === 'need_r2_put') {
      expect(res.uploadUrl).toBe('https://r2.example/put?sig=1')
      expect(res.key).toBe('files/room/deadbeef.bin')
    }
  })

  it('on relay completion downloads, decrypts, writes to disk and deletes the R2 object', async () => {
    await service.handleUploadFile({
      requestId: 'r4', targetDir: projectRoot, name: 'doc.bin', mimeType: 'application/octet-stream', size: 999999,
    })
    const res = await service.handleUploadComplete({ requestId: 'r4' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(readFileSync(res.savedPath, 'utf8')).toBe('decrypted-bytes')
    }
    expect(deps.downloadAndDecryptRelayFile).toHaveBeenCalledWith('files/room/deadbeef.bin', expect.any(Function))
    expect(deps.deleteRelayFile).toHaveBeenCalledWith('files/room/deadbeef.bin')
  })

  it('deletes the R2 object even when the download fails', async () => {
    deps = makeDeps({ downloadAndDecryptRelayFile: vi.fn(async () => { throw new Error('boom') }) })
    service = new MobileReceiveService(deps)
    await service.handleUploadFile({
      requestId: 'r5', targetDir: projectRoot, name: 'doc.bin', mimeType: 'application/octet-stream', size: 999999,
    })
    const res = await service.handleUploadComplete({ requestId: 'r5' })
    expect(res.ok).toBe(false)
    expect(deps.deleteRelayFile).toHaveBeenCalledWith('files/room/deadbeef.bin')
  })

  it('rejects an upload targeting a dir outside allowed roots', async () => {
    const res = await service.handleUploadFile({
      requestId: 'r6', targetDir: join(workspace, 'outside'), name: 'x.txt', mimeType: 'text/plain', size: 3,
      inlineBase64: Buffer.from('abc').toString('base64'),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('forbidden_path')
  })

  it('emits receiving then completed progress for inline uploads', async () => {
    const emitProgress = vi.fn()
    deps = makeDeps({ emitProgress })
    service = new MobileReceiveService(deps)
    await service.handleUploadFile({
      requestId: 'p1', targetDir: projectRoot, name: 'note.txt', mimeType: 'text/plain', size: 5,
      inlineBase64: Buffer.from('hello').toString('base64'),
    })
    expect(emitProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ requestId: 'p1', status: 'receiving', transport: 'inline' }))
    expect(emitProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ requestId: 'p1', status: 'completed', receivedBytes: 5 }))
  })

  it('emits LAN progress keyed by savedPath from the lan-server callback', async () => {
    const emitProgress = vi.fn()
    deps = makeDeps({ emitProgress })
    service = new MobileReceiveService(deps)
    const res = await service.handleUploadFile({
      requestId: 'p2', targetDir: projectRoot, name: 'big.bin', mimeType: 'application/octet-stream', size: 1000,
      transport: 'lan',
    })
    expect(res.ok && res.status).toBe('need_lan_put')
    const savedPath = res.ok && res.status === 'need_lan_put' ? res.savedPath : ''
    service.handleLanUploadProgress({ savedPath, receivedBytes: 500, done: false })
    service.handleLanUploadProgress({ savedPath, receivedBytes: 1000, done: true })
    expect(emitProgress).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'p2', status: 'receiving', receivedBytes: 500, transport: 'lan' }))
    expect(emitProgress).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'p2', status: 'completed', receivedBytes: 1000 }))
    service.handleLanUploadProgress({ savedPath, receivedBytes: 1000, done: true })
    expect(emitProgress).toHaveBeenCalledTimes(3)
  })

  it('rejects when no session target resolves', async () => {
    deps = makeDeps({ resolveTarget: () => null })
    service = new MobileReceiveService(deps)
    const res = await service.handleUploadFile({
      requestId: 'r7', targetDir: projectRoot, name: 'x.txt', mimeType: 'text/plain', size: 1,
      inlineBase64: 'AA==',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('no_session')
  })
})
