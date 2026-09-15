/**
 * The transfer worker over the delivery record
 * (`docs/design/session-sync-zone-delivery-record.md` §6): it takes any live
 * row with a dead-or-no holder, uploads from the recorded offset under the
 * row's fixed identity, wakes the agent, and marks the row done. Failure is
 * scheduling — `attempts`, `next_attempt_at`, `gave_up_at` — never a phase.
 *
 * Real SQLite (the delivery record), real files, real hashing; only the node's
 * `put` / `notifyCompleted` are stubbed.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARTIFACT_CHUNK_BYTES, type ArtifactPutRequest } from '@superone/shared/environment'

vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())

import { deliveryDb, resetDeliveryDatabase } from '../../test/fixtures/delivery-db'
import { getDelivery, listSessionDeliveries, reserveDelivery, type Delivery, type DeliveryPhase } from '../db-session-deliveries'
import { _resetHoldersForTests, mintHolder } from './delivery-holders'
import { ArtifactTransferService, DEFAULT_THROUGHPUT_BYTES_PER_MS } from './artifact-transfer-service'

let root: string
beforeEach(() => {
  resetDeliveryDatabase()
  _resetHoldersForTests()
  root = mkdtempSync(join(tmpdir(), 'transfer-svc-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/**
 * A sealed delivery for `rel`, waiting for the worker — a file an eager push
 * queued, or one produced outside any call. Its identity is fixed at seal from
 * the bytes on disk (R6).
 */
function sealDelivery(
  sessionId: string,
  connectionId: string,
  localPath: string,
  rel: string,
  data: Buffer,
): string {
  const r = reserveDelivery({
    sessionId,
    connectionId,
    localPath,
    relativePath: rel,
    origin: 'produced',
    phase: 'sealed',
    holder: null,
    total: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  })
  if ('refused' in r) throw new Error(r.refused)
  return r.deliveryId
}

/** Force a delivery to a later phase, the way an interrupted worker would have left it. */
function setPhase(deliveryId: string, phase: DeliveryPhase, offset = 0): void {
  deliveryDb().prepare('UPDATE session_file_deliveries SET phase = ?, offset = ? WHERE delivery_id = ?').run(phase, offset, deliveryId)
}

/** Every live row of a session — what the worker still has to do. */
const live = (sessionId: string): Delivery[] => listSessionDeliveries(sessionId).filter((r) => r.outcome === null)

function fakeNode() {
  const files = new Map<string, Buffer>()
  const parts = new Map<string, { chunks: Buffer[]; offset: number }>()
  const calls: ArtifactPutRequest[] = []
  const put = async (_connectionId: string, req: ArtifactPutRequest) => {
    calls.push(req)
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

describe('the transfer worker', () => {
  it('uploads a sealed delivery, measures throughput, and ends it as done', async () => {
    const node = fakeNode()
    const service = new ArtifactTransferService({ put: node.put })
    const local = join(root, 'clip.mp4')
    const data = Buffer.alloc(ARTIFACT_CHUNK_BYTES + 100, 3)
    writeFileSync(local, data)
    const id = sealDelivery('s1', 'c1', local, 'recording/clip.mp4', data)
    expect(service.throughputBytesPerMs('c1')).toBe(DEFAULT_THROUGHPUT_BYTES_PER_MS)

    await service.runOnce('c1')
    expect(node.files.get('recording/clip.mp4')!.equals(data)).toBe(true)
    // Kept until reclaim (P3), but over: done, unheld.
    expect(getDelivery(id)).toMatchObject({ phase: 'notifying', outcome: 'done', holder: null })
    expect(live('s1')).toEqual([])
  })

  it('backs off after a failure and resumes from the recorded offset on the next pass', async () => {
    let clock = 1_000_000
    const node = fakeNode()
    const local = join(root, 'big.bin')
    const data = Buffer.alloc(2 * ARTIFACT_CHUNK_BYTES + 1, 5)
    writeFileSync(local, data)
    const id = sealDelivery('s1', 'c1', local, 'agent/big.bin', data)

    // First chunk lands, then the node goes away mid-upload.
    let calls = 0
    const flaky = async (c: string, req: ArtifactPutRequest) => {
      calls++
      if (calls === 2) throw Object.assign(new Error('socket closed'), { code: 'unavailable' })
      return node.put(c, req)
    }
    const flakyService = new ArtifactTransferService({ put: flaky, now: () => clock })
    await flakyService.runOnce('c1')
    const stalled = getDelivery(id)!
    expect(stalled).toMatchObject({ phase: 'uploading', offset: ARTIFACT_CHUNK_BYTES, attempts: 1, gaveUpAt: null, holder: null })
    expect(stalled.nextAttemptAt).toBeGreaterThan(clock)

    // Not due yet: nothing happens.
    const service = new ArtifactTransferService({ put: node.put, now: () => clock })
    await service.runOnce('c1')
    expect(node.calls).toHaveLength(1)

    clock = stalled.nextAttemptAt! + 1
    await service.runOnce('c1')
    expect(node.files.get('agent/big.bin')!.equals(data)).toBe(true)
    // Resumed at the recorded offset — the first chunk was not sent twice.
    expect(node.calls.map((c) => c.offset)).toEqual([0, ARTIFACT_CHUNK_BYTES, 2 * ARTIFACT_CHUNK_BYTES])
    expect(live('s1')).toEqual([])
  })

  it('gives up on a delivery whose local file is gone instead of retrying forever', async () => {
    const node = fakeNode()
    const service = new ArtifactTransferService({ put: node.put })
    const local = join(root, 'gone.png')
    const data = Buffer.from('x')
    writeFileSync(local, data)
    const id = sealDelivery('s1', 'c1', local, 'browser/gone.png', data)
    rmSync(local)
    await service.runOnce('c1')
    const row = getDelivery(id)!
    expect(row).toMatchObject({ nextAttemptAt: null, outcome: null })
    expect(row.gaveUpAt).not.toBeNull()
  })

  it('never retries a delivery whose final put was already sent (committing)', async () => {
    // The final chunk went out and the reply was lost; the node may have
    // committed it. Nothing here can tell (§2), so the worker leaves it alone.
    const node = fakeNode()
    const service = new ArtifactTransferService({ put: node.put })
    const local = join(root, 'shot.png')
    const data = Buffer.from('png')
    writeFileSync(local, data)
    const id = sealDelivery('s1', 'c1', local, 'browser/shot.png', data)
    setPhase(id, 'committing')
    await service.runOnce('c1')
    expect(node.calls).toEqual([])
    const row = getDelivery(id)!
    expect(row).toMatchObject({ phase: 'committing', nextAttemptAt: null, outcome: null })
    expect(row.gaveUpAt).not.toBeNull()
    expect(row.lastError).toMatch(/commit unverified/)
  })

  it('abandons a row still writing whose producer is gone, and never sends it', async () => {
    // A crashed producer leaves a `writing` row; nothing records how far it
    // got, so a half file is worse than none.
    const node = fakeNode()
    const service = new ArtifactTransferService({ put: node.put })
    const local = join(root, 'half.bin')
    writeFileSync(local, 'FIRST')
    const r = reserveDelivery({ sessionId: 's1', connectionId: 'c1', localPath: local, relativePath: 'download/half.bin', origin: 'download', phase: 'writing', holder: mintHolder() })
    if ('refused' in r) throw new Error(r.refused)
    // Its producer's holder is dead (a fresh incarnation): the worker may take it.
    _resetHoldersForTests()
    deliveryDb().prepare('UPDATE session_file_deliveries SET holder = ? WHERE delivery_id = ?').run(`dead:${r.deliveryId}`, r.deliveryId)
    await service.runOnce('c1')
    expect(node.calls).toEqual([])
    expect(getDelivery(r.deliveryId)).toMatchObject({ outcome: 'abandoned', holder: null })
  })

  it('drops the deliveries of a deleted session and aborts the one in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const node = fakeNode()
    const put = async (c: string, req: ArtifactPutRequest) => { await gate; return node.put(c, req) }
    const service = new ArtifactTransferService({ put })
    const a = join(root, 'a.png')
    const b = join(root, 'b.png')
    const data = Buffer.alloc(ARTIFACT_CHUNK_BYTES * 2)
    writeFileSync(a, data)
    writeFileSync(b, data)
    sealDelivery('s1', 'c1', a, 'browser/a.png', data)
    sealDelivery('s2', 'c1', b, 'browser/b.png', data)
    const pass = service.runOnce('c1')
    await new Promise((resolve) => setTimeout(resolve, 10))
    service.dropSession('s1')
    release()
    await pass
    expect(live('s1')).toEqual([])
    // The other session's delivery was unaffected and finished.
    expect(node.files.has('browser/b.png')).toBe(true)
    expect(node.files.has('browser/a.png')).toBe(false)
  })

  it('sleeps until the earliest backoff is due, not for the ten-minute cap', async () => {
    // start() drives the loop from a timer; the delay it computes must come
    // from the row's next_attempt_at, and the query behind it must not be fed a
    // number `Date` cannot represent (which threw and silently meant "10 min").
    vi.useFakeTimers()
    try {
      let calls = 0
      const node = fakeNode()
      const put = async (c: string, req: ArtifactPutRequest) => {
        calls++
        if (calls === 1) throw Object.assign(new Error('node away'), { code: 'unavailable' })
        return node.put(c, req)
      }
      const service = new ArtifactTransferService({ put })
      const local = join(root, 'later.png')
      // Two chunks: the FIRST (non-final) put fails, so the row backs off at
      // `uploading` rather than landing in the unretryable `committing` state.
      const data = Buffer.alloc(2 * ARTIFACT_CHUNK_BYTES, 9)
      writeFileSync(local, data)
      const id = sealDelivery('s1', 'c1', local, 'browser/later.png', data)
      service.start('c1')
      // The hash and the chunk read are real I/O; waitFor advances the fake clock while it polls.
      await vi.waitFor(() => expect(getDelivery(id)).toMatchObject({ phase: 'uploading', attempts: 1 }))
      // BACKOFF_BASE_MS is 5 s: the retry must have happened well before the cap.
      await vi.advanceTimersByTimeAsync(6_000)
      await vi.waitFor(() => expect(node.files.has('browser/later.png')).toBe(true))
      service.stop('c1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not run a delivery whose session was deleted while an earlier one of the same pass was uploading', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const node = fakeNode()
    const put = async (c: string, req: ArtifactPutRequest) => { await gate; return node.put(c, req) }
    const service = new ArtifactTransferService({ put })
    const a = join(root, 'a.png')
    const b = join(root, 'b.png')
    const data = Buffer.from('x')
    writeFileSync(a, data)
    writeFileSync(b, data)
    sealDelivery('s1', 'c1', a, 'browser/a.png', data)
    sealDelivery('s2', 'c1', b, 'browser/b.png', data)
    const pass = service.runOnce('c1')
    await new Promise((resolve) => setTimeout(resolve, 10))
    // s2's row is abandoned before the worker reaches it; the claim it tries must fail.
    service.dropSession('s2')
    release()
    await pass
    expect(node.files.has('browser/a.png')).toBe(true)
    expect(node.files.has('browser/b.png')).toBe(false)
  })

  it('wakes the agent once an upload lands, and keeps the delivery until that wake is acknowledged', async () => {
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
    const data = Buffer.from('bytes')
    writeFileSync(local, data)
    const id = sealDelivery('s1', 'c1', local, 'recording/clip.mp4', data)

    // The bytes land but the wake does not: the row stays at notifying so the wake is retried.
    await service.runOnce('c1')
    expect(node.files.has('recording/clip.mp4')).toBe(true)
    const waiting = getDelivery(id)!
    expect(waiting).toMatchObject({ phase: 'notifying', outcome: null, holder: null })
    expect(waiting.nextAttemptAt).toBeGreaterThan(clock)

    refuse = false
    clock = waiting.nextAttemptAt! + 1
    await service.runOnce('c1')
    expect(notified).toEqual([{ sessionId: 's1', notificationId: id, relativePaths: ['recording/clip.mp4'] }])
    // Uploaded once, not again for the retried wake.
    expect(node.calls.filter((c) => c.final)).toHaveLength(1)
    expect(getDelivery(id)).toMatchObject({ outcome: 'done' })
  })

  it('ends a delivery whose session is gone rather than retrying its wake forever', async () => {
    const node = fakeNode()
    const service = new ArtifactTransferService({
      put: node.put,
      notifyCompleted: async () => { throw Object.assign(new Error('session not found'), { code: 'not_found' }) },
    })
    const local = join(root, 'a.png')
    const data = Buffer.from('x')
    writeFileSync(local, data)
    const id = sealDelivery('s1', 'c1', local, 'browser/a.png', data)
    await service.runOnce('c1')
    expect(node.files.has('browser/a.png')).toBe(true)
    // The bytes are there but nobody to tell: abandoned, not left retrying.
    expect(getDelivery(id)).toMatchObject({ outcome: 'abandoned', holder: null })
  })

  it('re-runs a delivery that gave up once Retry Upload clears it', async () => {
    // AH1. A row automatic retry stopped on (`gave_up_at`) has no worker
    // coming for it; the person presses Retry, which clears the flag and puts
    // it back in the queue under the same id, transfer id and offset.
    let refuse = true
    const node = fakeNode()
    const service = new ArtifactTransferService({
      put: async (connectionId, req) => {
        if (refuse) throw new Error('node refused the chunk')
        return node.put(connectionId, req)
      },
    })
    const local = join(root, 'report.csv')
    // Two chunks so the failing put is a non-final one: give-up at `uploading`,
    // which Retry can act on — unlike a `committing` give-up (§6).
    const data = Buffer.alloc(2 * ARTIFACT_CHUNK_BYTES, 4)
    writeFileSync(local, data)
    const id = sealDelivery('s1', 'c1', local, 'download/report.csv', data)
    // Run it into the ground: the row gives up, not merely backs off.
    for (let i = 0; i < 10; i++) {
      deliveryDb().prepare("UPDATE session_file_deliveries SET next_attempt_at = NULL WHERE session_id = 's1' AND gave_up_at IS NULL").run()
      await service.runOnce('c1')
    }
    const dead = getDelivery(id)!
    expect(dead.gaveUpAt).not.toBeNull()
    expect(service.givenUp('s1').map((r) => r.deliveryId)).toEqual([id])

    // Retry revives it, keeping its id and transfer id; it now actually runs.
    expect(service.retryGivenUp('s1')).toEqual({ retried: 1 })
    expect(getDelivery(id)).toMatchObject({ gaveUpAt: null, attempts: 0, nextAttemptAt: null, transferId: dead.transferId })
    refuse = false
    await service.runOnce('c1')
    expect(node.files.get('download/report.csv')!.equals(data)).toBe(true)
  })

  it('only wakes the agent for a file already on the node, sending no bytes', async () => {
    // An eager push put the bytes on the node and left the row at `notifying`;
    // the worker owes only the wake. Re-uploading would waste the transfer and
    // could overwrite what the agent changed on the node in between.
    const node = fakeNode()
    const notified: unknown[] = []
    const service = new ArtifactTransferService({
      put: node.put,
      notifyCompleted: async (_c, input) => void notified.push(input),
    })
    const local = join(root, 'shot.png')
    const data = Buffer.from('png')
    writeFileSync(local, data)
    const id = sealDelivery('s1', 'c1', local, 'browser/shot.png', data)
    setPhase(id, 'notifying')
    await service.runOnce('c1')
    expect(notified).toHaveLength(1)
    expect(node.calls).toHaveLength(0)
    expect(getDelivery(id)).toMatchObject({ outcome: 'done' })
  })

  it('runs only the deliveries of the connection it was started for', async () => {
    const node = fakeNode()
    const service = new ArtifactTransferService({ put: node.put })
    const local = join(root, 'x.png')
    const data = Buffer.from('x')
    writeFileSync(local, data)
    sealDelivery('s1', 'other', local, 'browser/x.png', data)
    await service.runOnce('c1')
    expect(node.calls).toHaveLength(0)
  })

  it('survives a precise DB fault on one row mid-pass and stays alive to deliver it (E090-1)', async () => {
    // A running worker (start(), not a bare runOnce): the claim UPDATE for the
    // first row throws once — an SQLITE_BUSY landing on exactly that statement.
    // It must not end the pass or the worker: the second row still uploads in
    // the same pass, the faulted row is left untouched, and once the fault
    // clears the still-running worker delivers it.
    const node = fakeNode()
    const service = new ArtifactTransferService({ put: node.put })
    const a = join(root, 'a.png'); const dataA = Buffer.from('AAAA'); writeFileSync(a, dataA)
    const b = join(root, 'b.png'); const dataB = Buffer.from('BBBB'); writeFileSync(b, dataB)
    const idA = sealDelivery('s1', 'c1', a, 'browser/a.png', dataA)
    const idB = sealDelivery('s1', 'c1', b, 'browser/b.png', dataB)
    // Fault the first claim only — the `holder IS ?` CAS is unique to claimDelivery.
    const real = deliveryDb().prepare.bind(deliveryDb())
    let faulted = false
    const spy = vi.spyOn(deliveryDb(), 'prepare').mockImplementation(((sql: string) => {
      if (!faulted && sql.includes('holder IS ?')) { faulted = true; throw new Error('SQLITE_BUSY') }
      return real(sql)
    }) as never)
    service.start('c1')
    // The pass survived the fault: the second row is on the node.
    await vi.waitFor(() => expect(getDelivery(idB)).toMatchObject({ outcome: 'done' }))
    expect(node.files.get('browser/b.png')!.equals(dataB)).toBe(true)
    // The faulted row was left exactly as it was — sealed, unheld, retryable.
    expect(getDelivery(idA)).toMatchObject({ phase: 'sealed', outcome: null, holder: null, gaveUpAt: null })
    // With the DB healthy again, the SAME worker (never restarted) delivers it.
    spy.mockRestore()
    service.wake('c1')
    await vi.waitFor(() => expect(getDelivery(idA)).toMatchObject({ outcome: 'done' }))
    expect(node.files.get('browser/a.png')!.equals(dataA)).toBe(true)
    service.stop('c1')
  })

  it('rescans after a wake that lands mid-pass, delivering a row sealed after the pass began (E090-5)', async () => {
    // The race the `woken` flag exists for: a file is sealed *after* a pass took
    // its row snapshot, and the wake for it lands while that pass is still
    // uploading. A brand-new row has next_attempt_at NULL, so the post-pass
    // sleep timer ignores it (it would wait BACKOFF_MAX). Only an immediate
    // rescan driven by the flag delivers it — which is why this asserts the new
    // row lands promptly, with the real loop, not a second runOnce.
    const node = fakeNode()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let entered = 0
    const put = async (c: string, req: ArtifactPutRequest) => {
      entered++
      if (entered === 1) await gate // hold the first pass open inside A's upload
      return node.put(c, req)
    }
    const service = new ArtifactTransferService({ put })
    const a = join(root, 'a.png'); const dataA = Buffer.from('AAAA'); writeFileSync(a, dataA)
    const b = join(root, 'b.png'); const dataB = Buffer.from('BBBB'); writeFileSync(b, dataB)
    const idA = sealDelivery('s1', 'c1', a, 'browser/a.png', dataA)
    service.start('c1')
    // Pass 1 is blocked inside A's put; its snapshot was [A] only.
    await vi.waitFor(() => expect(entered).toBe(1))
    // B is sealed now — after the snapshot — and the wake lands mid-pass.
    const idB = sealDelivery('s1', 'c1', b, 'browser/b.png', dataB)
    service.wake('c1')
    release()
    // The flag forces a rescan; B is delivered without waiting out any timer.
    await vi.waitFor(() => {
      expect(getDelivery(idA)).toMatchObject({ outcome: 'done' })
      expect(getDelivery(idB)).toMatchObject({ outcome: 'done' })
    })
    expect(node.files.get('browser/b.png')!.equals(dataB)).toBe(true)
    service.stop('c1')
  })
})
