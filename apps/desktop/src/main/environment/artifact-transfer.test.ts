import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ARTIFACT_CHUNK_BYTES, type ArtifactPutRequest } from '@superone/shared/environment'
import { downloadArtifact, sha256File, uploadArtifact } from './artifact-transfer'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'artifact-transfer-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** A node-shaped `put`: ordered offsets, conflict with expectedOffset on a gap. */
function fakeNode() {
  const files = new Map<string, Buffer>()
  const parts = new Map<string, { written: Buffer[]; offset: number }>()
  const calls: ArtifactPutRequest[] = []
  const put = async (req: ArtifactPutRequest) => {
    calls.push(req)
    let part = parts.get(req.transferId)
    if (!part) { part = { written: [], offset: 0 }; parts.set(req.transferId, part) }
    if (req.offset < part.offset) return { ok: true as const, bytesWritten: part.offset }
    if (req.offset !== part.offset) throw Object.assign(new Error('gap'), { code: 'conflict', details: { expectedOffset: part.offset } })
    const chunk = Buffer.from(req.chunk, 'base64')
    part.written.push(chunk)
    part.offset += chunk.length
    if (req.final) {
      const whole = Buffer.concat(part.written)
      if (createHash('sha256').update(whole).digest('hex') !== req.sha256) throw Object.assign(new Error('sha'), { code: 'invalid_argument' })
      files.set(req.relativePath, whole)
      parts.delete(req.transferId)
      return { ok: true as const, bytesWritten: part.offset, mtimeMs: 1_700_000_000_000 }
    }
    return { ok: true as const, bytesWritten: part.offset }
  }
  return { files, parts, calls, put }
}

describe('artifact hashing', () => {
  it('stops reading a large file the moment the transfer is aborted', () => {
    // Hashing runs before the first chunk goes out, so a claim that expires
    // while a multi-gigabyte recording is being read would otherwise be paid
    // for twice: once waiting, once in I/O nobody is waiting for any more.
    const big = join(root, 'big.bin')
    writeFileSync(big, Buffer.alloc(8 * 1024 * 1024))
    const ac = new AbortController()
    const hashing = sha256File(big, ac.signal)
    ac.abort()
    return expect(hashing).rejects.toMatchObject({ code: 'aborted' })
  })
})

describe('artifact upload', () => {
  it('streams a file in contract-sized chunks and stamps the local copy with the node mtime', async () => {
    const node = fakeNode()
    const data = Buffer.alloc(ARTIFACT_CHUNK_BYTES + 10, 7)
    const local = join(root, 'big.bin')
    writeFileSync(local, data)
    const outcome = await uploadArtifact({ localPath: local, sessionId: 's1', relativePath: 'browser/big.bin', transferId: 't', put: node.put })
    expect(outcome.bytes).toBe(data.length)
    expect(node.calls.map((c) => [c.offset, c.final])).toEqual([[0, false], [ARTIFACT_CHUNK_BYTES, true]])
    expect(node.files.get('browser/big.bin')!.equals(data)).toBe(true)
    expect(Math.floor(statSync(local).mtimeMs)).toBe(1_700_000_000_000)
  })

  it('sends an empty file as one final zero-byte chunk', async () => {
    const node = fakeNode()
    const local = join(root, 'empty')
    writeFileSync(local, '')
    await uploadArtifact({ localPath: local, sessionId: 's1', relativePath: 'agent/empty', put: node.put })
    expect(node.calls).toHaveLength(1)
    expect(node.calls[0]).toMatchObject({ offset: 0, total: 0, final: true, chunk: '' })
    expect(node.files.get('agent/empty')).toHaveLength(0)
  })

  it('resumes from the offset the node reports instead of restarting', async () => {
    const node = fakeNode()
    const data = Buffer.alloc(2 * ARTIFACT_CHUNK_BYTES + 5, 1)
    const local = join(root, 'resume.bin')
    writeFileSync(local, data)
    // The node already holds the first chunk from an earlier attempt; the job thought it had two.
    node.parts.set('t', { written: [data.subarray(0, ARTIFACT_CHUNK_BYTES)], offset: ARTIFACT_CHUNK_BYTES })
    await uploadArtifact({ localPath: local, sessionId: 's1', relativePath: 'a', transferId: 't', offset: 2 * ARTIFACT_CHUNK_BYTES, put: node.put })
    expect(node.calls.map((c) => c.offset)).toEqual([2 * ARTIFACT_CHUNK_BYTES, ARTIFACT_CHUNK_BYTES, 2 * ARTIFACT_CHUNK_BYTES])
    expect(node.files.get('a')!.equals(data)).toBe(true)
  })

  it('stops between chunks when the action is aborted', async () => {
    const node = fakeNode()
    const local = join(root, 'abort.bin')
    writeFileSync(local, Buffer.alloc(ARTIFACT_CHUNK_BYTES + 1))
    const abort = new AbortController()
    const put = async (req: ArtifactPutRequest) => { const r = await node.put(req); abort.abort(); return r }
    await expect(uploadArtifact({ localPath: local, sessionId: 's1', relativePath: 'a', put, signal: abort.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(node.calls).toHaveLength(1)
  })

  it('does not stamp the node mtime onto a local file that changed while the upload ran', async () => {
    // Stamping regardless is how the mirror ends up permanently agreeing about
    // two different files: same size, same mtime, different bytes.
    const local = join(root, 'shot.png')
    writeFileSync(local, 'AAA')
    const before = statSync(local).mtimeMs
    const put = async (req: ArtifactPutRequest) => {
      if (req.final) writeFileSync(local, 'BBB')
      return { ok: true as const, bytesWritten: 3, ...(req.final ? { mtimeMs: 1_600_000_000_000 } : {}) }
    }
    await uploadArtifact({ localPath: local, sessionId: 's1', relativePath: 'browser/shot.png', put })
    expect(Math.floor(statSync(local).mtimeMs)).not.toBe(1_600_000_000_000)
    expect(statSync(local).mtimeMs).toBeGreaterThanOrEqual(before)
  })
})

describe('artifact download', () => {
  it('pulls a file in windows, renames the part into place and stamps the node mtime', async () => {
    const data = Buffer.alloc(ARTIFACT_CHUNK_BYTES + 3, 9)
    const offsets: number[] = []
    const get = async (req: { offset: number; maxBytes: number }) => {
      offsets.push(req.offset)
      const slice = data.subarray(req.offset, req.offset + req.maxBytes)
      return { chunk: slice.toString('base64'), total: data.length, mtimeMs: 1_600_000_000_000, eof: req.offset + slice.length >= data.length }
    }
    const dest = join(root, 'mirror', 'agent', 'report.md')
    const outcome = await downloadArtifact({ sessionId: 's1', relativePath: 'agent/report.md', destPath: dest, get })
    expect(outcome).toMatchObject({ bytes: data.length, mtimeMs: 1_600_000_000_000 })
    expect(offsets).toEqual([0, ARTIFACT_CHUNK_BYTES])
    expect(readFileSync(dest).equals(data)).toBe(true)
    expect(Math.floor(statSync(dest).mtimeMs)).toBe(1_600_000_000_000)
  })

  it('starts over when the file changes under it instead of stitching two versions together', async () => {
    // The agent rewrote report.md between two windows: same length, new
    // mtime. A copy of half-old, half-new bytes stamped with the new mtime
    // would pass the mirror's size+mtime check for good.
    const oldData = Buffer.alloc(ARTIFACT_CHUNK_BYTES + 3, 1)
    const newData = Buffer.alloc(ARTIFACT_CHUNK_BYTES + 3, 2)
    let version = { data: oldData, mtimeMs: 1_600_000_000_000 }
    let calls = 0
    const get = async (req: { offset: number; maxBytes: number }) => {
      calls++
      if (calls === 2) version = { data: newData, mtimeMs: 1_600_000_005_000 }
      const slice = version.data.subarray(req.offset, req.offset + req.maxBytes)
      return { chunk: slice.toString('base64'), total: version.data.length, mtimeMs: version.mtimeMs, eof: req.offset + slice.length >= version.data.length }
    }
    const dest = join(root, 'mirror', 'agent', 'report.md')
    const outcome = await downloadArtifact({ sessionId: 's1', relativePath: 'agent/report.md', destPath: dest, get })
    expect(readFileSync(dest).equals(newData)).toBe(true)
    expect(outcome.mtimeMs).toBe(1_600_000_005_000)
  })

  it('gives up on a file that keeps changing rather than looping forever', async () => {
    let n = 0
    const get = async (req: { offset: number; maxBytes: number }) => {
      n++
      const data = Buffer.alloc(ARTIFACT_CHUNK_BYTES + 1, n)
      const slice = data.subarray(req.offset, req.offset + req.maxBytes)
      return { chunk: slice.toString('base64'), total: data.length, mtimeMs: 1_600_000_000_000 + n, eof: req.offset + slice.length >= data.length }
    }
    const dest = join(root, 'mirror', 'agent', 'busy.md')
    await expect(downloadArtifact({ sessionId: 's1', relativePath: 'agent/busy.md', destPath: dest, get })).rejects.toMatchObject({ code: 'conflict' })
    expect(() => statSync(dest)).toThrow()
  })

  it('leaves no partial file behind when the node fails mid-stream', async () => {
    const get = async () => { throw Object.assign(new Error('gone'), { code: 'not_found' }) }
    const dest = join(root, 'agent', 'missing.md')
    await expect(downloadArtifact({ sessionId: 's1', relativePath: 'agent/missing.md', destPath: dest, get })).rejects.toMatchObject({ code: 'not_found' })
    expect(() => statSync(dest)).toThrow()
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(join(root, 'agent'))).toEqual([])
  })
})
