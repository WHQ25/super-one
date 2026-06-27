vi.mock('./logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('./agent/event-trace', () => ({ trace: vi.fn() }))

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { deriveFileTokenKeyFromExtractable, createLanFileTokenSigner, type LanFileTokenSigner } from './lan-file-token'
import { LanServer } from './lan-server'

const SECRET_HEX = 'a'.repeat(64)
let workspace: string
let pngPath: string
let pngBytes: Uint8Array
let signer: LanFileTokenSigner

async function startServer(getSigner: () => LanFileTokenSigner | null): Promise<{ server: LanServer; port: number }> {
  const server = new LanServer({
    getAesKey: () => null,
    isPairedDevice: () => false,
    onCommand: vi.fn(),
    hostName: 'test-host',
    getFileTokenSigner: getSigner,
  })
  const { port } = await server.start({ host: '127.0.0.1' })
  return { server, port }
}

beforeAll(async () => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'lan-files-test-')))
  pngPath = join(workspace, 'image.png')
  pngBytes = new Uint8Array(2048)
  for (let i = 0; i < pngBytes.length; i++) pngBytes[i] = i % 256
  writeFileSync(pngPath, pngBytes)
  mkdirSync(join(workspace, 'subdir'))
  const hmacKey = await deriveFileTokenKeyFromExtractable(SECRET_HEX)
  signer = createLanFileTokenSigner(hmacKey)
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('LanServer file route', () => {
  let server: LanServer | null = null

  afterEach(async () => {
    await server?.stop()
    server = null
  })

  it('serves a file with valid token', async () => {
    const started = await startServer(() => signer)
    server = started.server
    const token = await signer.sign(pngPath)
    const res = await fetch(`http://127.0.0.1:${started.port}/files/${encodeURIComponent(token)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-length')).toBe(String(pngBytes.length))
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    const body = new Uint8Array(await res.arrayBuffer())
    expect(body.length).toBe(pngBytes.length)
    for (let i = 0; i < body.length; i += 257) {
      expect(body[i]).toBe(pngBytes[i])
    }
  })

  it('returns 403 for invalid token', async () => {
    const started = await startServer(() => signer)
    server = started.server
    const res = await fetch(`http://127.0.0.1:${started.port}/files/garbage.token`)
    expect(res.status).toBe(403)
  })

  it('returns 403 for expired token', async () => {
    const started = await startServer(() => signer)
    server = started.server
    const token = await signer.sign(pngPath, { now: Date.now() - 120_000, ttlMs: 1_000 })
    const res = await fetch(`http://127.0.0.1:${started.port}/files/${encodeURIComponent(token)}`)
    expect(res.status).toBe(403)
  })

  it('returns 503 when no signer configured', async () => {
    const started = await startServer(() => null)
    server = started.server
    const token = await signer.sign(pngPath)
    const res = await fetch(`http://127.0.0.1:${started.port}/files/${encodeURIComponent(token)}`)
    expect(res.status).toBe(503)
  })

  it('returns 404 for valid token but missing file', async () => {
    const started = await startServer(() => signer)
    server = started.server
    const token = await signer.sign(join(workspace, 'missing.png'))
    const res = await fetch(`http://127.0.0.1:${started.port}/files/${encodeURIComponent(token)}`)
    expect(res.status).toBe(404)
  })

  it('returns 403 when token points to a directory', async () => {
    const started = await startServer(() => signer)
    server = started.server
    const token = await signer.sign(join(workspace, 'subdir'))
    const res = await fetch(`http://127.0.0.1:${started.port}/files/${encodeURIComponent(token)}`)
    expect(res.status).toBe(403)
  })

  it('still rejects WS upgrade for non-/files paths', async () => {
    const started = await startServer(() => signer)
    server = started.server
    const res = await fetch(`http://127.0.0.1:${started.port}/anything-else`)
    expect(res.status).toBe(426)
  })

  it('serves a byte range with 206 Partial Content', async () => {
    const started = await startServer(() => signer)
    server = started.server
    const token = await signer.sign(pngPath)
    const res = await fetch(`http://127.0.0.1:${started.port}/files/${encodeURIComponent(token)}`, {
      headers: { Range: 'bytes=0-99' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 0-99/${pngBytes.length}`)
    expect(res.headers.get('content-length')).toBe('100')
    const body = new Uint8Array(await res.arrayBuffer())
    expect(body.length).toBe(100)
    expect(body[0]).toBe(0)
    expect(body[99]).toBe(99)
  })

  it('serves a suffix range (last N bytes)', async () => {
    const started = await startServer(() => signer)
    server = started.server
    const token = await signer.sign(pngPath)
    const res = await fetch(`http://127.0.0.1:${started.port}/files/${encodeURIComponent(token)}`, {
      headers: { Range: 'bytes=-256' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-length')).toBe('256')
    const expectedStart = pngBytes.length - 256
    expect(res.headers.get('content-range')).toBe(`bytes ${expectedStart}-${pngBytes.length - 1}/${pngBytes.length}`)
  })

  it('returns 416 for invalid range', async () => {
    const started = await startServer(() => signer)
    server = started.server
    const token = await signer.sign(pngPath)
    const res = await fetch(`http://127.0.0.1:${started.port}/files/${encodeURIComponent(token)}`, {
      headers: { Range: 'bytes=99999-100000' },
    })
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe(`bytes */${pngBytes.length}`)
  })

  it('rejects a write-mode token on the GET download route', async () => {
    const started = await startServer(() => signer)
    server = started.server
    const token = await signer.sign(pngPath, { mode: 'write' })
    const res = await fetch(`http://127.0.0.1:${started.port}/files/${encodeURIComponent(token)}`)
    expect(res.status).toBe(403)
  })
})

describe('LanServer upload route', () => {
  let server: LanServer | null = null

  afterEach(async () => {
    await server?.stop()
    server = null
  })

  it('writes uploaded bytes to the write-token path and returns savedPath', async () => {
    const started = await startServer(() => signer)
    server = started.server
    const dest = join(workspace, 'uploaded.bin')
    const token = await signer.sign(dest, { mode: 'write' })
    const payload = new Uint8Array(1500)
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) % 256
    const res = await fetch(`http://127.0.0.1:${started.port}/files/upload/${encodeURIComponent(token)}`, {
      method: 'PUT',
      body: payload,
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; savedPath: string }
    expect(json.ok).toBe(true)
    expect(json.savedPath).toBe(dest)
    const written = readFileSync(dest)
    expect(written.length).toBe(1500)
    expect(written[0]).toBe(0)
    expect(written[10]).toBe(70)
  })

  it('rejects a read-mode token on the upload route', async () => {
    const started = await startServer(() => signer)
    server = started.server
    const dest = join(workspace, 'should-not-write.bin')
    const token = await signer.sign(dest)
    const res = await fetch(`http://127.0.0.1:${started.port}/files/upload/${encodeURIComponent(token)}`, {
      method: 'PUT',
      body: new Uint8Array(8),
    })
    expect(res.status).toBe(403)
  })

  it('returns 503 when no signer configured', async () => {
    const started = await startServer(() => null)
    server = started.server
    const token = await signer.sign(join(workspace, 'x.bin'), { mode: 'write' })
    const res = await fetch(`http://127.0.0.1:${started.port}/files/upload/${encodeURIComponent(token)}`, {
      method: 'PUT',
      body: new Uint8Array(8),
    })
    expect(res.status).toBe(503)
  })
})
