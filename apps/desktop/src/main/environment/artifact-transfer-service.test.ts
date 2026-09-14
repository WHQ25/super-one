/**
 * Deferred uploads over the persisted job table: resume from offset, backoff,
 * drop on session delete (session-sync-zone.md §5.3, §7).
 */
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARTIFACT_CHUNK_BYTES, type ArtifactPutRequest } from '@superone/shared/environment'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('../database', () => ({ getDb: getDbMock }))

import { listArtifactTransfersForSession } from '../db-artifact-transfers'
import { ArtifactTransferService, DEFAULT_THROUGHPUT_BYTES_PER_MS } from './artifact-transfer-service'

let db: Database.Database
let root: string

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE artifact_transfer_jobs (
      job_id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, session_id TEXT NOT NULL,
      local_path TEXT NOT NULL, relative_path TEXT NOT NULL, transfer_id TEXT NOT NULL,
      offset INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `)
  getDbMock.mockReturnValue(db)
  root = mkdtempSync(join(tmpdir(), 'transfer-svc-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function fakeNode(opts: { failFirst?: number } = {}) {
  const files = new Map<string, Buffer>()
  const parts = new Map<string, { chunks: Buffer[]; offset: number }>()
  const calls: ArtifactPutRequest[] = []
  let failures = opts.failFirst ?? 0
  const put = async (_connectionId: string, req: ArtifactPutRequest) => {
    calls.push(req)
    if (failures > 0) { failures--; throw Object.assign(new Error('node away'), { code: 'unavailable' }) }
    let part = parts.get(req.transferId)
    if (!part) { part = { chunks: [], offset: 0 }; parts.set(req.transferId, part) }
    if (req.offset < part.offset) return { ok: true as const, bytesWritten: part.offset }
    if (req.offset !== part.offset) throw Object.assign(new Error('gap'), { code: 'conflict', details: { expectedOffset: part.offset } })
    const chunk = Buffer.from(req.chunk, 'base64')
    part.chunks.push(chunk)
    part.offset += chunk.length
    if (req.final) {
      const whole = Buffer.concat(part.chunks)
      expect(createHash('sha256').update(whole).digest('hex')).toBe(req.sha256)
      files.set(req.relativePath, whole)
      return { ok: true as const, bytesWritten: part.offset, mtimeMs: Date.now() }
    }
    return { ok: true as const, bytesWritten: part.offset }
  }
  return { files, parts, calls, put }
}

describe('artifact transfer jobs', () => {
  it('uploads a deferred artifact, measures throughput, and removes the finished job', async () => {
    const node = fakeNode()
    const service = new ArtifactTransferService({ put: node.put })
    const local = join(root, 'clip.mp4')
    const data = Buffer.alloc(ARTIFACT_CHUNK_BYTES + 100, 3)
    writeFileSync(local, data)
    expect(service.throughputBytesPerMs('c1')).toBe(DEFAULT_THROUGHPUT_BYTES_PER_MS)

    service.defer({ connectionId: 'c1', sessionId: 's1', localPath: local, relativePath: 'recording/clip.mp4' })
    expect(listArtifactTransfersForSession('s1')).toHaveLength(1)
    await service.runOnce('c1')
    expect(node.files.get('recording/clip.mp4')!.equals(data)).toBe(true)
    expect(listArtifactTransfersForSession('s1')).toEqual([])
  })

  it('backs off after a failure and resumes from the recorded offset on the next pass', async () => {
    let clock = 1_000_000
    const node = fakeNode()
    const service = new ArtifactTransferService({ put: node.put, now: () => clock })
    const local = join(root, 'big.bin')
    const data = Buffer.alloc(2 * ARTIFACT_CHUNK_BYTES + 1, 5)
    writeFileSync(local, data)
    service.defer({ connectionId: 'c1', sessionId: 's1', localPath: local, relativePath: 'agent/big.bin' })

    // First chunk lands, then the node goes away mid-upload.
    const realPut = node.put
    let calls = 0
    const flaky = async (c: string, req: ArtifactPutRequest) => {
      calls++
      if (calls === 2) throw Object.assign(new Error('socket closed'), { code: 'unavailable' })
      return realPut(c, req)
    }
    const flakyService = new ArtifactTransferService({ put: flaky, now: () => clock })
    await flakyService.runOnce('c1')
    const [job] = listArtifactTransfersForSession('s1')
    expect(job.state).toBe('pending')
    expect(job.offset).toBe(ARTIFACT_CHUNK_BYTES)
    expect(job.attempts).toBe(1)
    expect(job.nextAttemptAt).toBeGreaterThan(clock)

    // Not due yet: nothing happens.
    await service.runOnce('c1')
    expect(node.calls).toHaveLength(1)

    clock = job.nextAttemptAt! + 1
    await service.runOnce('c1')
    expect(node.files.get('agent/big.bin')!.equals(data)).toBe(true)
    // Resumed at the recorded offset — the first chunk was not sent twice.
    expect(node.calls.map((c) => c.offset)).toEqual([0, ARTIFACT_CHUNK_BYTES, 2 * ARTIFACT_CHUNK_BYTES])
    expect(listArtifactTransfersForSession('s1')).toEqual([])
  })

  it('gives up on a job whose local file is gone instead of retrying forever', async () => {
    const node = fakeNode()
    const service = new ArtifactTransferService({ put: node.put })
    const local = join(root, 'gone.png')
    writeFileSync(local, 'x')
    service.defer({ connectionId: 'c1', sessionId: 's1', localPath: local, relativePath: 'browser/gone.png' })
    rmSync(local)
    await service.runOnce('c1')
    expect(listArtifactTransfersForSession('s1')[0]).toMatchObject({ state: 'failed', nextAttemptAt: null })
  })

  it('drops the jobs of a deleted session and aborts the one in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const node = fakeNode()
    const put = async (c: string, req: ArtifactPutRequest) => { await gate; return node.put(c, req) }
    const service = new ArtifactTransferService({ put })
    const local = join(root, 'a.png')
    writeFileSync(local, Buffer.alloc(ARTIFACT_CHUNK_BYTES * 2))
    service.defer({ connectionId: 'c1', sessionId: 's1', localPath: local, relativePath: 'browser/a.png' })
    service.defer({ connectionId: 'c1', sessionId: 's2', localPath: local, relativePath: 'browser/b.png' })
    const pass = service.runOnce('c1')
    await new Promise((resolve) => setTimeout(resolve, 10))
    service.dropSession('s1')
    release()
    await pass
    expect(listArtifactTransfersForSession('s1')).toEqual([])
    // The other session's job was unaffected and finished.
    expect(node.files.has('browser/b.png')).toBe(true)
    expect(node.files.has('browser/a.png')).toBe(false)
  })

  it('sleeps until the earliest backoff is due, not for the ten-minute cap', async () => {
    // start() drives the loop from a timer; the delay it computes must come
    // from the job's next_attempt_at, and the query behind it must not be fed a
    // number `Date` cannot represent (which threw and silently meant "10 min").
    vi.useFakeTimers()
    try {
      const node = fakeNode({ failFirst: 1 })
      const service = new ArtifactTransferService({ put: node.put })
      const local = join(root, 'later.png')
      writeFileSync(local, 'x')
      service.defer({ connectionId: 'c1', sessionId: 's1', localPath: local, relativePath: 'browser/later.png' })
      service.start('c1')
      // The hash and the chunk read are real I/O; waitFor advances the fake clock while it polls.
      await vi.waitFor(() => expect(listArtifactTransfersForSession('s1')[0]).toMatchObject({ state: 'pending', attempts: 1 }))
      // BACKOFF_BASE_MS is 5 s: the retry must have happened well before the cap.
      await vi.advanceTimersByTimeAsync(6_000)
      await vi.waitFor(() => expect(node.files.has('browser/later.png')).toBe(true))
      service.stop('c1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not run a job whose session was deleted while an earlier job of the same pass was uploading', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const node = fakeNode()
    const put = async (c: string, req: ArtifactPutRequest) => { await gate; return node.put(c, req) }
    const service = new ArtifactTransferService({ put })
    const local = join(root, 'a.png')
    writeFileSync(local, 'x')
    service.defer({ connectionId: 'c1', sessionId: 's1', localPath: local, relativePath: 'browser/a.png' })
    service.defer({ connectionId: 'c1', sessionId: 's2', localPath: local, relativePath: 'browser/b.png' })
    const pass = service.runOnce('c1')
    await new Promise((resolve) => setTimeout(resolve, 10))
    // s2's row is gone before the worker reaches it; the snapshot it took must not resurrect it.
    service.dropSession('s2')
    release()
    await pass
    expect(node.files.has('browser/a.png')).toBe(true)
    expect(node.files.has('browser/b.png')).toBe(false)
  })

  it('wakes the agent once a deferred upload lands, and keeps the job until that wake is acknowledged', async () => {
    let clock = 2_000_000
    const node = fakeNode()
    const notified: Array<{ sessionId: string; notificationId: string; relativePaths: string[] }> = []
    let refuse = true
    const service = new ArtifactTransferService({
      put: node.put,
      now: () => clock,
      notifyCompleted: async (_c, input) => {
        if (refuse) throw Object.assign(new Error('node away'), { code: 'unavailable' })
        notified.push(input)
        return { delivered: true }
      },
    })
    const local = join(root, 'clip.mp4')
    writeFileSync(local, 'bytes')
    const job = service.defer({ connectionId: 'c1', sessionId: 's1', localPath: local, relativePath: 'recording/clip.mp4' })

    // The bytes land but the wake does not: the job stays so the wake is retried.
    await service.runOnce('c1')
    expect(node.files.has('recording/clip.mp4')).toBe(true)
    expect(listArtifactTransfersForSession('s1')).toHaveLength(1)

    expect(listArtifactTransfersForSession('s1')[0]).toMatchObject({ state: 'uploaded' })

    refuse = false
    clock = listArtifactTransfersForSession('s1')[0].nextAttemptAt! + 1
    await service.runOnce('c1')
    expect(notified).toEqual([{ sessionId: 's1', notificationId: job.jobId, relativePaths: ['recording/clip.mp4'] }])
    // Uploaded once, not again for the retried wake.
    expect(node.calls.filter((c) => c.final)).toHaveLength(1)
    expect(listArtifactTransfersForSession('s1')).toEqual([])
  })

  it('drops a job whose session ended rather than retrying its wake forever', async () => {
    const node = fakeNode()
    const service = new ArtifactTransferService({
      put: node.put,
      notifyCompleted: async () => { throw Object.assign(new Error('session not found'), { code: 'not_found' }) },
    })
    const local = join(root, 'a.png')
    writeFileSync(local, 'x')
    service.defer({ connectionId: 'c1', sessionId: 's1', localPath: local, relativePath: 'browser/a.png' })
    await service.runOnce('c1')
    expect(node.files.has('browser/a.png')).toBe(true)
    expect(listArtifactTransfersForSession('s1')).toEqual([])
  })

  it('runs only the jobs of the connection it was started for', async () => {
    const node = fakeNode()
    const service = new ArtifactTransferService({ put: node.put })
    const local = join(root, 'x.png')
    writeFileSync(local, 'x')
    service.defer({ connectionId: 'other', sessionId: 's1', localPath: local, relativePath: 'browser/x.png' })
    await service.runOnce('c1')
    expect(node.calls).toHaveLength(0)
  })
})
