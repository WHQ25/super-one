import { describe, expect, it, vi } from 'vitest'
import {
  INLINE_UPLOAD_MAX_BYTES,
  MAX_UPLOAD_BYTES,
  classifyUpload,
  finishUpload,
  resolveLanUploadUrl,
  uploadBytes,
} from './attachments'
import { decryptBytesChunked, deriveKeys } from './crypto'

const MASTER = '0123456789abcdef'.repeat(8)

describe('finishUpload', () => {
  it('returns savedPath for inline saves', async () => {
    const path = await finishUpload({
      response: { ok: true, status: 'saved', savedPath: '/tmp/a.png' },
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
      put: async () => { throw new Error('should not PUT') },
      complete: async () => ({ ok: true, savedPath: '/tmp/a.png' }),
    })
    expect(path).toBe('/tmp/a.png')
    expect(classifyUpload({ ok: true, status: 'saved', savedPath: '/tmp/a.png' })).toBe('inline')
  })

  it('PUTs directly for LAN without calling relay completion', async () => {
    const puts: string[] = []
    const complete = vi.fn(async () => ({ ok: true as const, savedPath: '/tmp/b' }))
    const lan = await finishUpload({
      response: { ok: true, status: 'need_lan_put', uploadUrl: 'http://{lanHost}:7788/put', savedPath: '/tmp/b' },
      bytes: new Uint8Array([9]),
      mimeType: 'text/plain',
      lanHost: '192.0.2.2',
      put: async (url) => { puts.push(url) },
      complete,
    })
    expect(lan).toBe('/tmp/b')
    expect(puts).toEqual(['http://192.0.2.2:7788/put'])
    expect(complete).not.toHaveBeenCalled()
    expect(classifyUpload({ ok: true, status: 'need_r2_put', uploadUrl: 'https://r2', key: 'k', savedPath: '/tmp/c' })).toBe('r2')
  })
})

describe('uploadBytes transport matrix', () => {
  it('sends small files inline without PUT', async () => {
    const request = vi.fn(async () => ({ ok: true, status: 'saved', savedPath: '/p/a.txt' }))
    const put = vi.fn()
    await expect(uploadBytes({
      requestId: 'inline',
      targetDir: '/p',
      name: 'a.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('hello'),
      transport: 'relay',
      request,
      put,
    })).resolves.toBe('/p/a.txt')
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      type: 'upload_file',
      size: 5,
      inlineBase64: 'aGVsbG8=',
    }), 180_000)
    expect(put).not.toHaveBeenCalled()
  })

  it('uses raw LAN PUT and resolves the advertised host placeholder', async () => {
    const bytes = new Uint8Array(INLINE_UPLOAD_MAX_BYTES + 1).fill(7)
    const request = vi.fn(async () => ({
      ok: true,
      status: 'need_lan_put',
      uploadUrl: 'http://{lanHost}:7788/upload/token',
      savedPath: '/p/b.bin',
    }))
    const put = vi.fn(async () => ({ savedPath: '/p/b.bin' }))
    await expect(uploadBytes({
      requestId: 'lan',
      targetDir: '/p',
      name: 'b.bin',
      mimeType: 'application/octet-stream',
      bytes,
      transport: 'lan',
      lanHost: '10.0.0.8',
      request,
      put,
    })).resolves.toBe('/p/b.bin')
    expect(put).toHaveBeenCalledWith(
      'http://10.0.0.8:7788/upload/token',
      bytes,
      'application/octet-stream',
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('encrypts relay R2 bytes and completes with the same request id', async () => {
    const plain = new Uint8Array(INLINE_UPLOAD_MAX_BYTES + 1).fill(11)
    const keys = deriveKeys(MASTER)
    const request = vi.fn(async (command: { type: string }) => command.type === 'upload_file'
      ? { ok: true, status: 'need_r2_put', uploadUrl: 'https://r2.example/upload', key: 'r2-key', savedPath: '/p/c.bin' }
      : { ok: true, savedPath: '/p/c.bin' })
    let encrypted: Uint8Array<ArrayBufferLike> = new Uint8Array()
    const put = vi.fn(async (_url: string, body: Uint8Array) => { encrypted = body })
    await expect(uploadBytes({
      requestId: 'relay',
      targetDir: '/p',
      name: 'c.bin',
      mimeType: 'application/octet-stream',
      bytes: plain,
      transport: 'relay',
      aesKeyBytes: keys.aesKeyBytes,
      channelKeyHex: keys.channelKeyHex,
      request,
      put,
    })).resolves.toBe('/p/c.bin')
    expect(put).toHaveBeenCalledWith('https://r2.example/upload', expect.any(Uint8Array), 'application/octet-stream')
    expect(decryptBytesChunked(keys.aesKeyBytes, encrypted, 'r2-key', keys.channelKeyHex)).toEqual(plain)
    expect(request).toHaveBeenLastCalledWith({ type: 'upload_file_complete', requestId: 'relay' }, 180_000)
  })

  it('rejects unsafe URLs, missing LAN substitution, and oversized files', async () => {
    expect(() => resolveLanUploadUrl('http://{lanHost}:7788/put')).toThrow('LAN host')
    expect(() => resolveLanUploadUrl('file:///tmp/put', '127.0.0.1')).toThrow('rejected')
    const request = vi.fn()
    await expect(uploadBytes({
      requestId: 'large',
      targetDir: '/p',
      name: 'huge.bin',
      mimeType: 'application/octet-stream',
      bytes: { byteLength: MAX_UPLOAD_BYTES + 1 } as Uint8Array,
      transport: 'relay',
      request,
      put: vi.fn(),
    })).rejects.toThrow('100 MB')
    expect(request).not.toHaveBeenCalled()
  })
})
