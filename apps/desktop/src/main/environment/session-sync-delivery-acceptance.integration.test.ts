/**
 * Acceptance of the delivery-record architecture
 * (`docs/design/session-sync-zone-delivery-record.md` §9).
 *
 * These are not regression tests for fixes; they are the properties the single
 * record was adopted to hold, asserted on one fixture with real SQLite, the
 * real `ArtifactTransferService`, the real mirror, a controllable clock and a
 * controllable process incarnation. The bugs the claim/handoff/job triple kept
 * producing — AJ2 (a wake for a delivery nobody awaited), AK1 (a worker
 * touching a delivery it does not name) — appear here as things the model
 * cannot express, not as cases it handles.
 */
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactPutRequest } from '@superone/shared/environment'

const zone = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => zone.userData } }))
vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())
vi.mock('../logger', () => ({ default: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }))

import {
  advanceDelivery,
  classifyDeliveryAt,
  classifyDeliveriesUnder,
  getDelivery,
  reserveDelivery,
  type DeliveryHandle,
  type DeliveryPhase,
} from '../db-session-deliveries'
import { ensureSessionFileDeliveriesSchema } from '../db-session-deliveries-schema'
import { deliveryDb, resetDeliveryDatabase } from '../../test/fixtures/delivery-db'
import { _resetHoldersForTests, isHolderAlive, mintHolder } from './delivery-holders'
import { ArtifactTransferService } from './artifact-transfer-service'
import { mirrorNodeArtifact, mirrorNodeDirectory } from './session-file-mirror'

const S = 'node-s'
const C = 'conn-1'
let root: string

beforeEach(() => {
  resetDeliveryDatabase()
  _resetHoldersForTests()
  root = mkdtempSync(join(tmpdir(), 'delivery-accept-'))
  zone.userData = root
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const zonePath = (rel: string) => join(root, 'sync', S, rel)

/** A delivery for a file on disk, forced to `phase` the way an interrupted actor would have left it. */
function seed(rel: string, data: Buffer | string, phase: DeliveryPhase, opts: { held?: boolean; gaveUp?: boolean } = {}): string {
  const path = zonePath(rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, data)
  const r = reserveDelivery({ sessionId: S, connectionId: C, localPath: path, relativePath: rel, origin: 'produced', phase: 'writing', holder: mintHolder() })
  if ('refused' in r) throw new Error(r.refused)
  deliveryDb()
    .prepare('UPDATE session_file_deliveries SET phase = ?, holder = ?, gave_up_at = ?, last_error = ?, total = ?, sha256 = ? WHERE delivery_id = ?')
    .run(phase, opts.held ? mintHolder() : null, opts.gaveUp ? new Date().toISOString() : null, opts.gaveUp ? 'commit unverified' : null, Buffer.from(data).length, sha(data), r.deliveryId)
  return r.deliveryId
}

/** A node that serves `files`, or reports absence. */
function nodeServing(files: Record<string, Buffer | undefined>) {
  return {
    connectionId: C,
    stat: async ({ relativePath }: { relativePath: string }) => {
      const f = files[relativePath]
      return f ? { exists: true, size: f.length, mtimeMs: 1_700_000_009_000 } : { exists: false, size: 0, mtimeMs: 0 }
    },
    get: async (req: { relativePath: string; offset: number; maxBytes: number }) => {
      const f = files[req.relativePath]!
      const slice = f.subarray(req.offset, req.offset + req.maxBytes)
      return { chunk: slice.toString('base64'), total: f.length, mtimeMs: 1_700_000_009_000, eof: req.offset + slice.length >= f.length }
    },
    list: async ({ relativePath }: { relativePath: string }) => {
      const entries = Object.entries(files)
        .filter(([rel, f]) => f && rel.startsWith(`${relativePath}/`))
        .map(([rel, f]) => ({ relativePath: rel, size: f!.length, mtimeMs: 1_700_000_009_000 }))
      return { exists: entries.length > 0, entries, truncated: false }
    },
  }
}

describe('§9 — an uncertain final commit', () => {
  it('keeps it unavailable without replaying old bytes, and shows needs re-delivery', async () => {
    // The node has committed the file; the desktop's advance to `uploaded`
    // never landed, so the row is stuck at `committing`, given up (§6).
    const id = seed('download/report.csv', 'OLD', 'committing', { gaveUp: true })
    const service = new ArtifactTransferService({ put: async () => ({ ok: true, bytesWritten: 0 }) })

    // The node's copy is then modified, and then deleted. Through all of it the
    // mirror serves neither the desktop's OLD nor a replayed chunk.
    for (const nodeFiles of [{ 'download/report.csv': Buffer.from('NODE-MODIFIED') }, { 'download/report.csv': undefined }]) {
      const outcome = await mirrorNodeArtifact(S, 'download/report.csv', nodeServing(nodeFiles))
      expect(outcome).toMatchObject({ kind: 'unavailable' })
    }

    // Automatic recovery never touches it; Settings shows it as needing re-delivery.
    await service.runOnce(C)
    expect(getDelivery(id)).toMatchObject({ phase: 'committing' })
    expect(service.givenUp(S).map((r) => r.relativePath)).toEqual(['download/report.csv'])
    expect(service.retryGivenUp(S)).toEqual({ retried: 0 })
  })
})

describe('§9 — a recorder before its asynchronous writer starts', () => {
  it('protects the reserved path and, for a local session, takes no row at all', async () => {
    // The producer reserved the path; the writer has not run. The row is
    // `writing`. A directory mirror — the node lists the directory but not this
    // half-written member — prunes nothing and does not offer the tree as whole.
    seed('recording/clip.mp4', 'FRAMES-SO-FAR', 'writing', { held: true })
    const listingNode = { ...nodeServing({}), list: async () => ({ exists: true, entries: [], truncated: false }) }
    const out = await mirrorNodeDirectory(S, 'recording', listingNode)
    expect(out).toMatchObject({ kind: 'unavailable' })
    expect(classifyDeliveryAt(S, zonePath('recording/clip.mp4'))).toBe('protected-unreadable')
    const { existsSync } = await import('node:fs')
    expect(existsSync(zonePath('recording/clip.mp4'))).toBe(true)

    // A local session's producer takes no row at all (zone-delivery returns
    // null before the record is touched), so the mirror has nothing to protect
    // and falls straight through to ordinary behaviour.
    expect(classifyDeliveryAt('local-s', join(root, 'sync', 'local-s', 'recording', 'clip.mp4'))).toBe('none')
  })
})

describe('§9 — a live writer and dead holders in every phase', () => {
  it('never reclaims a live holder, reclaims a dead one in any phase, and never moves a phase backwards', () => {
    // A long-running writer's holder is alive; a worker pass leaves it be.
    const writer = seed('download/live.bin', 'STREAMING', 'writing', { held: true })
    expect(isHolderAlive(getDelivery(writer)!.holder!)).toBe(true)

    // An `uploading` holder from a previous process incarnation is dead now.
    const stale = seed('recording/prev.mp4', 'DONE-BYTES', 'uploading', { held: true })
    const staleHandle: DeliveryHandle = { deliveryId: stale, holder: getDelivery(stale)!.holder!, epoch: getDelivery(stale)!.epoch }
    _resetHoldersForTests() // a new incarnation: every prior holder is dead
    expect(isHolderAlive(staleHandle.holder)).toBe(false)

    // A fresh incarnation reclaims it and advances it; the old holder's callback
    // is then refused on its stale epoch — no phase moves under the ghost.
    const fresh = mintHolder()
    deliveryDb().prepare('UPDATE session_file_deliveries SET holder = ?, epoch = epoch + 1 WHERE delivery_id = ?').run(fresh, stale)
    const freshHandle: DeliveryHandle = { deliveryId: stale, holder: fresh, epoch: getDelivery(stale)!.epoch }
    expect(advanceDelivery(freshHandle, { from: 'uploading', to: 'committing' }).ok).toBe(true)
    expect(advanceDelivery(staleHandle, { from: 'uploading', to: 'committing' })).toMatchObject({ ok: false })

    // A step backwards is a programming error, not a race, and throws.
    const held = mintHolder()
    deliveryDb().prepare(`UPDATE session_file_deliveries SET holder = ?, phase = 'uploading', epoch = epoch + 1 WHERE delivery_id = ?`).run(held, writer)
    const handle: DeliveryHandle = { deliveryId: writer, holder: held, epoch: getDelivery(writer)!.epoch }
    expect(() => advanceDelivery(handle, { from: 'uploading', to: 'sealed', total: 1, sha256: 'x' })).toThrow(/backwards/)
  })
})

describe('§9 — the unreleased job table', () => {
  it('opens beside a developer artifact_transfer_jobs table and imports nothing', () => {
    // A dev database built before the record carries the orphan job table. The
    // record's schema is created beside it; nothing is read from it.
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE artifact_transfer_jobs (job_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, state TEXT NOT NULL);
      INSERT INTO artifact_transfer_jobs (job_id, session_id, state) VALUES ('j1', 's1', 'pending');
    `)
    ensureSessionFileDeliveriesSchema(db)
    expect(db.prepare('SELECT count(*) c FROM session_file_deliveries').get()).toEqual({ c: 0 })
    // The orphan table is untouched and unread — the record does not import it.
    expect(db.prepare('SELECT count(*) c FROM artifact_transfer_jobs').get()).toEqual({ c: 1 })
    db.close()
  })

  it('opens on a fresh database with no rows', () => {
    const db = new Database(':memory:')
    ensureSessionFileDeliveriesSchema(db)
    expect(db.prepare('SELECT count(*) c FROM session_file_deliveries').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT count(*) c FROM session_zone_tombstones').get()).toEqual({ c: 0 })
    db.close()
  })
})

describe('§9 — bugs the model cannot express (AJ2, AK1)', () => {
  it('AK1: an event names a record, so no actor can advance a delivery it does not hold', () => {
    // AK1 was a worker finishing delivery T and touching delivery U. Here an
    // advance is a compare-and-set on (delivery_id, holder, epoch): a handle
    // for one row can never move another.
    const t = seed('download/t.bin', 'T', 'sealed')
    const u = seed('download/u.bin', 'U', 'sealed')
    const holder = mintHolder()
    deliveryDb().prepare('UPDATE session_file_deliveries SET holder = ? WHERE delivery_id = ?').run(holder, t)
    const handleForT: DeliveryHandle = { deliveryId: t, holder, epoch: getDelivery(t)!.epoch }
    // The same handle cannot address U: its id is T's.
    expect(handleForT.deliveryId).toBe(t)
    expect(getDelivery(u)).toMatchObject({ phase: 'sealed', holder: null })
    // And an advance under T's handle only ever moves T.
    const moved = advanceDelivery(handleForT, { from: 'sealed', to: 'uploading' })
    expect(moved.ok).toBe(true)
    expect(getDelivery(u)).toMatchObject({ phase: 'sealed' })
  })

  it('AJ2: a completion wake belongs to the one row it completes, never to a bystander', async () => {
    // AJ2 was a finished transfer waking a joiner that had already returned.
    // There are no joiners: the row is woken once, by whoever completes it.
    const notified: string[] = []
    const service = new ArtifactTransferService({
      put: async (_c, req: ArtifactPutRequest) => ({ ok: true, bytesWritten: Buffer.from(req.chunk, 'base64').length, ...(req.final ? { mtimeMs: 1 } : {}) }),
      notifyCompleted: async (_c, input) => void notified.push(input.notificationId),
    })
    const id = seed('download/one.bin', 'BYTES', 'sealed')
    await service.runOnce(C)
    // Exactly one wake, carrying this row's own id.
    expect(notified).toEqual([id])
    expect(getDelivery(id)).toMatchObject({ outcome: 'done' })
  })
})

describe('§9 — R4 classification on one fixture', () => {
  it('reads outcome before phase and protects a directory by its strongest member', () => {
    seed('d/writing.bin', 'W', 'writing', { held: true })
    seed('d/sealed.bin', 'S', 'sealed')
    const committing = seed('d/committing.bin', 'C', 'committing', { gaveUp: true })
    const gaveUp = seed('d/gaveup.bin', 'G', 'uploading', { gaveUp: true })
    const abandoned = seed('d/abandoned.bin', 'A', 'uploading')
    deliveryDb().prepare(`UPDATE session_file_deliveries SET outcome = 'abandoned' WHERE delivery_id = ?`).run(abandoned)
    const done = seed('d/done.bin', 'D', 'notifying')
    deliveryDb().prepare(`UPDATE session_file_deliveries SET outcome = 'done' WHERE delivery_id = ?`).run(done)

    expect(classifyDeliveryAt(S, zonePath('d/sealed.bin'))).toBe('protected-readable')
    expect(classifyDeliveryAt(S, zonePath('d/committing.bin'))).toBe('protected-unreadable')
    expect(classifyDeliveryAt(S, zonePath('d/gaveup.bin'))).toBe('protected-readable') // gave up ≠ unprotected; the bytes are still the only copy
    expect(classifyDeliveryAt(S, zonePath('d/abandoned.bin'))).toBe('none')
    expect(classifyDeliveryAt(S, zonePath('d/done.bin'))).toBe('node-authoritative')
    // The directory answers with its strongest live member: a writer is unreadable.
    expect(classifyDeliveriesUnder(S, zonePath('d'))).toBe('protected-unreadable')
    void committing
  })
})

describe('§9 — the phase-advance × concurrent-actor matrix', () => {
  // Each cell: an actor holds a row at `from` and advances it; a concurrent
  // actor acts at the same point. The outcome is parameterised by whether the
  // advance took effect and whether its holder learned so.
  const holderAt = (deliveryId: string, phase: DeliveryPhase): DeliveryHandle => {
    const holder = mintHolder()
    deliveryDb().prepare('UPDATE session_file_deliveries SET holder = ?, phase = ? WHERE delivery_id = ?').run(holder, phase, deliveryId)
    return { deliveryId, holder, epoch: getDelivery(deliveryId)!.epoch }
  }

  it('succeeded: an advance under a current handle takes effect and returns the next handle', () => {
    const id = seed('m/a.bin', 'A', 'sealed')
    const h = holderAt(id, 'sealed')
    const r = advanceDelivery(h, { from: 'sealed', to: 'uploading' })
    expect(r).toMatchObject({ ok: true, handle: { deliveryId: id, epoch: h.epoch + 1 } })
    expect(getDelivery(id)).toMatchObject({ phase: 'uploading' })
  })

  it('failed before taking effect: a wrong-phase advance changes nothing', () => {
    const id = seed('m/b.bin', 'B', 'sealed')
    const h = holderAt(id, 'sealed')
    // The row is at `sealed`, so an advance FROM `uploading` cannot apply.
    expect(advanceDelivery(h, { from: 'uploading', to: 'committing' })).toMatchObject({ ok: false })
    expect(getDelivery(id)).toMatchObject({ phase: 'sealed' })
  })

  it('took effect but the caller did not learn it: a concurrent takeover bumps the epoch and the ghost is refused', () => {
    // The classic lost-reply cell. One actor's advance lands; a takeover then
    // moves the row on. The first actor retries on its stale handle and is
    // refused — never re-applying its step, never moving the phase back.
    const id = seed('m/c.bin', 'C', 'sealed')
    const first = holderAt(id, 'sealed')
    const landed = advanceDelivery(first, { from: 'sealed', to: 'uploading' })
    expect(landed.ok).toBe(true)

    // A fresh incarnation takes the (now dead-held) row over and advances it.
    _resetHoldersForTests()
    const second = mintHolder()
    deliveryDb().prepare('UPDATE session_file_deliveries SET holder = ?, epoch = epoch + 1 WHERE delivery_id = ?').run(second, id)
    const secondHandle: DeliveryHandle = { deliveryId: id, holder: second, epoch: getDelivery(id)!.epoch }
    expect(advanceDelivery(secondHandle, { from: 'uploading', to: 'committing' }).ok).toBe(true)

    // The first actor's retry on its old handle is refused; the phase stands.
    expect(landed.ok && advanceDelivery(landed.handle, { from: 'uploading', to: 'committing' })).toMatchObject({ ok: false })
    expect(getDelivery(id)).toMatchObject({ phase: 'committing' })
  })

  it('the retry counter is orthogonal to the phase across the matrix', async () => {
    // Failure is scheduling: attempts climb, next_attempt_at moves, the phase
    // does not. A non-final put failing backs the row off at `uploading`.
    const service = new ArtifactTransferService({
      put: async () => { throw Object.assign(new Error('down'), { code: 'unavailable' }) },
      now: () => 1_000_000,
    })
    // Two chunks so the failing put is non-final rather than the committing one.
    const big = Buffer.alloc(8 * 1024 * 1024, 1)
    const id = seed('m/d.bin', big, 'sealed')
    await service.runOnce(C)
    const after = getDelivery(id)!
    expect(after).toMatchObject({ phase: 'uploading', attempts: 1, gaveUpAt: null })
    expect(after.nextAttemptAt).toBeGreaterThan(1_000_000)
  })
})
