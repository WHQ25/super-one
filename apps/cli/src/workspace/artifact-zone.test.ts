import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ARTIFACT_CHUNK_BYTES } from '@superone/shared/environment'
import { ArtifactZoneService } from './artifact-zone'

let root: string
let zone: ArtifactZoneService

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'superone-artifact-zone-'))
  zone = new ArtifactZoneService(join(root, 'sync'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function sha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function code(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return (err as { code?: string }).code
  }
  return undefined
}

/** Upload `data` as ordered chunks of `chunkSize`, the way the desktop does. */
function upload(sessionId: string, relativePath: string, data: Buffer, transferId = 't1', chunkSize = 3) {
  const digest = sha(data)
  if (data.length === 0) {
    return zone.put({ sessionId, relativePath, transferId, offset: 0, total: 0, sha256: digest, chunk: '', final: true })
  }
  let result
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.subarray(offset, offset + chunkSize)
    result = zone.put({
      sessionId, relativePath, transferId, offset, total: data.length, sha256: digest,
      chunk: chunk.toString('base64'), final: offset + chunk.length >= data.length,
    })
  }
  return result!
}

describe('artifact zone scoping', () => {
  it('rejects traversal, absolute paths, cross-session ids and the session directory itself', () => {
    expect(code(() => zone.stat('s1', '../s2/browser/a.png'))).toBe('invalid_argument')
    expect(code(() => zone.stat('s1', '/etc/passwd'))).toBe('invalid_argument')
    expect(code(() => zone.stat('../s2', 'browser/a.png'))).toBe('invalid_argument')
    expect(code(() => zone.stat('s1/../s2', 'browser/a.png'))).toBe('invalid_argument')
    expect(code(() => zone.stat('s1', '.'))).toBe('invalid_argument')
    expect(code(() => zone.stat('s1', 'browser/..'))).toBe('invalid_argument')
    expect(code(() => zone.stat('s1', ''))).toBe('invalid_argument')
  })

  it('refuses a symlink that escapes the session directory', () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.txt'), 'nope')
    mkdirSync(join(root, 'sync', 's1'), { recursive: true })
    symlinkSync(outside, join(root, 'sync', 's1', 'link'))
    expect(code(() => zone.stat('s1', 'link/secret.txt'))).toBe('invalid_argument')
    expect(code(() => zone.get({ sessionId: 's1', relativePath: 'link/secret.txt', offset: 0, maxBytes: 10 }))).toBe('invalid_argument')
  })

  it('reports a missing artifact as exists:false rather than an error', () => {
    expect(zone.stat('s1', 'browser/nothing.png')).toEqual({ exists: false, size: 0, mtimeMs: 0 })
    expect(code(() => zone.get({ sessionId: 's1', relativePath: 'browser/nothing.png', offset: 0, maxBytes: 10 }))).toBe('not_found')
  })
})

describe('artifact upload', () => {
  it('writes ordered chunks into a part file and renames it into place only on the verified final chunk', () => {
    const data = Buffer.from('hello sync zone')
    const digest = sha(data)
    const first = zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't1', offset: 0, total: data.length, sha256: digest, chunk: data.subarray(0, 5).toString('base64'), final: false })
    expect(first).toEqual({ ok: true, bytesWritten: 5 })
    const dir = join(root, 'sync', 's1', 'browser')
    expect(readdirSync(dir)).toEqual(['a.png.part.t1'])
    expect(zone.stat('s1', 'browser/a.png').exists).toBe(false)

    const last = zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't1', offset: 5, total: data.length, sha256: digest, chunk: data.subarray(5).toString('base64'), final: true })
    expect(last).toEqual({ ok: true, bytesWritten: data.length })
    expect(readdirSync(dir)).toEqual(['a.png'])
    expect(readFileSync(join(dir, 'a.png'))).toEqual(data)
    expect(zone.stat('s1', 'browser/a.png')).toMatchObject({ exists: true, size: data.length })
    expect(zone.activeTransfers()).toEqual([])
  })

  it('resumes from the offset the node reports after a gap, and ignores a repeated chunk', () => {
    const data = Buffer.from('abcdefghij')
    const digest = sha(data)
    const put = (offset: number, end: number, final = false) => zone.put({
      sessionId: 's1', relativePath: 'agent/r.md', transferId: 't1', offset, total: data.length, sha256: digest,
      chunk: data.subarray(offset, end).toString('base64'), final,
    })
    put(0, 4)
    const gap = (() => {
      try { put(6, 8) } catch (err) { return err as { code?: string; details?: { expectedOffset?: number } } }
      return null
    })()
    expect(gap?.code).toBe('conflict')
    expect(gap?.details?.expectedOffset).toBe(4)
    // A retry of the chunk the node already has is acknowledged, not appended twice.
    expect(put(0, 4)).toEqual({ ok: true, bytesWritten: 4 })
    put(4, 8)
    expect(put(8, 10, true)).toEqual({ ok: true, bytesWritten: 10 })
    expect(readFileSync(join(root, 'sync', 's1', 'agent', 'r.md'))).toEqual(data)
  })

  it('answers busy to a second transfer for a path that is still being written', () => {
    const data = Buffer.from('xxxxxxxx')
    zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't1', offset: 0, total: 8, sha256: sha(data), chunk: data.subarray(0, 4).toString('base64'), final: false })
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't2', offset: 0, total: 8, sha256: sha(data), chunk: data.subarray(0, 4).toString('base64'), final: false }))).toBe('busy')
    // The same path in another session is a different file.
    expect(zone.put({ sessionId: 's2', relativePath: 'browser/a.png', transferId: 't3', offset: 0, total: 8, sha256: sha(data), chunk: data.toString('base64'), final: true }).ok).toBe(true)
  })

  it('drops the part file and the transfer when the digest does not match', () => {
    const data = Buffer.from('payload')
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't1', offset: 0, total: data.length, sha256: sha(Buffer.from('other')), chunk: data.toString('base64'), final: true }))).toBe('invalid_argument')
    expect(existsSync(join(root, 'sync', 's1', 'browser', 'a.png'))).toBe(false)
    expect(readdirSync(join(root, 'sync', 's1', 'browser'))).toEqual([])
    expect(zone.activeTransfers()).toEqual([])
  })

  it('removes a stale part file left by a crashed upload when a new transfer starts', () => {
    const dir = join(root, 'sync', 's1', 'browser')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.png.part.dead'), 'half')
    upload('s1', 'browser/a.png', Buffer.from('fresh'))
    expect(readdirSync(dir)).toEqual(['a.png'])
  })

  it('stores an empty file as a single final chunk of zero bytes', () => {
    expect(upload('s1', 'agent/empty.txt', Buffer.alloc(0))).toEqual({ ok: true, bytesWritten: 0 })
    expect(zone.stat('s1', 'agent/empty.txt')).toMatchObject({ exists: true, size: 0 })
    expect(readFileSync(join(root, 'sync', 's1', 'agent', 'empty.txt'))).toHaveLength(0)
  })

  it('rejects a chunk larger than the contract size and an unknown transfer that does not start at 0', () => {
    const big = randomBytes(ARTIFACT_CHUNK_BYTES + 1)
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'a', transferId: 't1', offset: 0, total: big.length, sha256: sha(big), chunk: big.toString('base64'), final: true }))).toBe('invalid_argument')
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'a', transferId: 't9', offset: 3, total: 8, sha256: sha(big), chunk: '', final: false }))).toBe('conflict')
  })

  it('replaces a completed file when the desktop re-uploads the same path', () => {
    upload('s1', 'media-gen/g-0.preview.jpg', Buffer.from('v1'), 't1')
    upload('s1', 'media-gen/g-0.preview.jpg', Buffer.from('v2-longer'), 't2')
    expect(readFileSync(join(root, 'sync', 's1', 'media-gen', 'g-0.preview.jpg'), 'utf8')).toBe('v2-longer')
  })
})

describe('artifact download', () => {
  it('streams a file in bounded windows with total, mtime and eof', () => {
    const data = Buffer.from('0123456789')
    upload('s1', 'agent/report.md', data)
    const a = zone.get({ sessionId: 's1', relativePath: 'agent/report.md', offset: 0, maxBytes: 4 })
    expect(Buffer.from(a.chunk, 'base64').toString()).toBe('0123')
    expect(a).toMatchObject({ total: 10, eof: false })
    expect(a.mtimeMs).toBe(zone.stat('s1', 'agent/report.md').mtimeMs)
    const b = zone.get({ sessionId: 's1', relativePath: 'agent/report.md', offset: 4, maxBytes: 100 })
    expect(Buffer.from(b.chunk, 'base64').toString()).toBe('456789')
    expect(b.eof).toBe(true)
    const past = zone.get({ sessionId: 's1', relativePath: 'agent/report.md', offset: 10, maxBytes: 4 })
    expect(past).toMatchObject({ chunk: '', eof: true, total: 10 })
  })
})

describe('artifact delete', () => {
  it('removes one file or the whole session directory', async () => {
    upload('s1', 'browser/a.png', Buffer.from('a'), 't1')
    upload('s1', 'browser/b.png', Buffer.from('b'), 't2')
    await zone.delete('s1', 'browser/a.png')
    expect(readdirSync(join(root, 'sync', 's1', 'browser'))).toEqual(['b.png'])
    await zone.delete('s1')
    expect(existsSync(join(root, 'sync', 's1'))).toBe(false)
    // Deleting what is already gone is fine.
    await zone.delete('s1')
  })

  it('tombstones the session so a chunk arriving mid-delete cannot recreate the directory', async () => {
    const data = Buffer.from('late-arrival')
    zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't1', offset: 0, total: data.length, sha256: sha(data), chunk: data.subarray(0, 4).toString('base64'), final: false })
    const deleting = zone.delete('s1')
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'browser/a.png', transferId: 't1', offset: 4, total: data.length, sha256: sha(data), chunk: data.subarray(4).toString('base64'), final: true }))).toBe('failed_precondition')
    expect(code(() => zone.put({ sessionId: 's1', relativePath: 'browser/c.png', transferId: 't2', offset: 0, total: 1, sha256: sha(Buffer.from('c')), chunk: Buffer.from('c').toString('base64'), final: true }))).toBe('failed_precondition')
    await deleting
    expect(existsSync(join(root, 'sync', 's1'))).toBe(false)
    expect(zone.activeTransfers()).toEqual([])
    // Once the delete has returned, the session can be written again.
    upload('s1', 'browser/c.png', Buffer.from('c'), 't3')
    expect(zone.stat('s1', 'browser/c.png').exists).toBe(true)
  })
})
