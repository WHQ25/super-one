import { describe, expect, it, vi } from 'vitest'
import type { ShareFilePayload } from '@superone/shared/agent-types'
import { deriveKeys, encryptBytesChunked } from './crypto'
import { MAX_DOWNLOAD_BYTES, downloadDesktopFileBytes, downloadSharedFileBytes } from './downloads'

const MASTER = '0123456789abcdef'.repeat(8)

describe('downloadSharedFileBytes', () => {
  it('decodes inline files and verifies their declared size', async () => {
    await expect(downloadSharedFileBytes({
      file: { name: 'hello.txt', mimeType: 'text/plain', size: 5, inlineBase64: 'aGVsbG8=' },
    })).resolves.toEqual(new TextEncoder().encode('hello'))

    await expect(downloadSharedFileBytes({
      file: { name: 'bad.txt', mimeType: 'text/plain', size: 4, inlineBase64: 'aGVsbG8=' },
    })).rejects.toThrow('size mismatch')
  })

  it('downloads and authenticates encrypted relay files', async () => {
    const plain = new TextEncoder().encode('shared from desktop')
    const keys = deriveKeys(MASTER)
    const envelope = encryptBytesChunked(keys.aesKeyBytes, plain, 'share/key', keys.channelKeyHex)
    const get = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => envelope.slice().buffer as ArrayBuffer,
    }))
    const file: ShareFilePayload = {
      name: 'report.txt',
      mimeType: 'text/plain',
      size: plain.byteLength,
      downloadUrl: 'https://files.example.test/share',
      expiresAt: 2_000,
      encryption: { version: 1, format: 'chunked-v1', key: 'share/key' },
    }

    await expect(downloadSharedFileBytes({
      file,
      aesKeyBytes: keys.aesKeyBytes,
      channelKeyHex: keys.channelKeyHex,
      get,
      now: () => 1_000,
    })).resolves.toEqual(plain)
    expect(get).toHaveBeenCalledWith('https://files.example.test/share')
  })

  it('rejects expired, insecure, malformed, and oversized downloads', async () => {
    const base: ShareFilePayload = {
      name: 'a.bin',
      mimeType: 'application/octet-stream',
      size: 1,
      downloadUrl: 'https://files.example.test/a',
      expiresAt: 10,
      encryption: { version: 1, format: 'chunked-v1', key: 'k' },
    }
    const keys = deriveKeys(MASTER)
    const get = vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }))

    await expect(downloadSharedFileBytes({ file: base, now: () => 10 })).rejects.toThrow('expired')
    await expect(downloadSharedFileBytes({
      file: { ...base, expiresAt: undefined, downloadUrl: 'http://files.example.test/a' },
      aesKeyBytes: keys.aesKeyBytes,
      channelKeyHex: keys.channelKeyHex,
      get,
    })).rejects.toThrow('rejected http:')
    await expect(downloadSharedFileBytes({
      file: { ...base, expiresAt: undefined, encryption: { version: 2, format: 'chunked-v1', key: 'k' } },
      aesKeyBytes: keys.aesKeyBytes,
      channelKeyHex: keys.channelKeyHex,
      get,
    })).rejects.toThrow('unsupported encryption')
    await expect(downloadSharedFileBytes({
      file: { ...base, expiresAt: undefined },
      aesKeyBytes: keys.aesKeyBytes,
      channelKeyHex: keys.channelKeyHex,
      get,
    })).rejects.toThrow('Download failed (404)')
    await expect(downloadSharedFileBytes({
      file: { name: 'huge', mimeType: 'x', size: MAX_DOWNLOAD_BYTES + 1, inlineBase64: '' },
    })).rejects.toThrow('100 MB')
  })

  it('allows raw LAN desktop files but rejects raw relay responses', async () => {
    const bytes = new TextEncoder().encode('lan file')
    const file = {
      ok: true as const,
      url: 'http://192.0.2.4:7788/file/token',
      name: 'lan.txt',
      mimeType: 'text/plain',
      size: bytes.byteLength,
      modifiedAt: 1,
      expiresAt: 2_000,
    }
    const get = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
    }))

    await expect(downloadDesktopFileBytes({
      file,
      transport: 'lan',
      get,
      now: () => 1_000,
    })).resolves.toEqual(bytes)
    await expect(downloadDesktopFileBytes({
      file,
      transport: 'relay',
      get,
      now: () => 1_000,
    })).rejects.toThrow('unencrypted relay file rejected')
  })
})
